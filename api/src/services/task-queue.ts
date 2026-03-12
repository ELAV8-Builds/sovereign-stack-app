/**
 * Task Queue — Redis-backed parallel agent execution
 *
 * Manages concurrent agent tasks with:
 * - Configurable concurrency cap (default: 5)
 * - Resource-aware backoff (pauses new tasks when system is strained)
 * - Job lifecycle tracking (queued → running → completed/failed)
 * - WebSocket notifications on completion
 */
import { getRedis } from './redis';
import { logActivity } from './activity-broadcaster';
import os from 'os';

// ── Types ────────────────────────────────────────────────────────────

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'paused';

export interface AgentJob {
  id: string;
  agentId: string;
  agentName: string;
  message: string;
  status: JobStatus;
  progress: {
    iteration: number;
    maxIterations: number;
    currentTool?: string;
    lastThinking?: string;
  };
  result?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  // Pipeline support
  dependsOn?: string[];
  pipelineId?: string;
  depResults?: Record<string, string>;
}

export interface QueueStats {
  running: number;
  queued: number;
  completed: number;
  failed: number;
  maxConcurrency: number;
  systemLoad: number;
  backoffActive: boolean;
}

// ── Configuration ────────────────────────────────────────────────────

const MAX_CONCURRENCY = parseInt(process.env.FLEET_MAX_CONCURRENCY || '5', 10);
const BACKOFF_LOAD_THRESHOLD = 0.85; // Pause new jobs if load average > 85% of CPU count
const QUEUE_KEY = 'fleet:queue';
const JOBS_KEY = 'fleet:jobs';
const RUNNING_KEY = 'fleet:running';
const JOB_TTL = 24 * 60 * 60; // Keep job data for 24 hours

// ── In-memory state for active jobs ──────────────────────────────────

const activeJobs = new Map<string, {
  abortController: AbortController;
  agentId: string;
}>();

// ── Job ID generation ────────────────────────────────────────────────

function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Resource Monitor ─────────────────────────────────────────────────

export function getSystemLoad(): { loadAvg: number; cpuCount: number; memFreeGB: number; loadPercent: number } {
  const cpuCount = os.cpus().length;
  const loadAvg = os.loadavg()[0]; // 1-minute load average
  const memFreeGB = os.freemem() / (1024 * 1024 * 1024);
  const loadPercent = loadAvg / cpuCount;

  return { loadAvg, cpuCount, memFreeGB, loadPercent };
}

export function shouldBackoff(): boolean {
  const { loadPercent, memFreeGB } = getSystemLoad();
  // Back off if CPU load > threshold OR free memory < 1GB
  return loadPercent > BACKOFF_LOAD_THRESHOLD || memFreeGB < 1.0;
}

// ── Queue Operations ─────────────────────────────────────────────────

/**
 * Enqueue a new agent task. Returns the job immediately.
 * The task runs in the background.
 */
export async function enqueueTask(
  agentId: string,
  agentName: string,
  message: string,
  opts?: { dependsOn?: string[]; pipelineId?: string },
): Promise<AgentJob> {
  const jobId = generateJobId();
  const now = new Date().toISOString();

  const job: AgentJob = {
    id: jobId,
    agentId,
    agentName,
    message,
    status: 'queued',
    progress: { iteration: 0, maxIterations: 100 },
    createdAt: now,
    dependsOn: opts?.dependsOn,
    pipelineId: opts?.pipelineId,
  };

  try {
    const redis = getRedis();
    // Store job data
    await redis.setEx(`${JOBS_KEY}:${jobId}`, JOB_TTL, JSON.stringify(job));
    // Add to queue
    await redis.rPush(QUEUE_KEY, jobId);

    logActivity('fleet', 'info', `Task queued: ${agentName} — "${message.slice(0, 60)}..." [${jobId}]`);
  } catch {
    // Redis down — still track in memory
    logActivity('fleet', 'warning', `Redis unavailable, tracking job ${jobId} in-memory only`);
  }

  // Try to process the queue
  processQueue();

  return job;
}

/**
 * Get a job by ID
 */
export async function getJob(jobId: string): Promise<AgentJob | null> {
  try {
    const redis = getRedis();
    const data = await redis.get(`${JOBS_KEY}:${jobId}`);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * Update a job's state in Redis
 */
async function updateJob(jobId: string, updates: Partial<AgentJob>): Promise<void> {
  try {
    const redis = getRedis();
    const existing = await redis.get(`${JOBS_KEY}:${jobId}`);
    if (!existing) return;

    const job: AgentJob = { ...JSON.parse(existing), ...updates };
    await redis.setEx(`${JOBS_KEY}:${jobId}`, JOB_TTL, JSON.stringify(job));
  } catch {
    // Best effort
  }
}

/**
 * Get all jobs for a specific agent
 */
export async function getAgentJobs(agentId: string): Promise<AgentJob[]> {
  try {
    const redis = getRedis();
    // Get all job keys
    const keys = await redis.keys(`${JOBS_KEY}:job_*`);
    if (keys.length === 0) return [];

    const jobs: AgentJob[] = [];
    for (const key of keys) {
      const data = await redis.get(key);
      if (data) {
        const job: AgentJob = JSON.parse(data);
        if (job.agentId === agentId) {
          jobs.push(job);
        }
      }
    }

    return jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

/**
 * Get queue stats
 */
export async function getQueueStats(): Promise<QueueStats> {
  const { loadPercent } = getSystemLoad();

  try {
    const redis = getRedis();
    const queueLen = await redis.lLen(QUEUE_KEY);
    const runningCount = activeJobs.size;

    // Count completed/failed from recent jobs
    const keys = await redis.keys(`${JOBS_KEY}:job_*`);
    let completed = 0;
    let failed = 0;
    for (const key of keys) {
      const data = await redis.get(key);
      if (data) {
        const job: AgentJob = JSON.parse(data);
        if (job.status === 'completed') completed++;
        if (job.status === 'failed') failed++;
      }
    }

    return {
      running: runningCount,
      queued: queueLen,
      completed,
      failed,
      maxConcurrency: MAX_CONCURRENCY,
      systemLoad: Math.round(loadPercent * 100),
      backoffActive: shouldBackoff(),
    };
  } catch {
    return {
      running: activeJobs.size,
      queued: 0,
      completed: 0,
      failed: 0,
      maxConcurrency: MAX_CONCURRENCY,
      systemLoad: Math.round(loadPercent * 100),
      backoffActive: shouldBackoff(),
    };
  }
}

/**
 * Cancel a running or queued job
 */
export async function cancelJob(jobId: string): Promise<boolean> {
  const active = activeJobs.get(jobId);
  if (active) {
    active.abortController.abort();
    activeJobs.delete(jobId);
    await updateJob(jobId, { status: 'failed', error: 'Cancelled by user', completedAt: new Date().toISOString() });
    logActivity('fleet', 'info', `Job cancelled: ${jobId}`);
    return true;
  }

  // Remove from queue if queued
  try {
    const redis = getRedis();
    await redis.lRem(QUEUE_KEY, 1, jobId);
    await updateJob(jobId, { status: 'failed', error: 'Cancelled before execution' });
    return true;
  } catch {
    return false;
  }
}

// ── Dependency Checker ──────────────────────────────────────────────

async function checkDependencies(job: AgentJob): Promise<boolean> {
  if (!job.dependsOn || job.dependsOn.length === 0) return true;

  const depResults: Record<string, string> = {};
  for (const depId of job.dependsOn) {
    const depJob = await getJob(depId);
    if (!depJob) return false; // Dep not found
    if (depJob.status === 'failed') {
      // If a dependency failed, fail this job too
      await updateJob(job.id, {
        status: 'failed',
        error: `Dependency ${depId} failed: ${depJob.error || 'unknown'}`,
        completedAt: new Date().toISOString(),
      });
      return false;
    }
    if (depJob.status !== 'completed') return false; // Not ready yet
    depResults[depId] = depJob.result || '';
  }

  // All deps completed — attach their results
  await updateJob(job.id, { depResults });
  return true;
}

// ── Pipeline Operations ─────────────────────────────────────────────

export async function getPipelineJobs(pipelineId: string): Promise<AgentJob[]> {
  try {
    const redis = getRedis();
    const keys = await redis.keys(`${JOBS_KEY}:job_*`);
    const jobs: AgentJob[] = [];
    for (const key of keys) {
      const data = await redis.get(key);
      if (data) {
        const job: AgentJob = JSON.parse(data);
        if (job.pipelineId === pipelineId) jobs.push(job);
      }
    }
    return jobs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  } catch {
    return [];
  }
}

export function generatePipelineId(): string {
  return `pipeline_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ── Queue Processor ──────────────────────────────────────────────────

let processing = false;

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    while (true) {
      // Check concurrency limit
      if (activeJobs.size >= MAX_CONCURRENCY) {
        logActivity('fleet', 'info', `Concurrency limit reached (${activeJobs.size}/${MAX_CONCURRENCY}), waiting...`);
        break;
      }

      // Check resource backoff
      if (shouldBackoff()) {
        const { loadPercent, memFreeGB } = getSystemLoad();
        logActivity('fleet', 'warning',
          `Resource backoff active — CPU: ${Math.round(loadPercent * 100)}%, Free RAM: ${memFreeGB.toFixed(1)}GB. Pausing queue.`
        );
        break;
      }

      // Dequeue next job
      let jobId: string | null = null;
      try {
        const redis = getRedis();
        jobId = await redis.lPop(QUEUE_KEY);
      } catch {
        break; // Redis down
      }

      if (!jobId) break; // Queue empty

      // Load job data
      const job = await getJob(jobId);
      if (!job) continue;

      // Check dependencies — if not all deps are completed, re-queue
      if (job.dependsOn && job.dependsOn.length > 0) {
        const depsReady = await checkDependencies(job);
        if (!depsReady) {
          // Push back to end of queue
          try {
            const redis = getRedis();
            await redis.rPush(QUEUE_KEY, jobId);
          } catch { /* best effort */ }
          continue;
        }
      }

      // Start the job (fire and forget)
      executeJob(job);
    }
  } finally {
    processing = false;
  }
}

// ── Job Executor ─────────────────────────────────────────────────────

// This import is deferred to avoid circular deps
let runAgentTask: ((job: AgentJob, abortSignal: AbortSignal, onProgress: (update: Partial<AgentJob>) => void) => Promise<string>) | null = null;

export function registerAgentRunner(
  runner: (job: AgentJob, abortSignal: AbortSignal, onProgress: (update: Partial<AgentJob>) => void) => Promise<string>
): void {
  runAgentTask = runner;
}

async function executeJob(job: AgentJob): Promise<void> {
  if (!runAgentTask) {
    logActivity('fleet', 'error', `No agent runner registered — cannot execute job ${job.id}`);
    await updateJob(job.id, { status: 'failed', error: 'Agent runner not initialized' });
    return;
  }

  const abortController = new AbortController();
  activeJobs.set(job.id, { abortController, agentId: job.agentId });

  const startTime = Date.now();
  await updateJob(job.id, { status: 'running', startedAt: new Date().toISOString() });
  logActivity('fleet', 'info', `Job started: ${job.agentName} [${job.id}]`);

  try {
    const result = await runAgentTask(
      job,
      abortController.signal,
      async (update) => {
        // Progress callback — update Redis with current state
        await updateJob(job.id, {
          progress: { ...job.progress, ...update.progress },
        });
      }
    );

    const durationMs = Date.now() - startTime;
    await updateJob(job.id, {
      status: 'completed',
      result,
      completedAt: new Date().toISOString(),
      durationMs,
    });

    logActivity('fleet', 'success', `Job completed: ${job.agentName} [${job.id}] in ${(durationMs / 1000).toFixed(1)}s`);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = (err as Error).message || 'Unknown error';

    await updateJob(job.id, {
      status: 'failed',
      error: errorMsg,
      completedAt: new Date().toISOString(),
      durationMs,
    });

    logActivity('fleet', 'error', `Job failed: ${job.agentName} [${job.id}] — ${errorMsg}`);
  } finally {
    activeJobs.delete(job.id);
    // Process next in queue
    processQueue();
  }
}

// ── Periodic Queue Check ─────────────────────────────────────────────
// Re-check queue every 5 seconds in case backoff cleared

setInterval(() => {
  if (activeJobs.size < MAX_CONCURRENCY && !shouldBackoff()) {
    processQueue();
  }
}, 5000);
