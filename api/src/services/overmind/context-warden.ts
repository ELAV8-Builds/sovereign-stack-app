/**
 * Overmind — Context Warden
 *
 * Monitors fleet workers' context usage and triggers lifecycle actions:
 *
 * 1. WARN at 65% — flag worker as "context-warm" (deprioritized for new tasks)
 * 2. CHECKPOINT at 75% — send checkpoint command (save state + CONTINUE.md)
 * 3. RESTART at 85% — send stop command (worker saves, shuts down, supervisor restarts)
 * 4. EXPIRE stale commands that were never picked up
 *
 * Runs as a sub-step of the orchestrator tick (not a separate interval).
 * All thresholds are configurable via the rules engine.
 */

import * as fleet from './fleet';
import * as commands from './commands';
import { publishEvent } from './agent-contract';
import { getActiveRules, getRuleValue } from './orchestrator';

// ---------------------------------------------------------------------------
// Default Thresholds (overridden by rules engine)
// ---------------------------------------------------------------------------

const DEFAULT_WARN_THRESHOLD = 65;
const DEFAULT_CHECKPOINT_THRESHOLD = 75;
const DEFAULT_RESTART_THRESHOLD = 85;

/** Minimum time (ms) between checkpoint commands to the same worker. */
const CHECKPOINT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/** Track when we last sent a checkpoint command to each worker. */
const lastCheckpointSent = new Map<string, number>();

// ---------------------------------------------------------------------------
// Context Warden Tick
// ---------------------------------------------------------------------------

export interface WardenTickResult {
  workers_checked: number;
  warnings_issued: number;
  checkpoints_sent: number;
  restarts_sent: number;
  commands_expired: number;
}

/**
 * Run one cycle of the context warden.
 * Call this from the orchestrator tick loop.
 */
export async function contextWardenTick(): Promise<WardenTickResult> {
  const result: WardenTickResult = {
    workers_checked: 0,
    warnings_issued: 0,
    checkpoints_sent: 0,
    restarts_sent: 0,
    commands_expired: 0,
  };

  try {
    // Load dynamic thresholds from rules engine
    const rules = await getActiveRules();
    const warnAt = getRuleValue(rules, 'context', 'warn_threshold', DEFAULT_WARN_THRESHOLD);
    const checkpointAt = getRuleValue(rules, 'context', 'checkpoint_threshold', DEFAULT_CHECKPOINT_THRESHOLD);
    const restartAt = getRuleValue(rules, 'context', 'restart_threshold', DEFAULT_RESTART_THRESHOLD);

    // Get all workers (not just healthy — we monitor all)
    const workers = await fleet.listWorkers();
    result.workers_checked = workers.length;

    for (const worker of workers) {
      // Skip workers that are already restarting
      if (worker.status === 'restarting') continue;

      const usage = worker.context_usage;

      if (usage >= restartAt) {
        // CRITICAL: Context about to overflow — trigger restart
        await handleRestartNeeded(worker.id, worker.name, usage);
        result.restarts_sent++;
      } else if (usage >= checkpointAt) {
        // HIGH: Save state now, before it gets worse
        const sent = await handleCheckpointNeeded(worker.id, worker.name, usage);
        if (sent) result.checkpoints_sent++;
      } else if (usage >= warnAt) {
        // WARM: Deprioritize for new tasks, but don't interrupt
        result.warnings_issued++;
        // The smart routing in fleet.ts already deprioritizes >65% workers
        // Just publish an event for the UI
        await publishEvent('worker_context_warm', {
          worker_id: worker.id,
          worker_name: worker.name,
          context_usage: usage,
          threshold: warnAt,
        });
      }
    }

    // Expire stale commands
    result.commands_expired = await commands.expireStaleCommands();

  } catch (err) {
    console.error('[context-warden] Tick error:', err);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Action Handlers
// ---------------------------------------------------------------------------

/**
 * Send a checkpoint command to a worker (with cooldown to prevent spam).
 */
async function handleCheckpointNeeded(
  workerId: string,
  workerName: string,
  contextUsage: number
): Promise<boolean> {
  // Check cooldown — don't spam checkpoint commands
  const lastSent = lastCheckpointSent.get(workerId) || 0;
  if (Date.now() - lastSent < CHECKPOINT_COOLDOWN_MS) {
    return false; // Too soon since last checkpoint command
  }

  // Check if there's already a pending/acked checkpoint command
  const pending = await commands.getPendingCommands(workerId);
  const hasCheckpoint = pending.some(
    c => c.command === 'checkpoint' || c.command === 'stop' || c.command === 'restart'
  );
  if (hasCheckpoint) return false;

  // Send the checkpoint command
  await commands.sendCommand({
    worker_id: workerId,
    command: 'checkpoint',
    payload: {
      reason: 'context_high',
      context_usage: contextUsage,
      message: `Context usage at ${contextUsage}%. Save your state now.`,
    },
    ttl_seconds: 300, // 5 min to pick up
  });

  lastCheckpointSent.set(workerId, Date.now());

  await publishEvent('worker_checkpoint_requested', {
    worker_id: workerId,
    worker_name: workerName,
    context_usage: contextUsage,
    reason: 'context_high',
  });

  console.log(
    `[context-warden] Checkpoint command sent to "${workerName}" (context: ${contextUsage}%)`
  );

  return true;
}

/**
 * Send a restart command to a worker (checkpoint first, then restart).
 */
async function handleRestartNeeded(
  workerId: string,
  workerName: string,
  contextUsage: number
): Promise<void> {
  // Check if there's already a pending restart/stop
  const pending = await commands.getPendingCommands(workerId);
  const hasLifecycle = pending.some(
    c => c.command === 'stop' || c.command === 'restart'
  );
  if (hasLifecycle) return;

  // Send restart command (the worker should checkpoint first, then exit)
  await commands.sendCommand({
    worker_id: workerId,
    command: 'restart',
    payload: {
      reason: 'context_critical',
      context_usage: contextUsage,
      message: `Context usage at ${contextUsage}%. Checkpoint and restart immediately.`,
    },
    ttl_seconds: 120, // 2 min — urgent
  });

  // Mark worker as restarting
  await fleet.updateWorkerStatus(workerId, 'restarting');

  await publishEvent('worker_restart_requested', {
    worker_id: workerId,
    worker_name: workerName,
    context_usage: contextUsage,
    reason: 'context_critical',
  });

  console.log(
    `[context-warden] RESTART command sent to "${workerName}" (context: ${contextUsage}%)`
  );
}

// ---------------------------------------------------------------------------
// Manual Actions (called from API routes)
// ---------------------------------------------------------------------------

/**
 * Manually trigger a checkpoint for a worker.
 */
export async function requestCheckpoint(
  workerId: string,
  reason: string = 'manual'
): Promise<commands.WorkerCommand> {
  const cmd = await commands.sendCommand({
    worker_id: workerId,
    command: 'checkpoint',
    payload: { reason, message: 'Manual checkpoint requested.' },
    ttl_seconds: 300,
  });

  const worker = await fleet.getWorker(workerId);
  await publishEvent('worker_checkpoint_requested', {
    worker_id: workerId,
    worker_name: worker?.name || 'unknown',
    reason,
  });

  return cmd;
}

/**
 * Manually trigger a restart for a worker.
 */
export async function requestRestart(
  workerId: string,
  reason: string = 'manual'
): Promise<commands.WorkerCommand> {
  const cmd = await commands.sendCommand({
    worker_id: workerId,
    command: 'restart',
    payload: { reason, message: 'Manual restart requested.' },
    ttl_seconds: 120,
  });

  await fleet.updateWorkerStatus(workerId, 'restarting');

  const worker = await fleet.getWorker(workerId);
  await publishEvent('worker_restart_requested', {
    worker_id: workerId,
    worker_name: worker?.name || 'unknown',
    reason,
  });

  return cmd;
}

/**
 * Manually stop a worker.
 */
export async function requestStop(
  workerId: string,
  reason: string = 'manual'
): Promise<commands.WorkerCommand> {
  const cmd = await commands.sendCommand({
    worker_id: workerId,
    command: 'stop',
    payload: { reason, message: 'Stop requested. Checkpoint and shut down.' },
    ttl_seconds: 120,
  });

  const worker = await fleet.getWorker(workerId);
  await publishEvent('worker_stop_requested', {
    worker_id: workerId,
    worker_name: worker?.name || 'unknown',
    reason,
  });

  return cmd;
}
