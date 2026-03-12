/**
 * Overmind — Fleet Registry Service
 *
 * Manages multiple backend API workers that Overmind can route tasks to.
 * Each worker has:
 * - URL + API key for communication
 * - Capabilities (what it can do)
 * - Current load and max load
 * - Context window usage (for rotation)
 * - Health status based on heartbeats
 *
 * The orchestrator uses the fleet registry to:
 * 1. Route tasks to capable, available workers
 * 2. Monitor context usage and trigger checkpoint/restart
 * 3. Detect and quarantine unhealthy workers
 * 4. Reassign tasks from dead workers
 */

import { query } from '../database';

// ---------------------------------------------------------------------------
// Safety Limits — NON-NEGOTIABLE
// ---------------------------------------------------------------------------

/**
 * HARD LIMIT: Maximum number of fleet workers allowed at any time.
 * This prevents runaway spawning. Cannot be overridden by rules engine.
 * Change ONLY here if you truly need more workers.
 */
const MAX_FLEET_WORKERS = 5;

/**
 * Anti-loop guard: Minimum seconds between spawning new workers.
 * Prevents rapid-fire creation from a runaway orchestrator loop.
 */
const MIN_SPAWN_INTERVAL_MS = 30_000; // 30 seconds
let lastSpawnTime = 0;

/**
 * Circuit breaker: If more than this many spawn attempts fail in a row,
 * block all further spawns until reset manually.
 */
const MAX_CONSECUTIVE_FAILURES = 3;
let consecutiveFailures = 0;
let circuitBreakerOpen = false;

/**
 * Check if we can spawn a new worker (safety gates).
 * Returns { allowed: boolean, reason?: string }
 */
export async function canSpawnWorker(): Promise<{ allowed: boolean; reason?: string }> {
  // Gate 1: Circuit breaker
  if (circuitBreakerOpen) {
    return { allowed: false, reason: 'Circuit breaker open — too many consecutive spawn failures. Reset via API.' };
  }

  // Gate 2: Rate limit
  const now = Date.now();
  if (now - lastSpawnTime < MIN_SPAWN_INTERVAL_MS) {
    const waitSec = Math.ceil((MIN_SPAWN_INTERVAL_MS - (now - lastSpawnTime)) / 1000);
    return { allowed: false, reason: `Rate limited — wait ${waitSec}s before spawning another worker.` };
  }

  // Gate 3: Hard cap
  const workers = await listWorkers();
  const activeCount = workers.filter(w => w.status !== 'quarantined').length;
  if (activeCount >= MAX_FLEET_WORKERS) {
    return { allowed: false, reason: `Fleet at capacity (${activeCount}/${MAX_FLEET_WORKERS}). Remove a worker first.` };
  }

  return { allowed: true };
}

/** Reset the circuit breaker (called via admin API). */
export function resetCircuitBreaker(): void {
  circuitBreakerOpen = false;
  consecutiveFailures = 0;
  console.log('[fleet] Circuit breaker reset');
}

/** Get fleet safety status for the dashboard. */
export function getFleetSafety(): {
  max_workers: number;
  circuit_breaker_open: boolean;
  consecutive_failures: number;
  last_spawn_time: string | null;
  min_spawn_interval_ms: number;
} {
  return {
    max_workers: MAX_FLEET_WORKERS,
    circuit_breaker_open: circuitBreakerOpen,
    consecutive_failures: consecutiveFailures,
    last_spawn_time: lastSpawnTime > 0 ? new Date(lastSpawnTime).toISOString() : null,
    min_spawn_interval_ms: MIN_SPAWN_INTERVAL_MS,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OvFleetWorker {
  id: string;
  name: string;
  url: string;
  api_key: string;
  status: FleetWorkerStatus;
  capabilities: string[];
  current_load: number;
  max_load: number;
  context_usage: number;
  last_heartbeat: Date | null;
  metadata: Record<string, unknown>;
  fleet_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export type FleetWorkerStatus = 'healthy' | 'unhealthy' | 'quarantined' | 'restarting';

export interface RegisterWorkerInput {
  name: string;
  url: string;
  api_key?: string;
  capabilities?: string[];
  max_load?: number;
  metadata?: Record<string, unknown>;
}

export interface HeartbeatInput {
  current_load?: number;
  context_usage?: number;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToWorker(row: any): OvFleetWorker {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    api_key: row.api_key || '',
    status: row.status,
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    current_load: row.current_load || 0,
    max_load: row.max_load || 3,
    context_usage: parseFloat(row.context_usage) || 0,
    last_heartbeat: row.last_heartbeat || null,
    metadata: row.metadata || {},
    fleet_id: row.fleet_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Register a new worker or update an existing one (upsert on URL).
 *
 * SAFETY: Enforces the hard cap of MAX_FLEET_WORKERS before inserting.
 * Existing workers (upsert on URL) bypass the cap since they're re-registering.
 */
export async function registerWorker(input: RegisterWorkerInput): Promise<OvFleetWorker> {
  // Check if this is a NEW worker or a re-registration
  const existing = await query('SELECT id FROM overmind_fleet WHERE url = $1', [input.url]);
  const isNewWorker = existing.rows.length === 0;

  if (isNewWorker) {
    // Enforce safety limits for NEW workers only
    const check = await canSpawnWorker();
    if (!check.allowed) {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        circuitBreakerOpen = true;
        console.error(`[fleet] CIRCUIT BREAKER TRIPPED after ${consecutiveFailures} consecutive failures`);
      }
      throw new Error(`Fleet safety: ${check.reason}`);
    }
  }

  try {
    const { rows } = await query(
      `INSERT INTO overmind_fleet (name, url, api_key, capabilities, max_load, metadata, status, last_heartbeat)
       VALUES ($1, $2, $3, $4, $5, $6, 'healthy', NOW())
       ON CONFLICT (url) DO UPDATE SET
         name = EXCLUDED.name,
         api_key = EXCLUDED.api_key,
         capabilities = EXCLUDED.capabilities,
         max_load = EXCLUDED.max_load,
         metadata = EXCLUDED.metadata,
         status = 'healthy',
         last_heartbeat = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [
        input.name,
        input.url,
        input.api_key || '',
        JSON.stringify(input.capabilities || []),
        input.max_load || 3,
        JSON.stringify(input.metadata || {}),
      ]
    );

    if (isNewWorker) {
      // Success: reset failure counter, record spawn time
      consecutiveFailures = 0;
      lastSpawnTime = Date.now();
      console.log(`[fleet] Worker registered: ${input.name} (${input.url})`);
    }

    return rowToWorker(rows[0]);
  } catch (err) {
    if (isNewWorker) {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        circuitBreakerOpen = true;
        console.error(`[fleet] CIRCUIT BREAKER TRIPPED after ${consecutiveFailures} consecutive failures`);
      }
    }
    throw err;
  }
}

export async function getWorker(id: string): Promise<OvFleetWorker | null> {
  const { rows } = await query('SELECT * FROM overmind_fleet WHERE id = $1', [id]);
  return rows.length > 0 ? rowToWorker(rows[0]) : null;
}

export async function listWorkers(status?: FleetWorkerStatus): Promise<OvFleetWorker[]> {
  if (status) {
    const { rows } = await query(
      'SELECT * FROM overmind_fleet WHERE status = $1 ORDER BY created_at DESC',
      [status]
    );
    return rows.map(rowToWorker);
  }
  const { rows } = await query('SELECT * FROM overmind_fleet ORDER BY created_at DESC');
  return rows.map(rowToWorker);
}

export async function deleteWorker(id: string): Promise<boolean> {
  const result = await query('DELETE FROM overmind_fleet WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

/**
 * Record a heartbeat from a worker. Updates load, context usage, and status.
 */
export async function recordWorkerHeartbeat(
  workerId: string,
  input: HeartbeatInput
): Promise<OvFleetWorker | null> {
  const updates: string[] = ['last_heartbeat = NOW()', 'updated_at = NOW()'];
  const values: unknown[] = [];
  let idx = 1;

  if (input.current_load !== undefined) {
    updates.push(`current_load = $${idx++}`);
    values.push(input.current_load);
  }
  if (input.context_usage !== undefined) {
    updates.push(`context_usage = $${idx++}`);
    values.push(input.context_usage);
  }
  if (input.metadata !== undefined) {
    updates.push(`metadata = $${idx++}`);
    values.push(JSON.stringify(input.metadata));
  }

  // Auto-mark healthy on heartbeat (unless restarting)
  updates.push(`status = CASE WHEN status = 'restarting' THEN status ELSE 'healthy' END`);

  values.push(workerId);

  const { rows } = await query(
    `UPDATE overmind_fleet SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return rows.length > 0 ? rowToWorker(rows[0]) : null;
}

/**
 * Update worker status.
 */
export async function updateWorkerStatus(
  id: string,
  status: FleetWorkerStatus
): Promise<void> {
  await query(
    'UPDATE overmind_fleet SET status = $1, updated_at = NOW() WHERE id = $2',
    [status, id]
  );
}

// ---------------------------------------------------------------------------
// Health Sweep
// ---------------------------------------------------------------------------

/** Timeouts in seconds */
const WORKER_UNHEALTHY_TIMEOUT = 90;
const WORKER_QUARANTINE_TIMEOUT = 300;

/**
 * Sweep all workers and update health status based on heartbeat freshness.
 * Similar to agent health sweep but for fleet workers.
 */
export async function sweepFleetHealth(): Promise<{
  healthy: number;
  unhealthy: number;
  quarantined: number;
  context_hot: number;
}> {
  const workers = await listWorkers();
  const counts = { healthy: 0, unhealthy: 0, quarantined: 0, context_hot: 0 };

  for (const worker of workers) {
    // Skip workers that are actively restarting
    if (worker.status === 'restarting') continue;

    if (!worker.last_heartbeat) {
      // Never had a heartbeat — mark unhealthy
      await updateWorkerStatus(worker.id, 'unhealthy');
      counts.unhealthy++;
      continue;
    }

    const elapsed = (Date.now() - new Date(worker.last_heartbeat).getTime()) / 1000;

    if (elapsed > WORKER_QUARANTINE_TIMEOUT) {
      if (worker.status !== 'quarantined') {
        await updateWorkerStatus(worker.id, 'quarantined');
      }
      counts.quarantined++;
    } else if (elapsed > WORKER_UNHEALTHY_TIMEOUT) {
      if (worker.status !== 'unhealthy') {
        await updateWorkerStatus(worker.id, 'unhealthy');
      }
      counts.unhealthy++;
    } else {
      counts.healthy++;
    }

    // Track context-hot workers (>65% context usage)
    if (worker.context_usage > 65) {
      counts.context_hot++;
    }
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Smart Routing
// ---------------------------------------------------------------------------

/**
 * Find the best worker for a task based on capabilities, load, and context.
 *
 * Routing priority:
 * 1. Must be healthy
 * 2. Must have matching capabilities (if required)
 * 3. Prefer lowest context usage (fresh context = better)
 * 4. Prefer lowest load
 * 5. If context > 65%, deprioritize (context-warm)
 */
export async function findBestWorker(
  requiredCapabilities?: string[],
  fleetId?: string
): Promise<OvFleetWorker | null> {
  const workers = await listWorkers('healthy');

  const available = workers
    .filter(w => w.current_load < w.max_load)
    .filter(w => {
      if (fleetId) return w.fleet_id === fleetId;
      return true;
    })
    .filter(w => {
      if (!requiredCapabilities || requiredCapabilities.length === 0) return true;
      return requiredCapabilities.every(cap => w.capabilities.includes(cap));
    })
    .sort((a, b) => {
      // Deprioritize context-warm workers
      const aWarm = a.context_usage > 65 ? 1 : 0;
      const bWarm = b.context_usage > 65 ? 1 : 0;
      if (aWarm !== bWarm) return aWarm - bWarm;

      // Prefer lower context usage
      const ctxDiff = a.context_usage - b.context_usage;
      if (Math.abs(ctxDiff) > 10) return ctxDiff;

      // Prefer lower load
      return a.current_load - b.current_load;
    });

  return available.length > 0 ? available[0] : null;
}

/**
 * Get a summary of fleet status for the dashboard.
 */
export async function getFleetStatus(): Promise<{
  total: number;
  healthy: number;
  unhealthy: number;
  quarantined: number;
  restarting: number;
  total_load: number;
  total_capacity: number;
  avg_context_usage: number;
}> {
  const workers = await listWorkers();

  const healthy = workers.filter(w => w.status === 'healthy').length;
  const unhealthy = workers.filter(w => w.status === 'unhealthy').length;
  const quarantined = workers.filter(w => w.status === 'quarantined').length;
  const restarting = workers.filter(w => w.status === 'restarting').length;
  const totalLoad = workers.reduce((sum, w) => sum + w.current_load, 0);
  const totalCapacity = workers.reduce((sum, w) => sum + w.max_load, 0);
  const avgContext = workers.length > 0
    ? workers.reduce((sum, w) => sum + w.context_usage, 0) / workers.length
    : 0;

  return {
    total: workers.length,
    healthy,
    unhealthy,
    quarantined,
    restarting,
    total_load: totalLoad,
    total_capacity: totalCapacity,
    avg_context_usage: Math.round(avgContext * 100) / 100,
  };
}
