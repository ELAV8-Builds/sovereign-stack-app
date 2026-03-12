/**
 * Overmind — Worker Command Queue Service
 *
 * Manages the command queue for native Claude Code workers.
 * Overmind pushes commands (checkpoint, stop, restart, run_task, etc.)
 * and workers poll for pending commands, ACK them, and report results.
 *
 * Flow:
 * 1. Overmind/UI sends a command → INSERT into overmind_worker_commands
 * 2. Worker polls GET /fleet/:id/commands → gets pending commands
 * 3. Worker ACKs → status = 'acked'
 * 4. Worker completes → status = 'completed' (with result) or 'failed' (with error)
 * 5. Context warden expires old commands that were never picked up
 */

import { query } from '../database';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkerCommandType =
  | 'checkpoint'
  | 'stop'
  | 'restart'
  | 'ping'
  | 'run_task'
  | 'update_config';

export type CommandStatus =
  | 'pending'
  | 'acked'
  | 'running'
  | 'completed'
  | 'failed'
  | 'expired';

export interface WorkerCommand {
  id: string;
  worker_id: string;
  command: WorkerCommandType;
  status: CommandStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  expires_at: Date;
  acked_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

export interface SendCommandInput {
  worker_id: string;
  command: WorkerCommandType;
  payload?: Record<string, unknown>;
  /** Override default 5-minute TTL (in seconds) */
  ttl_seconds?: number;
}

export interface WorkerCheckpoint {
  id: string;
  worker_id: string;
  job_id: string | null;
  task_id: string | null;
  context_usage: number;
  reason: string;
  continue_file: string | null;
  spec_tracker: string | null;
  memu_snapshot: string | null;
  files_modified: string[];
  summary: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Row Mappers
// ---------------------------------------------------------------------------

function rowToCommand(row: any): WorkerCommand {
  return {
    id: row.id,
    worker_id: row.worker_id,
    command: row.command,
    status: row.status,
    payload: row.payload || {},
    result: row.result || null,
    error: row.error || null,
    expires_at: row.expires_at,
    acked_at: row.acked_at || null,
    completed_at: row.completed_at || null,
    created_at: row.created_at,
  };
}

function rowToCheckpoint(row: any): WorkerCheckpoint {
  return {
    id: row.id,
    worker_id: row.worker_id,
    job_id: row.job_id || null,
    task_id: row.task_id || null,
    context_usage: parseFloat(row.context_usage) || 0,
    reason: row.reason || 'manual',
    continue_file: row.continue_file || null,
    spec_tracker: row.spec_tracker || null,
    memu_snapshot: row.memu_snapshot || null,
    files_modified: Array.isArray(row.files_modified) ? row.files_modified : [],
    summary: row.summary || '',
    metadata: row.metadata || {},
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Command CRUD
// ---------------------------------------------------------------------------

/**
 * Send a command to a worker. Inserts into the queue with a TTL.
 */
export async function sendCommand(input: SendCommandInput): Promise<WorkerCommand> {
  const ttl = input.ttl_seconds || 300; // Default 5 minutes

  const { rows } = await query(
    `INSERT INTO overmind_worker_commands
       (worker_id, command, payload, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::INTERVAL)
     RETURNING *`,
    [
      input.worker_id,
      input.command,
      JSON.stringify(input.payload || {}),
      String(ttl),
    ]
  );
  return rowToCommand(rows[0]);
}

/**
 * Get pending commands for a worker (poll endpoint).
 * Returns only non-expired pending commands, ordered oldest first.
 */
export async function getPendingCommands(workerId: string): Promise<WorkerCommand[]> {
  const { rows } = await query(
    `SELECT * FROM overmind_worker_commands
     WHERE worker_id = $1
       AND status = 'pending'
       AND expires_at > NOW()
     ORDER BY created_at ASC`,
    [workerId]
  );
  return rows.map(rowToCommand);
}

/**
 * Acknowledge a command — worker confirms receipt.
 */
export async function ackCommand(commandId: string): Promise<WorkerCommand | null> {
  const { rows } = await query(
    `UPDATE overmind_worker_commands
     SET status = 'acked', acked_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [commandId]
  );
  return rows.length > 0 ? rowToCommand(rows[0]) : null;
}

/**
 * Mark a command as running.
 */
export async function markCommandRunning(commandId: string): Promise<WorkerCommand | null> {
  const { rows } = await query(
    `UPDATE overmind_worker_commands
     SET status = 'running'
     WHERE id = $1 AND status IN ('pending', 'acked')
     RETURNING *`,
    [commandId]
  );
  return rows.length > 0 ? rowToCommand(rows[0]) : null;
}

/**
 * Complete a command with an optional result payload.
 */
export async function completeCommand(
  commandId: string,
  result?: Record<string, unknown>
): Promise<WorkerCommand | null> {
  const { rows } = await query(
    `UPDATE overmind_worker_commands
     SET status = 'completed', result = $2, completed_at = NOW()
     WHERE id = $1 AND status IN ('pending', 'acked', 'running')
     RETURNING *`,
    [commandId, result ? JSON.stringify(result) : null]
  );
  return rows.length > 0 ? rowToCommand(rows[0]) : null;
}

/**
 * Fail a command with an error message.
 */
export async function failCommand(
  commandId: string,
  error: string
): Promise<WorkerCommand | null> {
  const { rows } = await query(
    `UPDATE overmind_worker_commands
     SET status = 'failed', error = $2, completed_at = NOW()
     WHERE id = $1 AND status IN ('pending', 'acked', 'running')
     RETURNING *`,
    [commandId, error]
  );
  return rows.length > 0 ? rowToCommand(rows[0]) : null;
}

/**
 * Get a single command by ID.
 */
export async function getCommand(commandId: string): Promise<WorkerCommand | null> {
  const { rows } = await query(
    'SELECT * FROM overmind_worker_commands WHERE id = $1',
    [commandId]
  );
  return rows.length > 0 ? rowToCommand(rows[0]) : null;
}

/**
 * Get recent commands for a worker (all statuses).
 */
export async function getWorkerCommandHistory(
  workerId: string,
  limit: number = 50
): Promise<WorkerCommand[]> {
  const { rows } = await query(
    `SELECT * FROM overmind_worker_commands
     WHERE worker_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [workerId, limit]
  );
  return rows.map(rowToCommand);
}

/**
 * Expire stale commands that were never picked up.
 * Called by the context warden on each tick.
 */
export async function expireStaleCommands(): Promise<number> {
  const result = await query(
    `UPDATE overmind_worker_commands
     SET status = 'expired'
     WHERE status = 'pending'
       AND expires_at < NOW()`
  );
  return result.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Checkpoint CRUD
// ---------------------------------------------------------------------------

/**
 * Record a checkpoint from a worker.
 */
export async function recordCheckpoint(data: {
  worker_id: string;
  job_id?: string;
  task_id?: string;
  context_usage?: number;
  reason: string;
  continue_file?: string;
  spec_tracker?: string;
  memu_snapshot?: string;
  files_modified?: string[];
  summary?: string;
  metadata?: Record<string, unknown>;
}): Promise<WorkerCheckpoint> {
  const { rows } = await query(
    `INSERT INTO overmind_checkpoints
       (worker_id, job_id, task_id, context_usage, reason,
        continue_file, spec_tracker, memu_snapshot, files_modified,
        summary, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      data.worker_id,
      data.job_id || null,
      data.task_id || null,
      data.context_usage || 0,
      data.reason,
      data.continue_file || null,
      data.spec_tracker || null,
      data.memu_snapshot || null,
      JSON.stringify(data.files_modified || []),
      data.summary || '',
      JSON.stringify(data.metadata || {}),
    ]
  );
  return rowToCheckpoint(rows[0]);
}

/**
 * Get checkpoints for a worker (most recent first).
 */
export async function getWorkerCheckpoints(
  workerId: string,
  limit: number = 20
): Promise<WorkerCheckpoint[]> {
  const { rows } = await query(
    `SELECT * FROM overmind_checkpoints
     WHERE worker_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [workerId, limit]
  );
  return rows.map(rowToCheckpoint);
}

/**
 * Get the most recent checkpoint for a worker.
 */
export async function getLatestCheckpoint(
  workerId: string
): Promise<WorkerCheckpoint | null> {
  const { rows } = await query(
    `SELECT * FROM overmind_checkpoints
     WHERE worker_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [workerId]
  );
  return rows.length > 0 ? rowToCheckpoint(rows[0]) : null;
}

/**
 * Get checkpoints for a specific job.
 */
export async function getJobCheckpoints(
  jobId: string
): Promise<WorkerCheckpoint[]> {
  const { rows } = await query(
    `SELECT * FROM overmind_checkpoints
     WHERE job_id = $1
     ORDER BY created_at DESC`,
    [jobId]
  );
  return rows.map(rowToCheckpoint);
}
