/**
 * Overmind Routes — Fleet Registry
 *
 * Endpoints for managing fleet workers: registration, heartbeat,
 * health sweeps, smart routing, and fleet status.
 */
import { Router, Request, Response } from 'express';
import * as fleet from '../../services/overmind/fleet';
import type { FleetWorkerStatus } from '../../services/overmind/fleet';
import * as commands from '../../services/overmind/commands';
import * as warden from '../../services/overmind/context-warden';
import { badRequest, notFound } from './helpers';

export const fleetRouter = Router();

// ── GET /fleet — List all fleet workers (optionally filter by status) ─

fleetRouter.get('/fleet', async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;

  const validStatuses = ['healthy', 'unhealthy', 'quarantined', 'restarting'];
  const filterStatus = validStatuses.includes(status as string)
    ? (status as FleetWorkerStatus)
    : undefined;

  try {
    const workers = await fleet.listWorkers(filterStatus);
    res.json({ workers, total: workers.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to list fleet workers: ${err}` });
  }
});

// ── GET /fleet/status — Aggregate fleet status for dashboard ──────────

fleetRouter.get('/fleet/status', async (_req: Request, res: Response) => {
  try {
    const status = await fleet.getFleetStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: `Failed to get fleet status: ${err}` });
  }
});

// ── GET /fleet/safety — Get fleet safety status ──────────────────────

fleetRouter.get('/fleet/safety', (_req: Request, res: Response) => {
  res.json(fleet.getFleetSafety());
});

// ── POST /fleet/reset-circuit-breaker — Reset the circuit breaker ────

fleetRouter.post('/fleet/reset-circuit-breaker', (_req: Request, res: Response) => {
  fleet.resetCircuitBreaker();
  res.json({ ok: true, message: 'Circuit breaker reset' });
});

// ── GET /fleet/can-spawn — Check if a new worker can be spawned ──────

fleetRouter.get('/fleet/can-spawn', async (_req: Request, res: Response) => {
  try {
    const result = await fleet.canSpawnWorker();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Failed to check spawn status: ${err}` });
  }
});

// ── GET /fleet/best — Find the best worker for a task ─────────────────

fleetRouter.get('/fleet/best', async (req: Request, res: Response) => {
  const caps = req.query.capabilities as string | undefined;
  const requiredCapabilities = caps ? caps.split(',').map(c => c.trim()) : undefined;

  try {
    const worker = await fleet.findBestWorker(requiredCapabilities);
    if (!worker) {
      return res.json({ worker: null, message: 'No available worker found' });
    }
    res.json({ worker });
  } catch (err) {
    res.status(500).json({ error: `Failed to find best worker: ${err}` });
  }
});

// ── GET /fleet/:id — Get a single fleet worker ───────────────────────

fleetRouter.get('/fleet/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);

  try {
    const worker = await fleet.getWorker(id);
    if (!worker) return notFound(res, 'Fleet worker');
    res.json(worker);
  } catch (err) {
    res.status(500).json({ error: `Failed to get fleet worker: ${err}` });
  }
});

// ── POST /fleet/register — Register or update a fleet worker ──────────

fleetRouter.post('/fleet/register', async (req: Request, res: Response) => {
  const { name, url, api_key, capabilities, max_load, metadata } =
    req.body || {};

  if (!name || typeof name !== 'string') {
    return badRequest(res, 'name is required');
  }
  if (!url || typeof url !== 'string') {
    return badRequest(res, 'url is required');
  }

  try {
    const worker = await fleet.registerWorker({
      name,
      url,
      api_key: api_key || undefined,
      capabilities: Array.isArray(capabilities) ? capabilities : undefined,
      max_load: typeof max_load === 'number' ? max_load : undefined,
      metadata: metadata || undefined,
    });

    res.status(201).json(worker);
  } catch (err) {
    const msg = (err as Error).message || String(err);
    // Safety limit errors get 429 (Too Many Requests)
    const statusCode = msg.includes('Fleet safety') ? 429 : 500;
    res.status(statusCode).json({ error: msg });
  }
});

// ── POST /fleet/:id/heartbeat — Record a heartbeat from a worker ──────

fleetRouter.post('/fleet/:id/heartbeat', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { current_load, context_usage, metadata } = req.body || {};

  try {
    const worker = await fleet.recordWorkerHeartbeat(id, {
      current_load: typeof current_load === 'number' ? current_load : undefined,
      context_usage: typeof context_usage === 'number' ? context_usage : undefined,
      metadata: metadata || undefined,
    });

    if (!worker) return notFound(res, 'Fleet worker');
    res.json({ ok: true, worker });
  } catch (err) {
    res.status(500).json({ error: `Failed to record heartbeat: ${err}` });
  }
});

// ── PATCH /fleet/:id — Update worker status ───────────────────────────

fleetRouter.patch('/fleet/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { status } = req.body || {};

  const validStatuses = ['healthy', 'unhealthy', 'quarantined', 'restarting'];
  if (!validStatuses.includes(status)) {
    return badRequest(res, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
  }

  try {
    const worker = await fleet.getWorker(id);
    if (!worker) return notFound(res, 'Fleet worker');

    await fleet.updateWorkerStatus(id, status as FleetWorkerStatus);
    const updated = await fleet.getWorker(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: `Failed to update fleet worker: ${err}` });
  }
});

// ── DELETE /fleet/:id — Remove a fleet worker ─────────────────────────

fleetRouter.delete('/fleet/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);

  try {
    const deleted = await fleet.deleteWorker(id);
    if (!deleted) return notFound(res, 'Fleet worker');
    res.json({ ok: true, deleted_id: id });
  } catch (err) {
    res.status(500).json({ error: `Failed to delete fleet worker: ${err}` });
  }
});

// ── POST /fleet/sweep — Run a health sweep across all workers ─────────

fleetRouter.post('/fleet/sweep', async (_req: Request, res: Response) => {
  try {
    const counts = await fleet.sweepFleetHealth();
    res.json({ ok: true, ...counts });
  } catch (err) {
    res.status(500).json({ error: `Failed to sweep fleet health: ${err}` });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Command Queue Endpoints
// ═══════════════════════════════════════════════════════════════════════

// ── GET /fleet/:id/commands — Poll for pending commands (worker pulls) ─

fleetRouter.get('/fleet/:id/commands', async (req: Request, res: Response) => {
  const workerId = String(req.params.id);

  try {
    const pending = await commands.getPendingCommands(workerId);
    res.json({ commands: pending, count: pending.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to get commands: ${err}` });
  }
});

// ── GET /fleet/:id/commands/history — Command history for a worker ─────

fleetRouter.get('/fleet/:id/commands/history', async (req: Request, res: Response) => {
  const workerId = String(req.params.id);
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

  try {
    const history = await commands.getWorkerCommandHistory(workerId, limit);
    res.json({ commands: history, total: history.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to get command history: ${err}` });
  }
});

// ── POST /fleet/:id/commands — Send a command to a worker ──────────────

fleetRouter.post('/fleet/:id/commands', async (req: Request, res: Response) => {
  const workerId = String(req.params.id);
  const { command, payload, ttl_seconds } = req.body || {};

  const validCommands = ['checkpoint', 'stop', 'restart', 'ping', 'run_task', 'update_config'];
  if (!command || !validCommands.includes(command)) {
    return badRequest(res, `Invalid command. Must be one of: ${validCommands.join(', ')}`);
  }

  try {
    const worker = await fleet.getWorker(workerId);
    if (!worker) return notFound(res, 'Fleet worker');

    const cmd = await commands.sendCommand({
      worker_id: workerId,
      command,
      payload: payload || {},
      ttl_seconds: typeof ttl_seconds === 'number' ? ttl_seconds : undefined,
    });

    res.status(201).json(cmd);
  } catch (err) {
    res.status(500).json({ error: `Failed to send command: ${err}` });
  }
});

// ── POST /fleet/:id/commands/:cmdId/ack — Worker acknowledges a command ─

fleetRouter.post('/fleet/:id/commands/:cmdId/ack', async (req: Request, res: Response) => {
  const cmdId = String(req.params.cmdId);

  try {
    const cmd = await commands.ackCommand(cmdId);
    if (!cmd) return notFound(res, 'Command (or not in pending state)');
    res.json({ ok: true, command: cmd });
  } catch (err) {
    res.status(500).json({ error: `Failed to ACK command: ${err}` });
  }
});

// ── POST /fleet/:id/commands/:cmdId/complete — Worker completes a command

fleetRouter.post('/fleet/:id/commands/:cmdId/complete', async (req: Request, res: Response) => {
  const cmdId = String(req.params.cmdId);
  const { result } = req.body || {};

  try {
    const cmd = await commands.completeCommand(cmdId, result || undefined);
    if (!cmd) return notFound(res, 'Command (or not in acked/running state)');
    res.json({ ok: true, command: cmd });
  } catch (err) {
    res.status(500).json({ error: `Failed to complete command: ${err}` });
  }
});

// ── POST /fleet/:id/commands/:cmdId/fail — Worker reports command failure

fleetRouter.post('/fleet/:id/commands/:cmdId/fail', async (req: Request, res: Response) => {
  const cmdId = String(req.params.cmdId);
  const { error } = req.body || {};

  if (!error || typeof error !== 'string') {
    return badRequest(res, 'error message is required');
  }

  try {
    const cmd = await commands.failCommand(cmdId, error);
    if (!cmd) return notFound(res, 'Command (or not in acked/running state)');
    res.json({ ok: true, command: cmd });
  } catch (err) {
    res.status(500).json({ error: `Failed to fail command: ${err}` });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Checkpoint Endpoints
// ═══════════════════════════════════════════════════════════════════════

// ── POST /fleet/:id/checkpoint — Request a checkpoint (from UI/API) ────

fleetRouter.post('/fleet/:id/checkpoint', async (req: Request, res: Response) => {
  const workerId = String(req.params.id);
  const { reason } = req.body || {};

  try {
    const worker = await fleet.getWorker(workerId);
    if (!worker) return notFound(res, 'Fleet worker');

    const cmd = await warden.requestCheckpoint(workerId, reason || 'manual');
    res.status(201).json({ ok: true, command: cmd });
  } catch (err) {
    res.status(500).json({ error: `Failed to request checkpoint: ${err}` });
  }
});

// ── POST /fleet/:id/restart — Request a restart (from UI/API) ──────────

fleetRouter.post('/fleet/:id/restart', async (req: Request, res: Response) => {
  const workerId = String(req.params.id);
  const { reason } = req.body || {};

  try {
    const worker = await fleet.getWorker(workerId);
    if (!worker) return notFound(res, 'Fleet worker');

    const cmd = await warden.requestRestart(workerId, reason || 'manual');
    res.status(201).json({ ok: true, command: cmd });
  } catch (err) {
    res.status(500).json({ error: `Failed to request restart: ${err}` });
  }
});

// ── POST /fleet/:id/stop — Request a stop (from UI/API) ────────────────

fleetRouter.post('/fleet/:id/stop', async (req: Request, res: Response) => {
  const workerId = String(req.params.id);
  const { reason } = req.body || {};

  try {
    const worker = await fleet.getWorker(workerId);
    if (!worker) return notFound(res, 'Fleet worker');

    const cmd = await warden.requestStop(workerId, reason || 'manual');
    res.status(201).json({ ok: true, command: cmd });
  } catch (err) {
    res.status(500).json({ error: `Failed to request stop: ${err}` });
  }
});

// ── POST /fleet/:id/checkpoints — Record a checkpoint (from worker) ────

fleetRouter.post('/fleet/:id/checkpoints', async (req: Request, res: Response) => {
  const workerId = String(req.params.id);
  const {
    job_id, task_id, context_usage, reason,
    continue_file, spec_tracker, memu_snapshot,
    files_modified, summary, metadata,
  } = req.body || {};

  if (!reason || typeof reason !== 'string') {
    return badRequest(res, 'reason is required');
  }

  try {
    const worker = await fleet.getWorker(workerId);
    if (!worker) return notFound(res, 'Fleet worker');

    const checkpoint = await commands.recordCheckpoint({
      worker_id: workerId,
      job_id: job_id || undefined,
      task_id: task_id || undefined,
      context_usage: typeof context_usage === 'number' ? context_usage : undefined,
      reason,
      continue_file: continue_file || undefined,
      spec_tracker: spec_tracker || undefined,
      memu_snapshot: memu_snapshot || undefined,
      files_modified: Array.isArray(files_modified) ? files_modified : undefined,
      summary: summary || undefined,
      metadata: metadata || undefined,
    });

    res.status(201).json(checkpoint);
  } catch (err) {
    res.status(500).json({ error: `Failed to record checkpoint: ${err}` });
  }
});

// ── GET /fleet/:id/checkpoints — Get checkpoint history for a worker ────

fleetRouter.get('/fleet/:id/checkpoints', async (req: Request, res: Response) => {
  const workerId = String(req.params.id);
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

  try {
    const checkpoints = await commands.getWorkerCheckpoints(workerId, limit);
    res.json({ checkpoints, total: checkpoints.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to get checkpoints: ${err}` });
  }
});

// ── GET /fleet/:id/checkpoints/latest — Get the most recent checkpoint ──

fleetRouter.get('/fleet/:id/checkpoints/latest', async (req: Request, res: Response) => {
  const workerId = String(req.params.id);

  try {
    const checkpoint = await commands.getLatestCheckpoint(workerId);
    if (!checkpoint) return res.json({ checkpoint: null });
    res.json({ checkpoint });
  } catch (err) {
    res.status(500).json({ error: `Failed to get latest checkpoint: ${err}` });
  }
});

// (Safety endpoints registered above, before :id routes)
