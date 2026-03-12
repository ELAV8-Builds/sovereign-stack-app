/**
 * Overmind Routes — Multi-Machine Fleet Registry
 *
 * Endpoints for managing fleet machines (physical/virtual hosts).
 * Security-first: all inbound Fleet Agent requests go through fleet-auth middleware.
 */
import { Router, Request, Response } from 'express';
import * as fleets from '../../services/overmind/fleets';
import type { FleetMachineStatus } from '../../services/overmind/fleets';
import { verifyFleetRequest, verifyAdminRequest, logFleetAudit } from '../../middleware/fleet-auth';
import { query } from '../../services/database';
import { badRequest, notFound } from './helpers';

export const fleetsRouter = Router();

// Apply admin auth to all management routes (non-fleet-agent routes)
const adminAuth = verifyAdminRequest();

// ── POST /fleets/register — Register a new fleet machine ──────────────
// Returns API key + HMAC secret ONCE. Store them securely.

fleetsRouter.post('/fleets/register', adminAuth, async (req: Request, res: Response) => {
  const { fleet_name, machine_name, endpoint, capabilities, max_workers, region, allowed_ips, metadata } = req.body || {};

  if (!fleet_name || typeof fleet_name !== 'string') return badRequest(res, 'fleet_name is required');
  if (fleet_name.length > 64 || !/^[a-zA-Z0-9._-]+$/.test(fleet_name)) {
    return badRequest(res, 'fleet_name must be 1-64 chars, alphanumeric/dash/dot/underscore only');
  }
  if (!machine_name || typeof machine_name !== 'string') return badRequest(res, 'machine_name is required');
  if (machine_name.length > 128) return badRequest(res, 'machine_name too long (max 128)');
  if (!endpoint || typeof endpoint !== 'string') return badRequest(res, 'endpoint is required');
  // Validate endpoint is a proper HTTP(S) URL — prevents SSRF via file:// or metadata URLs
  try {
    const parsed = new URL(endpoint);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return badRequest(res, 'endpoint must be http:// or https://');
    }
    // Block common SSRF targets
    const blocked = ['169.254.169.254', 'metadata.google.internal', '100.100.100.200'];
    if (blocked.includes(parsed.hostname)) {
      return badRequest(res, 'endpoint hostname not allowed');
    }
  } catch {
    return badRequest(res, 'endpoint must be a valid URL');
  }

  try {
    const result = await fleets.registerFleet({
      fleet_name,
      machine_name,
      endpoint,
      capabilities: Array.isArray(capabilities) ? capabilities : undefined,
      max_workers: typeof max_workers === 'number' ? max_workers : undefined,
      region: typeof region === 'string' ? region : undefined,
      allowed_ips: Array.isArray(allowed_ips) ? allowed_ips : undefined,
      metadata: metadata || undefined,
    });

    // SECURITY: This is the ONLY time credentials are returned in plaintext
    res.status(201).json({
      fleet: result.fleet,
      credentials: {
        api_key: result.api_key,
        hmac_secret: result.hmac_secret,
        warning: 'Store these securely. They cannot be retrieved again.',
      },
    });
  } catch (err) {
    const msg = (err as Error).message || String(err);
    const statusCode = msg.includes('limit') ? 429 : msg.includes('unique') ? 409 : 500;
    res.status(statusCode).json({ error: msg });
  }
});

// ── GET /fleets — List all fleet machines ──────────────────────────────

fleetsRouter.get('/fleets', adminAuth, async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const validStatuses = ['healthy', 'unhealthy', 'offline', 'suspended'];
  const filterStatus = validStatuses.includes(status as string) ? (status as FleetMachineStatus) : undefined;

  try {
    const machines = await fleets.listFleetMachines(filterStatus);
    res.json({ fleets: machines, total: machines.length });
  } catch (err) {
    console.error('[fleets] List error:', err);
    res.status(500).json({ error: 'Failed to list fleets' });
  }
});

// ── GET /fleets/dashboard — Fleet dashboard with aggregated stats ──────

fleetsRouter.get('/fleets/dashboard', adminAuth, async (_req: Request, res: Response) => {
  try {
    const dashboard = await fleets.getFleetDashboard();
    res.json(dashboard);
  } catch (err) {
    console.error('[fleets] Dashboard error:', err);
    res.status(500).json({ error: 'Failed to get fleet dashboard' });
  }
});

// ── GET /fleets/best — Find the best fleet for a task ──────────────────

fleetsRouter.get('/fleets/best', adminAuth, async (req: Request, res: Response) => {
  const caps = req.query.capabilities as string | undefined;
  const requiredCapabilities = caps ? caps.split(',').map(c => c.trim()) : undefined;
  const preferLocal = req.query.prefer_local !== 'false';

  try {
    const fleet = await fleets.findBestFleet(requiredCapabilities, preferLocal);
    if (!fleet) {
      res.json({ fleet: null, message: 'No eligible fleet found' });
      return;
    }
    res.json({ fleet });
  } catch (err) {
    console.error('[fleets] Best fleet error:', err);
    res.status(500).json({ error: 'Failed to find best fleet' });
  }
});

// ── POST /fleets/sweep — Run health sweep across all fleet machines ────

fleetsRouter.post('/fleets/sweep', adminAuth, async (_req: Request, res: Response) => {
  try {
    const counts = await fleets.sweepFleetMachineHealth();
    res.json({ ok: true, ...counts });
  } catch (err) {
    console.error('[fleets] Sweep error:', err);
    res.status(500).json({ error: 'Failed to sweep fleet health' });
  }
});

// ── GET /fleets/audit — View fleet audit log ────────────────────────────

fleetsRouter.get('/fleets/audit', adminAuth, async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const fleetId = req.query.fleet_id as string | undefined;

  try {
    let sql = 'SELECT * FROM overmind_fleet_audit';
    const params: unknown[] = [];

    if (fleetId) {
      sql += ' WHERE fleet_id = $1';
      params.push(fleetId);
    }

    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const { rows } = await query(sql, params);
    res.json({ audit: rows, total: rows.length });
  } catch (err) {
    console.error('[fleets] Audit log error:', err);
    res.status(500).json({ error: 'Failed to get audit log' });
  }
});

// ── POST /fleets/heartbeat — Fleet Agent heartbeat (authenticated) ──────

fleetsRouter.post(
  '/fleets/heartbeat',
  verifyFleetRequest('heartbeat'),
  async (req: Request, res: Response) => {
    const fleetId = (req as any).fleetId;

    try {
      const fleet = await fleets.recordFleetHeartbeat(fleetId, req.body || {});
      if (!fleet) return notFound(res, 'Fleet machine');
      res.json({ ok: true, fleet });
    } catch (err) {
      console.error('[fleets] Heartbeat error:', err);
      res.status(500).json({ error: 'Failed to record heartbeat' });
    }
  }
);

// ── POST /fleets/task-result — Fleet Agent reports task result (authenticated)

fleetsRouter.post(
  '/fleets/task-result',
  verifyFleetRequest('task_result'),
  async (req: Request, res: Response) => {
    const fleetId = (req as any).fleetId;
    const { task_id, status, files_changed } = req.body || {};

    if (!task_id) return badRequest(res, 'task_id is required');
    if (!status) return badRequest(res, 'status is required');

    try {
      // Log the result — actual task status update goes through the task system
      await logFleetAudit({
        fleet_id: fleetId,
        direction: 'inbound',
        method: 'POST',
        path: '/fleets/task-result',
        request_id: (req as any).requestId,
        ip_address: req.ip || 'unknown',
      });

      // TODO: Wire into task completion system in Phase 3
      res.json({
        ok: true,
        received: { task_id, status, files_changed: files_changed?.length || 0 },
      });
    } catch (err) {
      console.error('[fleets] Task result error:', err);
      res.status(500).json({ error: 'Failed to process task result' });
    }
  }
);

// ── GET /fleets/:id — Get a single fleet machine ────────────────────────

fleetsRouter.get('/fleets/:id', adminAuth, async (req: Request, res: Response) => {
  try {
    const fleet = await fleets.getFleetMachine(String(req.params.id));
    if (!fleet) return notFound(res, 'Fleet machine');
    res.json(fleet);
  } catch (err) {
    console.error('[fleets] Get fleet error:', err);
    res.status(500).json({ error: 'Failed to get fleet' });
  }
});

// ── PATCH /fleets/:id — Update fleet status ──────────────────────────────

fleetsRouter.patch('/fleets/:id', adminAuth, async (req: Request, res: Response) => {
  const { status } = req.body || {};
  const validStatuses = ['healthy', 'unhealthy', 'offline', 'suspended'];

  if (!validStatuses.includes(status)) {
    return badRequest(res, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
  }

  try {
    const fleet = await fleets.getFleetMachine(String(req.params.id));
    if (!fleet) return notFound(res, 'Fleet machine');

    await fleets.updateFleetStatus(fleet.id, status as FleetMachineStatus);
    const updated = await fleets.getFleetMachine(fleet.id);
    res.json(updated);
  } catch (err) {
    console.error('[fleets] Update fleet error:', err);
    res.status(500).json({ error: 'Failed to update fleet' });
  }
});

// ── DELETE /fleets/:id — Remove a fleet machine ──────────────────────────

fleetsRouter.delete('/fleets/:id', adminAuth, async (req: Request, res: Response) => {
  try {
    const deleted = await fleets.removeFleet(String(req.params.id));
    if (!deleted) return notFound(res, 'Fleet machine');
    res.json({ ok: true, deleted_id: req.params.id });
  } catch (err) {
    console.error('[fleets] Remove fleet error:', err);
    res.status(500).json({ error: 'Failed to remove fleet' });
  }
});

// ── POST /fleets/:id/rotate-key — Rotate API key ────────────────────────

fleetsRouter.post('/fleets/:id/rotate-key', adminAuth, async (req: Request, res: Response) => {
  try {
    const result = await fleets.rotateFleetKey(String(req.params.id));
    if (!result) return notFound(res, 'Fleet machine');
    res.json({
      credentials: {
        api_key: result.api_key,
        warning: 'Old key valid for 5 minutes. Store new key securely.',
      },
    });
  } catch (err) {
    console.error('[fleets] Rotate key error:', err);
    res.status(500).json({ error: 'Failed to rotate key' });
  }
});

// ── POST /fleets/:id/rotate-hmac — Rotate HMAC secret ───────────────────

fleetsRouter.post('/fleets/:id/rotate-hmac', adminAuth, async (req: Request, res: Response) => {
  try {
    const result = await fleets.rotateHmacSecret(String(req.params.id));
    if (!result) return notFound(res, 'Fleet machine');
    res.json({
      credentials: {
        hmac_secret: result.hmac_secret,
        warning: 'Update Fleet Agent .env immediately.',
      },
    });
  } catch (err) {
    console.error('[fleets] Rotate HMAC error:', err);
    res.status(500).json({ error: 'Failed to rotate HMAC secret' });
  }
});

// ── POST /fleets/:id/unsuspend — Re-enable a suspended fleet ─────────────

fleetsRouter.post('/fleets/:id/unsuspend', adminAuth, async (req: Request, res: Response) => {
  try {
    const result = await fleets.unsuspendFleet(String(req.params.id));
    if (!result) {
      res.status(400).json({ error: 'Fleet not found or not suspended' });
      return;
    }
    res.json({
      fleet: result.fleet,
      credentials: {
        api_key: result.api_key,
        hmac_secret: result.hmac_secret,
        warning: 'New credentials generated. Old credentials are invalid.',
      },
    });
  } catch (err) {
    console.error('[fleets] Unsuspend error:', err);
    res.status(500).json({ error: 'Failed to unsuspend fleet' });
  }
});
