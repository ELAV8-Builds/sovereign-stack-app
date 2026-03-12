/**
 * Scheduler Service — Cron, Interval, and One-Time Task Scheduling
 *
 * Manages scheduled tasks stored in PostgreSQL.
 * On startup, loads active tasks and starts their cron/interval/timeout timers.
 * When a task fires, it POSTs to the agent endpoint and logs the result.
 */
import cron, { ScheduledTask as CronJob } from 'node-cron';
import fetch from 'node-fetch';
import { query } from '../services/database';
import { logActivity } from '../services/activity-broadcaster';

// ── Types ────────────────────────────────────────────────────

export interface ScheduledTask {
  id: string;
  agent_id: string | null;
  name: string;
  message: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  max_runs: number | null;
  runs_count: number;
  created_at: string;
  updated_at: string;
}

export interface ScheduledTaskRun {
  id: string;
  task_id: string;
  status: string;
  result: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

// ── In-Memory Job Registry ───────────────────────────────────

// Tracks active cron jobs, intervals, and timeouts so we can stop them
const activeJobs = new Map<string, { stop: () => void }>();

// ── Migration ────────────────────────────────────────────────

let schedulerTablesMigrated = false;

async function ensureSchedulerTables(): Promise<void> {
  if (schedulerTablesMigrated) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        agent_id TEXT,
        name TEXT NOT NULL,
        message TEXT NOT NULL,
        schedule_type TEXT NOT NULL CHECK (schedule_type IN ('cron', 'interval', 'once')),
        schedule_value TEXT NOT NULL,
        is_active BOOLEAN DEFAULT true,
        last_run_at TIMESTAMPTZ,
        next_run_at TIMESTAMPTZ,
        max_runs INT,
        runs_count INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS scheduled_task_runs (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'running',
        result TEXT,
        error TEXT,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        duration_ms INT
      )
    `);

    schedulerTablesMigrated = true;
  } catch (err) {
    console.warn('Scheduler table migration failed:', (err as Error).message);
  }
}

// ── Next Run Calculation ─────────────────────────────────────

function calculateNextRunAt(scheduleType: string, scheduleValue: string): Date | null {
  const now = new Date();

  switch (scheduleType) {
    case 'cron': {
      // For cron, we approximate the next run by parsing the cron expression
      // node-cron doesn't expose a "next run" API, so we use a simple approach:
      // Return null and let the cron library handle timing
      return null;
    }
    case 'interval': {
      const ms = parseInt(scheduleValue, 10);
      if (isNaN(ms) || ms <= 0) return null;
      return new Date(now.getTime() + ms);
    }
    case 'once': {
      const target = new Date(scheduleValue);
      if (isNaN(target.getTime())) return null;
      return target > now ? target : null;
    }
    default:
      return null;
  }
}

// ── Task Execution ───────────────────────────────────────────

async function executeTask(task: ScheduledTask): Promise<void> {
  const startTime = Date.now();
  let runId: string | null = null;

  logActivity('scheduler', 'info', `Firing scheduled task: ${task.name}`);

  try {
    // Create a run record
    const runResult = await query(
      `INSERT INTO scheduled_task_runs (task_id, status) VALUES ($1, 'running') RETURNING id`,
      [task.id]
    );
    runId = runResult.rows[0].id;

    // Update last_run_at and increment runs_count
    await query(
      `UPDATE scheduled_tasks SET last_run_at = NOW(), runs_count = runs_count + 1, updated_at = NOW() WHERE id = $1`,
      [task.id]
    );

    // Calculate and set next_run_at
    const nextRun = calculateNextRunAt(task.schedule_type, task.schedule_value);
    if (nextRun) {
      await query(
        `UPDATE scheduled_tasks SET next_run_at = $1 WHERE id = $2`,
        [nextRun.toISOString(), task.id]
      );
    }

    // Execute: POST to the agent endpoint
    const agentUrl = `http://localhost:3100/api/agent`;
    const response = await fetch(agentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: task.message,
        conversation_id: null,
        model: 'coder',
      }),
    });

    // Read the SSE stream to completion
    const body = await response.text();
    const durationMs = Date.now() - startTime;

    // Update run record as completed
    await query(
      `UPDATE scheduled_task_runs SET status = 'completed', result = $1, completed_at = NOW(), duration_ms = $2 WHERE id = $3`,
      [body.slice(0, 10000), durationMs, runId]
    );

    logActivity('scheduler', 'success', `Task "${task.name}" completed in ${durationMs}ms`);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = (err as Error).message;

    logActivity('scheduler', 'error', `Task "${task.name}" failed: ${errorMsg}`);

    if (runId) {
      try {
        await query(
          `UPDATE scheduled_task_runs SET status = 'failed', error = $1, completed_at = NOW(), duration_ms = $2 WHERE id = $3`,
          [errorMsg, durationMs, runId]
        );
      } catch {
        // Best effort
      }
    }
  }

  // Check if max_runs reached => auto-pause
  try {
    const updated = await query(`SELECT runs_count, max_runs FROM scheduled_tasks WHERE id = $1`, [task.id]);
    if (updated.rows.length > 0) {
      const { runs_count, max_runs } = updated.rows[0];
      if (max_runs !== null && runs_count >= max_runs) {
        logActivity('scheduler', 'info', `Task "${task.name}" reached max_runs (${max_runs}), auto-pausing`);
        await pauseScheduledTask(task.id);
      }
    }
  } catch {
    // Best effort
  }

  // For 'once' type, auto-pause after execution
  if (task.schedule_type === 'once') {
    try {
      await pauseScheduledTask(task.id);
      logActivity('scheduler', 'info', `One-time task "${task.name}" auto-paused after execution`);
    } catch {
      // Best effort
    }
  }
}

// ── Job Lifecycle ────────────────────────────────────────────

function startJob(task: ScheduledTask): void {
  // Stop any existing job for this task
  stopJob(task.id);

  switch (task.schedule_type) {
    case 'cron': {
      if (!cron.validate(task.schedule_value)) {
        logActivity('scheduler', 'error', `Invalid cron expression for task "${task.name}": ${task.schedule_value}`);
        return;
      }
      const job: CronJob = cron.schedule(task.schedule_value, () => {
        void executeTask(task);
      });
      activeJobs.set(task.id, { stop: () => job.stop() });
      break;
    }

    case 'interval': {
      const ms = parseInt(task.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        logActivity('scheduler', 'error', `Invalid interval for task "${task.name}": ${task.schedule_value}`);
        return;
      }
      const intervalId = setInterval(() => {
        void executeTask(task);
      }, ms);
      activeJobs.set(task.id, { stop: () => clearInterval(intervalId) });
      break;
    }

    case 'once': {
      const target = new Date(task.schedule_value);
      const delayMs = target.getTime() - Date.now();
      if (delayMs <= 0) {
        // Already past — execute immediately then pause
        void executeTask(task);
        return;
      }
      const timeoutId = setTimeout(() => {
        void executeTask(task);
      }, delayMs);
      activeJobs.set(task.id, { stop: () => clearTimeout(timeoutId) });
      break;
    }
  }
}

function stopJob(taskId: string): void {
  const job = activeJobs.get(taskId);
  if (job) {
    job.stop();
    activeJobs.delete(taskId);
  }
}

// ── CRUD Operations ──────────────────────────────────────────

export async function createScheduledTask(task: {
  name: string;
  message: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  agent_id?: string;
  max_runs?: number;
  is_active?: boolean;
}): Promise<ScheduledTask> {
  await ensureSchedulerTables();

  const isActive = task.is_active !== undefined ? task.is_active : true;
  const nextRun = calculateNextRunAt(task.schedule_type, task.schedule_value);

  const result = await query(
    `INSERT INTO scheduled_tasks (name, message, schedule_type, schedule_value, agent_id, max_runs, is_active, next_run_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      task.name,
      task.message,
      task.schedule_type,
      task.schedule_value,
      task.agent_id || null,
      task.max_runs || null,
      isActive,
      nextRun ? nextRun.toISOString() : null,
    ]
  );

  const created = result.rows[0] as ScheduledTask;

  if (isActive) {
    startJob(created);
  }

  logActivity('scheduler', 'info', `Scheduled task created: ${created.name} (${created.schedule_type}: ${created.schedule_value})`);
  return created;
}

export async function updateScheduledTask(
  id: string,
  updates: Partial<Pick<ScheduledTask, 'name' | 'message' | 'schedule_type' | 'schedule_value' | 'max_runs' | 'is_active' | 'agent_id'>>
): Promise<ScheduledTask | null> {
  await ensureSchedulerTables();

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (updates.name !== undefined) { setClauses.push(`name = $${paramIdx++}`); values.push(updates.name); }
  if (updates.message !== undefined) { setClauses.push(`message = $${paramIdx++}`); values.push(updates.message); }
  if (updates.schedule_type !== undefined) { setClauses.push(`schedule_type = $${paramIdx++}`); values.push(updates.schedule_type); }
  if (updates.schedule_value !== undefined) { setClauses.push(`schedule_value = $${paramIdx++}`); values.push(updates.schedule_value); }
  if (updates.max_runs !== undefined) { setClauses.push(`max_runs = $${paramIdx++}`); values.push(updates.max_runs); }
  if (updates.is_active !== undefined) { setClauses.push(`is_active = $${paramIdx++}`); values.push(updates.is_active); }
  if (updates.agent_id !== undefined) { setClauses.push(`agent_id = $${paramIdx++}`); values.push(updates.agent_id); }

  if (setClauses.length === 0) return null;

  setClauses.push(`updated_at = NOW()`);
  values.push(id);

  const result = await query(
    `UPDATE scheduled_tasks SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
    values
  );

  if (result.rows.length === 0) return null;

  const updated = result.rows[0] as ScheduledTask;

  // Recalculate next_run_at if schedule changed
  if (updates.schedule_type !== undefined || updates.schedule_value !== undefined) {
    const nextRun = calculateNextRunAt(updated.schedule_type, updated.schedule_value);
    await query(
      `UPDATE scheduled_tasks SET next_run_at = $1 WHERE id = $2`,
      [nextRun ? nextRun.toISOString() : null, id]
    );
    updated.next_run_at = nextRun ? nextRun.toISOString() : null;
  }

  // Restart job if schedule changed or active status changed
  stopJob(id);
  if (updated.is_active) {
    startJob(updated);
  }

  logActivity('scheduler', 'info', `Scheduled task updated: ${updated.name}`);
  return updated;
}

export async function deleteScheduledTask(id: string): Promise<boolean> {
  await ensureSchedulerTables();

  stopJob(id);

  const result = await query(`DELETE FROM scheduled_tasks WHERE id = $1 RETURNING id`, [id]);
  if (result.rows.length === 0) return false;

  logActivity('scheduler', 'info', `Scheduled task deleted: ${id}`);
  return true;
}

export async function pauseScheduledTask(id: string): Promise<ScheduledTask | null> {
  await ensureSchedulerTables();

  stopJob(id);

  const result = await query(
    `UPDATE scheduled_tasks SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );

  if (result.rows.length === 0) return null;

  logActivity('scheduler', 'info', `Scheduled task paused: ${result.rows[0].name}`);
  return result.rows[0] as ScheduledTask;
}

export async function resumeScheduledTask(id: string): Promise<ScheduledTask | null> {
  await ensureSchedulerTables();

  const result = await query(
    `UPDATE scheduled_tasks SET is_active = true, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );

  if (result.rows.length === 0) return null;

  const task = result.rows[0] as ScheduledTask;
  startJob(task);

  // Recalculate next_run_at
  const nextRun = calculateNextRunAt(task.schedule_type, task.schedule_value);
  if (nextRun) {
    await query(
      `UPDATE scheduled_tasks SET next_run_at = $1 WHERE id = $2`,
      [nextRun.toISOString(), id]
    );
  }

  logActivity('scheduler', 'info', `Scheduled task resumed: ${task.name}`);
  return task;
}

export async function listScheduledTasks(agentId?: string): Promise<ScheduledTask[]> {
  await ensureSchedulerTables();

  let result;
  if (agentId) {
    result = await query(
      `SELECT * FROM scheduled_tasks WHERE agent_id = $1 ORDER BY created_at DESC`,
      [agentId]
    );
  } else {
    result = await query(`SELECT * FROM scheduled_tasks ORDER BY created_at DESC`);
  }

  return result.rows as ScheduledTask[];
}

export async function getScheduledTask(id: string): Promise<ScheduledTask | null> {
  await ensureSchedulerTables();

  const result = await query(`SELECT * FROM scheduled_tasks WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;

  return result.rows[0] as ScheduledTask;
}

export async function getTaskRuns(taskId: string): Promise<ScheduledTaskRun[]> {
  await ensureSchedulerTables();

  const result = await query(
    `SELECT * FROM scheduled_task_runs WHERE task_id = $1 ORDER BY started_at DESC LIMIT 50`,
    [taskId]
  );

  return result.rows as ScheduledTaskRun[];
}

// ── Initialization ───────────────────────────────────────────

export async function initScheduler(): Promise<void> {
  await ensureSchedulerTables();

  try {
    const result = await query(`SELECT * FROM scheduled_tasks WHERE is_active = true`);
    const tasks = result.rows as ScheduledTask[];

    for (const task of tasks) {
      startJob(task);
    }

    logActivity('scheduler', 'success', `Scheduler initialized: ${tasks.length} active task(s) loaded`);
    console.log(`Scheduler: ${tasks.length} active task(s) loaded`);
  } catch (err) {
    console.warn('Scheduler initialization failed:', (err as Error).message);
    logActivity('scheduler', 'warning', `Scheduler init failed: ${(err as Error).message}`);
  }
}
