/**
 * Overmind — Agent Contract & Task Queue
 *
 * Implements the agent lifecycle management layer:
 *
 * 1. HEARTBEAT — Agents send periodic pings; Overmind detects dead agents
 * 2. TASK QUEUE — Redis-backed queue for task distribution
 * 3. CONCURRENCY — Enforces max_parallel_jobs per agent
 * 4. DO-NOT-TRUST — Never marks tasks complete on agent claim alone
 * 5. HEALTH — Periodic sweep marks stale agents as unhealthy
 *
 * Architecture: Pull model — agents poll for tasks, Overmind validates results.
 */

import { getRedis } from '../redis';
import * as db from './db';
import { findSkill, buildSkillPrompt } from './skills';
import { getActiveRules, getRuleValue } from './orchestrator';
import type {
  OvAgent,
  OvTask,
  OvJob,
  TaskType,
  TaskStatus,
  AgentStatus,
  TargetType,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Redis key prefix for all Overmind data. */
const PREFIX = 'overmind:';

/** How long an agent heartbeat key survives in Redis (seconds). */
const HEARTBEAT_TTL = 120; // 2 minutes

/** How many seconds without a heartbeat before marking unhealthy. */
const HEARTBEAT_TIMEOUT = 90;

/** How many seconds without a heartbeat before quarantining. */
const QUARANTINE_TIMEOUT = 300; // 5 minutes

/** Default timeout (minutes) for stuck task detection. */
const STUCK_TASK_TIMEOUT_MINUTES = 30;

/**
 * Default compliance penalty per violation (overridden by rules engine).
 * Use getCompliancePenalty() to get the dynamic value.
 */
const DEFAULT_COMPLIANCE_PENALTY = 10;

/**
 * Default compliance score below which an agent gets quarantined.
 * Use getQuarantineThreshold() to get the dynamic value.
 */
const DEFAULT_QUARANTINE_THRESHOLD = 30;

/** Get the dynamic compliance penalty from rules, falling back to default. */
async function getCompliancePenalty(): Promise<number> {
  try {
    const rules = await getActiveRules();
    return getRuleValue(rules, 'agent', 'compliance_penalty', DEFAULT_COMPLIANCE_PENALTY);
  } catch {
    return DEFAULT_COMPLIANCE_PENALTY;
  }
}

/** Get the dynamic quarantine threshold from rules, falling back to default. */
async function getQuarantineThreshold(): Promise<number> {
  try {
    const rules = await getActiveRules();
    return getRuleValue(rules, 'agent', 'quarantine_score', DEFAULT_QUARANTINE_THRESHOLD);
  } catch {
    return DEFAULT_QUARANTINE_THRESHOLD;
  }
}

// ---------------------------------------------------------------------------
// Redis Key Helpers
// ---------------------------------------------------------------------------

function heartbeatKey(agentId: string): string {
  return `${PREFIX}heartbeat:${agentId}`;
}

function queueKey(taskType: TaskType): string {
  return `${PREFIX}queue:${taskType}`;
}

function taskLockKey(taskId: string): string {
  return `${PREFIX}lock:task:${taskId}`;
}

function agentLoadKey(agentId: string): string {
  return `${PREFIX}agent:load:${agentId}`;
}

function eventChannelKey(): string {
  return `${PREFIX}events`;
}

// ---------------------------------------------------------------------------
// Heartbeat System
// ---------------------------------------------------------------------------

/**
 * Record an agent heartbeat. The agent calls this periodically
 * to signal it's still alive and responsive.
 */
export async function recordHeartbeat(
  agentId: string,
  currentLoad?: number
): Promise<void> {
  const redis = getRedis();

  // Set the heartbeat key with TTL
  await redis.setEx(
    heartbeatKey(agentId),
    HEARTBEAT_TTL,
    JSON.stringify({
      agent_id: agentId,
      timestamp: new Date().toISOString(),
      load: currentLoad ?? 0,
    })
  );

  // Update DB timestamp
  await db.updateAgentHeartbeat(agentId);

  // If load was provided, update that too
  if (typeof currentLoad === 'number') {
    await db.updateAgentLoad(agentId, currentLoad);
    await redis.set(agentLoadKey(agentId), String(currentLoad));
  }
}

/**
 * Check if an agent has a recent heartbeat.
 */
export async function isAgentAlive(agentId: string): Promise<boolean> {
  const redis = getRedis();
  const hb = await redis.get(heartbeatKey(agentId));
  return hb !== null;
}

/**
 * Sweep all agents and update health status based on heartbeat freshness.
 * This should be called on a periodic interval (e.g. every 30 seconds).
 */
export async function sweepAgentHealth(): Promise<{
  healthy: number;
  unhealthy: number;
  quarantined: number;
}> {
  const redis = getRedis();
  const agents = await db.listAgents();
  const counts = { healthy: 0, unhealthy: 0, quarantined: 0 };

  for (const agent of agents) {
    const alive = await redis.get(heartbeatKey(agent.id));

    if (alive) {
      // Agent has a fresh heartbeat
      if (agent.status !== 'healthy') {
        await db.updateAgentStatus(agent.id, 'healthy');
      }
      counts.healthy++;
    } else {
      // No heartbeat — check how long it's been
      const lastHeartbeat = agent.last_heartbeat;
      const elapsed = Date.now() - new Date(lastHeartbeat).getTime();
      const elapsedSeconds = elapsed / 1000;

      if (elapsedSeconds > QUARANTINE_TIMEOUT) {
        if (agent.status !== 'quarantined') {
          await db.updateAgentStatus(agent.id, 'quarantined');
          await publishEvent('agent_quarantined', {
            agent_id: agent.id,
            agent_name: agent.name,
            last_heartbeat: lastHeartbeat,
          });
        }
        counts.quarantined++;
      } else if (elapsedSeconds > HEARTBEAT_TIMEOUT) {
        if (agent.status !== 'unhealthy') {
          await db.updateAgentStatus(agent.id, 'unhealthy');
          await publishEvent('agent_unhealthy', {
            agent_id: agent.id,
            agent_name: agent.name,
            last_heartbeat: lastHeartbeat,
          });
        }
        counts.unhealthy++;
      } else {
        counts.healthy++;
      }
    }
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Task Queue (Redis-backed)
// ---------------------------------------------------------------------------

/**
 * Enqueue a task into the Redis queue for its type.
 * This supplements the DB-based polling by providing a fast notification mechanism.
 */
export async function enqueueTask(task: OvTask): Promise<void> {
  const redis = getRedis();
  await redis.lPush(
    queueKey(task.type),
    JSON.stringify({
      task_id: task.id,
      job_id: task.job_id,
      type: task.type,
      skill_name: task.skill_name,
      created_at: new Date().toISOString(),
    })
  );

  // Publish event for real-time listeners
  await publishEvent('task_queued', {
    task_id: task.id,
    type: task.type,
    job_id: task.job_id,
  });
}

/**
 * Dequeue a task from the Redis queue.
 * Returns the task info or null if the queue is empty.
 */
export async function dequeueTask(
  taskType: TaskType
): Promise<{ task_id: string; job_id: string; type: TaskType } | null> {
  const redis = getRedis();
  const item = await redis.rPop(queueKey(taskType));
  if (!item) return null;

  try {
    return JSON.parse(item);
  } catch {
    return null;
  }
}

/**
 * Get the current queue depths for all task types.
 */
export async function getQueueDepths(): Promise<Record<TaskType, number>> {
  const redis = getRedis();
  const types: TaskType[] = ['spec', 'implementation', 'cleanup', 'test', 'deploy'];

  const depths: Record<string, number> = {};
  for (const type of types) {
    depths[type] = await redis.lLen(queueKey(type));
  }

  return depths as Record<TaskType, number>;
}

// ---------------------------------------------------------------------------
// Task Locking
// ---------------------------------------------------------------------------

/**
 * Attempt to acquire a lock on a task (prevents double-assignment).
 * Returns true if the lock was acquired, false if already locked.
 */
export async function acquireTaskLock(
  taskId: string,
  agentId: string,
  ttlSeconds: number = 600
): Promise<boolean> {
  const redis = getRedis();
  const result = await redis.set(
    taskLockKey(taskId),
    agentId,
    { NX: true, EX: ttlSeconds }
  );
  return result === 'OK';
}

/**
 * Release a task lock.
 */
export async function releaseTaskLock(taskId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(taskLockKey(taskId));
}

// ---------------------------------------------------------------------------
// Task Assignment Engine
// ---------------------------------------------------------------------------

/**
 * Find the best available agent for a task.
 *
 * Selection criteria:
 * 1. Agent must be healthy
 * 2. Agent must have available capacity (current_load < max_concurrent_tasks)
 * 3. Prefer agent with lowest current load
 * 4. Prefer agent with highest compliance score (if available from DB)
 */
export async function findBestAgent(): Promise<OvAgent | null> {
  const agents = await db.listAgents();

  const available = agents
    .filter(a => a.status === 'healthy')
    .filter(a => a.current_load < a.max_concurrent_tasks)
    .sort((a, b) => {
      // Prefer lowest load first
      const loadDiff = a.current_load - b.current_load;
      if (loadDiff !== 0) return loadDiff;
      // Tiebreak: oldest agent (most established)
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

  return available.length > 0 ? available[0] : null;
}

/**
 * Assign a task to the best available agent.
 *
 * This is the main entry point for the assignment engine.
 * It finds an agent, acquires a lock, and updates both DB and Redis.
 */
export async function assignTaskToAgent(taskId: string): Promise<{
  assigned: boolean;
  agent_id?: string;
  reason?: string;
}> {
  const task = await db.getTask(taskId);
  if (!task) return { assigned: false, reason: 'Task not found' };
  if (task.status !== 'queued' && task.status !== 'pending') {
    return { assigned: false, reason: `Task is ${task.status}, not assignable` };
  }

  const agent = await findBestAgent();
  if (!agent) return { assigned: false, reason: 'No available agents' };

  // Try to lock the task
  const locked = await acquireTaskLock(taskId, agent.id);
  if (!locked) return { assigned: false, reason: 'Task already locked by another agent' };

  // Assign in DB
  await db.assignTask(taskId, agent.id);
  await db.updateTaskStatus(taskId, 'running');
  await db.updateAgentLoad(agent.id, agent.current_load + 1);

  // Publish assignment event
  await publishEvent('task_assigned', {
    task_id: taskId,
    agent_id: agent.id,
    agent_name: agent.name,
    task_type: task.type,
  });

  return { assigned: true, agent_id: agent.id };
}

// ---------------------------------------------------------------------------
// Do-Not-Trust Policy
// ---------------------------------------------------------------------------

/**
 * Validate a task completion claim from an agent.
 *
 * The Do-Not-Trust policy means:
 * 1. Agent says "done" → Overmind runs a cleanup scan
 * 2. If cleanup passes → task is truly complete
 * 3. If cleanup fails → task goes back to iterating
 * 4. Agent never gets to mark itself as "completed"
 *
 * This function is called when an agent reports task completion.
 * It returns what the actual next status should be.
 */
export async function validateTaskCompletion(
  taskId: string,
  agentResult: Record<string, unknown>
): Promise<{
  accepted: boolean;
  next_status: TaskStatus;
  reason: string;
}> {
  const task = await db.getTask(taskId);
  if (!task) {
    return { accepted: false, next_status: 'failed', reason: 'Task not found' };
  }

  const job = await db.getJob(task.job_id);
  if (!job) {
    return { accepted: false, next_status: 'failed', reason: 'Parent job not found' };
  }

  // Store the agent's result
  await db.completeTask(taskId, agentResult);

  // For spec and deploy tasks, we can accept without cleanup
  if (task.type === 'spec' || task.type === 'deploy') {
    await db.updateTaskStatus(taskId, 'completed');
    await releaseTaskLock(taskId);

    // Decrement agent load
    if (task.agent_id) {
      const agent = await db.getAgent(task.agent_id);
      if (agent) {
        await db.updateAgentLoad(agent.id, Math.max(0, agent.current_load - 1));
      }
    }

    return {
      accepted: true,
      next_status: 'completed',
      reason: `${task.type} task accepted without cleanup`,
    };
  }

  // For implementation, cleanup, and test tasks — require cleanup verification
  // Move to awaiting_cleanup status; the cleanup engine will pick it up
  await db.updateTaskStatus(taskId, 'awaiting_cleanup');

  return {
    accepted: false,
    next_status: 'awaiting_cleanup',
    reason: 'Result received. Awaiting cleanup verification before acceptance.',
  };
}

/**
 * Handle a failed task report from an agent.
 * Applies compliance scoring and decides whether to retry or escalate.
 */
export async function handleTaskFailure(
  taskId: string,
  error: string,
  agentId: string
): Promise<{
  action: 'retry' | 'escalate' | 'quarantine';
  reason: string;
}> {
  const task = await db.getTask(taskId);
  if (!task) {
    return { action: 'escalate', reason: 'Task not found' };
  }

  // Record the failure
  await db.failTask(taskId, error);
  await releaseTaskLock(taskId);

  // Decrement agent load + apply dynamic compliance penalty
  const agent = await db.getAgent(agentId);
  const penalty = await getCompliancePenalty();
  if (agent) {
    await db.updateAgentLoad(agentId, Math.max(0, agent.current_load - 1));

    // Penalize agent compliance using rules-driven penalty
    await db.decrementComplianceScore(agentId, penalty);
  }

  // Decide: retry or escalate based on iteration count
  if (task.iteration < task.max_iterations) {
    // Reset task for retry with a different agent
    await db.updateTaskStatus(taskId, 'queued');
    await enqueueTask(task);

    return {
      action: 'retry',
      reason: `Retry ${task.iteration + 1}/${task.max_iterations}. Previous error: ${error}`,
    };
  }

  // Max retries reached — escalate
  await db.updateTaskStatus(taskId, 'escalated');

  return {
    action: 'escalate',
    reason: `Max iterations (${task.max_iterations}) reached. Last error: ${error}`,
  };
}

// ---------------------------------------------------------------------------
// Stuck Task Recovery
// ---------------------------------------------------------------------------

/**
 * Find and recover tasks that appear stuck (no update for N minutes).
 * Stuck tasks are re-queued and their agents are penalized.
 */
export async function recoverStuckTasks(
  timeoutMinutes: number = STUCK_TASK_TIMEOUT_MINUTES
): Promise<{ recovered: number; tasks: string[] }> {
  const stuckTasks = await db.getStuckTasks(timeoutMinutes);
  const recoveredIds: string[] = [];
  const penalty = await getCompliancePenalty();

  for (const task of stuckTasks) {
    // Release the lock
    await releaseTaskLock(task.id);

    // Penalize the agent using rules-driven penalty
    if (task.agent_id) {
      await db.decrementComplianceScore(task.agent_id, penalty);
      const agent = await db.getAgent(task.agent_id);
      if (agent) {
        await db.updateAgentLoad(task.agent_id, Math.max(0, agent.current_load - 1));
      }
    }

    // Re-queue the task
    await db.updateTaskStatus(task.id, 'queued');
    // Unassign the agent
    await db.assignTask(task.id, ''); // Clear assignment

    await publishEvent('task_recovered', {
      task_id: task.id,
      previous_agent: task.agent_id,
      timeout_minutes: timeoutMinutes,
    });

    recoveredIds.push(task.id);
  }

  return { recovered: recoveredIds.length, tasks: recoveredIds };
}

// ---------------------------------------------------------------------------
// Job Lifecycle
// ---------------------------------------------------------------------------

/**
 * Check if all tasks in a job are complete and update job status accordingly.
 */
export async function checkJobCompletion(jobId: string): Promise<{
  complete: boolean;
  status: string;
}> {
  const job = await db.getJobWithTasks(jobId);
  if (!job) return { complete: false, status: 'not_found' };

  const tasks = job.tasks;
  const allCompleted = tasks.every(t => t.status === 'completed');
  const anyFailed = tasks.some(t => t.status === 'failed');
  const anyEscalated = tasks.some(t => t.status === 'escalated');

  if (allCompleted) {
    await db.updateJobStatus(jobId, 'completed');
    await publishEvent('job_completed', { job_id: jobId, title: job.title });
    return { complete: true, status: 'completed' };
  }

  if (anyFailed) {
    await db.updateJobStatus(jobId, 'failed');
    return { complete: true, status: 'failed' };
  }

  if (anyEscalated) {
    await db.updateJobStatus(jobId, 'needs_review');
    await publishEvent('job_needs_review', { job_id: jobId, title: job.title });
    return { complete: false, status: 'needs_review' };
  }

  return { complete: false, status: job.status };
}

// ---------------------------------------------------------------------------
// Event Publishing (Redis Pub/Sub)
// ---------------------------------------------------------------------------

/**
 * Publish an event to the Overmind event channel.
 * Consumers (SSE, WebSocket, Slack) can subscribe for real-time updates.
 */
export async function publishEvent(
  type: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const redis = getRedis();
    await redis.publish(
      eventChannelKey(),
      JSON.stringify({
        type,
        data,
        timestamp: new Date().toISOString(),
      })
    );
  } catch {
    // Pub/sub failures are non-critical
  }
}

// ---------------------------------------------------------------------------
// Orchestrator Tick (called on interval)
// ---------------------------------------------------------------------------

/**
 * Main orchestrator tick — runs periodically to:
 * 1. Sweep agent health
 * 2. Recover stuck tasks
 * 3. Assign queued tasks to available agents
 * 4. Check for completed jobs
 *
 * Call this every 15-30 seconds.
 */
export async function orchestratorTick(): Promise<{
  agents: { healthy: number; unhealthy: number; quarantined: number };
  recovered: number;
  assigned: number;
}> {
  // 1. Agent health sweep
  const agentHealth = await sweepAgentHealth();

  // 2. Recover stuck tasks
  const { recovered } = await recoverStuckTasks();

  // 3. Auto-assign queued tasks
  let assigned = 0;
  const queuedTasks = await db.pollTasks('', undefined, 20); // Get up to 20 unassigned tasks
  for (const task of queuedTasks) {
    const result = await assignTaskToAgent(task.id);
    if (result.assigned) assigned++;
  }

  // 4. Check for job completions on all running jobs
  const runningJobs = await db.listJobs('running');
  for (const job of runningJobs) {
    await checkJobCompletion(job.id);
  }

  return { agents: agentHealth, recovered, assigned };
}
