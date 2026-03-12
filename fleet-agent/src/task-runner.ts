/**
 * Fleet Agent — Task Runner
 *
 * Receives task pushes from Overmind, executes them in Docker containers,
 * and reports results back.
 */

import type { FleetAgentConfig } from './config';
import { createSignedHeaders, verifyInboundRequest } from './security';
import { updateWorkerCounts } from './heartbeat';
import type { Request, Response } from 'express';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskPayload {
  task_id: string;
  job_id?: string;
  type: string;
  prompt: string;
  config?: Record<string, unknown>;
  skill_name?: string;
  skill_config?: Record<string, unknown>;
}

interface ActiveTask {
  task_id: string;
  started_at: Date;
  status: 'running' | 'completed' | 'failed';
  container_id?: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const activeTasks: Map<string, ActiveTask> = new Map();

// ---------------------------------------------------------------------------
// Task Execution
// ---------------------------------------------------------------------------

/**
 * Handle an incoming task push from Overmind.
 * This is called by the Express route handler.
 */
export async function handleTaskPush(
  req: Request,
  res: Response,
  config: FleetAgentConfig
): Promise<void> {
  // 1. Verify the request
  const bodyStr = JSON.stringify(req.body || {});
  const verification = verifyInboundRequest(bodyStr, {
    'x-timestamp': req.headers['x-timestamp'] as string,
    'x-overmind-signature': req.headers['x-overmind-signature'] as string,
  }, config.hmacSecret);

  if (!verification.valid) {
    console.warn(`[task-runner] Rejected task push: ${verification.error}`);
    res.status(401).json({ error: verification.error });
    return;
  }

  // 2. Parse the task
  const payload = req.body as TaskPayload;
  if (!payload.task_id || !payload.type || !payload.prompt) {
    res.status(400).json({ error: 'Missing required fields: task_id, type, prompt' });
    return;
  }

  // 3. Check capacity
  if (activeTasks.size >= config.maxWorkers) {
    res.status(429).json({
      error: 'At capacity',
      active_tasks: activeTasks.size,
      max_workers: config.maxWorkers,
    });
    return;
  }

  // 4. Accept the task
  const task: ActiveTask = {
    task_id: payload.task_id,
    started_at: new Date(),
    status: 'running',
  };
  activeTasks.set(payload.task_id, task);
  updateWorkerCounts(activeTasks.size, activeTasks.size);

  console.log(`[task-runner] Accepted task ${payload.task_id} (type: ${payload.type})`);
  res.status(202).json({ ok: true, task_id: payload.task_id, message: 'Task accepted' });

  // 5. Execute asynchronously
  executeTask(payload, config).catch(err => {
    console.error(`[task-runner] Task ${payload.task_id} failed:`, err);
  });
}

/**
 * Execute a task in a Docker container.
 * Reports the result back to Overmind when done.
 */
async function executeTask(payload: TaskPayload, config: FleetAgentConfig): Promise<void> {
  const task = activeTasks.get(payload.task_id);
  if (!task) return;

  try {
    // TODO: Actually spawn a Docker container and execute the task
    // For now, this is a placeholder that demonstrates the flow
    console.log(`[task-runner] Executing task ${payload.task_id}: ${payload.type}`);

    // Simulate execution
    // In production, this would:
    // 1. docker.createContainer() with the task prompt
    // 2. docker.startContainer()
    // 3. Stream logs
    // 4. Wait for completion
    // 5. Collect results

    task.status = 'completed';

    // Report result back to Overmind
    await reportTaskResult(config, {
      task_id: payload.task_id,
      status: 'completed',
      result: { message: 'Task executed successfully' },
      files_changed: [],
    });
  } catch (err) {
    task.status = 'failed';

    await reportTaskResult(config, {
      task_id: payload.task_id,
      status: 'failed',
      error: (err as Error).message,
    });
  } finally {
    activeTasks.delete(payload.task_id);
    updateWorkerCounts(activeTasks.size, activeTasks.size);
  }
}

/**
 * Report a task result back to Overmind (signed).
 */
async function reportTaskResult(
  config: FleetAgentConfig,
  result: {
    task_id: string;
    status: string;
    result?: Record<string, unknown>;
    error?: string;
    files_changed?: string[];
  }
): Promise<void> {
  const url = `${config.overmindUrl}/api/overmind/fleets/task-result`;
  const body = JSON.stringify(result);
  const headers = createSignedHeaders(body, config.apiKey, config.hmacSecret);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      console.log(`[task-runner] Reported result for task ${result.task_id}: ${result.status}`);
    } else {
      console.error(`[task-runner] Failed to report result (${response.status})`);
    }
  } catch (err) {
    console.error(`[task-runner] Cannot reach Overmind to report result:`, (err as Error).message);
  }
}

/**
 * Get current task status (for health endpoint).
 */
export function getTaskStatus(): {
  active: number;
  tasks: Array<{ task_id: string; status: string; started_at: string }>;
} {
  return {
    active: activeTasks.size,
    tasks: Array.from(activeTasks.values()).map(t => ({
      task_id: t.task_id,
      status: t.status,
      started_at: t.started_at.toISOString(),
    })),
  };
}
