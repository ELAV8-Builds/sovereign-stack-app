/**
 * Overmind — Multi-Machine Fleet Registry
 *
 * Manages physical/virtual machines that host fleet workers.
 * Each machine runs a Fleet Agent on port 3300 that accepts task pushes.
 *
 * Architecture: Hub-and-Spoke
 * - Mac Studio = brain (Overmind API + DB + orchestrator)
 * - Mac Mini, Cloud VMs, etc. = compute nodes (Fleet Agent only)
 */

import { query } from '../database';
import { hashSecret, generateFleetKey, generateHmacSecret } from '../../middleware/fleet-auth';

// ---------------------------------------------------------------------------
// Safety Limits
// ---------------------------------------------------------------------------

const MAX_FLEETS = 10; // Hard limit on registered machines

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FleetMachineStatus = 'healthy' | 'unhealthy' | 'offline' | 'suspended';

export interface OvFleetMachine {
  id: string;
  fleet_name: string;
  machine_name: string;
  endpoint: string;
  status: FleetMachineStatus;
  capabilities: string[];
  max_workers: number;
  region: string;
  allowed_ips: string[];
  metadata: Record<string, unknown>;
  last_heartbeat: Date | null;
  created_at: Date;
  updated_at: Date;
  // NEVER expose api_key_hash or hmac_secret_hash
}

export interface RegisterFleetInput {
  fleet_name: string;
  machine_name: string;
  endpoint: string;
  capabilities?: string[];
  max_workers?: number;
  region?: string;
  allowed_ips?: string[];
  metadata?: Record<string, unknown>;
}

export interface RegisterFleetResult {
  fleet: OvFleetMachine;
  api_key: string;       // Only returned ONCE at registration
  hmac_secret: string;   // Only returned ONCE at registration
}

export interface FleetHeartbeatInput {
  workers_active?: number;
  workers_max?: number;
  avg_context_usage?: number;
  disk_free_gb?: number;
  memory_free_gb?: number;
  docker_containers?: number;
  capabilities?: string[];
}

// ---------------------------------------------------------------------------
// Row Mapper
// ---------------------------------------------------------------------------

function rowToFleetMachine(row: any): OvFleetMachine {
  return {
    id: row.id,
    fleet_name: row.fleet_name,
    machine_name: row.machine_name,
    endpoint: row.endpoint,
    status: row.status,
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    max_workers: row.max_workers || 3,
    region: row.region || 'local',
    allowed_ips: Array.isArray(row.allowed_ips) ? row.allowed_ips : [],
    metadata: row.metadata || {},
    last_heartbeat: row.last_heartbeat || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Register a new fleet machine. Returns the API key and HMAC secret ONCE.
 * After this, secrets are only stored as hashes and cannot be retrieved.
 */
export async function registerFleet(input: RegisterFleetInput): Promise<RegisterFleetResult> {
  // Safety: check fleet count
  const { rows: existing } = await query('SELECT COUNT(*) as cnt FROM overmind_fleets');
  if (parseInt(existing[0]?.cnt || '0') >= MAX_FLEETS) {
    throw new Error(`Fleet limit reached (${MAX_FLEETS}). Remove a fleet first.`);
  }

  // Generate secrets
  const apiKey = generateFleetKey();
  const hmacSecret = generateHmacSecret();
  const apiKeyHash = hashSecret(apiKey);
  const hmacSecretHash = hashSecret(hmacSecret);

  const { rows } = await query(
    `INSERT INTO overmind_fleets
      (fleet_name, machine_name, endpoint, api_key_hash, hmac_secret_hash, capabilities, max_workers, region, allowed_ips, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.fleet_name,
      input.machine_name,
      input.endpoint,
      apiKeyHash,
      hmacSecretHash,
      JSON.stringify(input.capabilities || []),
      input.max_workers || 3,
      input.region || 'local',
      input.allowed_ips || [],
      JSON.stringify(input.metadata || {}),
    ]
  );

  console.log(`[fleets] Fleet registered: ${input.fleet_name} (${input.endpoint})`);

  return {
    fleet: rowToFleetMachine(rows[0]),
    api_key: apiKey,
    hmac_secret: hmacSecret,
  };
}

export async function getFleetMachine(id: string): Promise<OvFleetMachine | null> {
  const { rows } = await query('SELECT * FROM overmind_fleets WHERE id = $1', [id]);
  return rows.length > 0 ? rowToFleetMachine(rows[0]) : null;
}

export async function getFleetByName(name: string): Promise<OvFleetMachine | null> {
  const { rows } = await query('SELECT * FROM overmind_fleets WHERE fleet_name = $1', [name]);
  return rows.length > 0 ? rowToFleetMachine(rows[0]) : null;
}

export async function listFleetMachines(status?: FleetMachineStatus): Promise<OvFleetMachine[]> {
  if (status) {
    const { rows } = await query(
      'SELECT * FROM overmind_fleets WHERE status = $1 ORDER BY created_at DESC',
      [status]
    );
    return rows.map(rowToFleetMachine);
  }
  const { rows } = await query('SELECT * FROM overmind_fleets ORDER BY created_at DESC');
  return rows.map(rowToFleetMachine);
}

export async function listHealthyFleets(): Promise<OvFleetMachine[]> {
  return listFleetMachines('healthy');
}

/**
 * Record a heartbeat from a Fleet Agent. Updates status and metadata.
 */
export async function recordFleetHeartbeat(
  fleetId: string,
  input: FleetHeartbeatInput
): Promise<OvFleetMachine | null> {
  const meta: Record<string, unknown> = {};
  if (input.workers_active !== undefined) meta.workers_active = input.workers_active;
  if (input.workers_max !== undefined) meta.workers_max = input.workers_max;
  if (input.avg_context_usage !== undefined) meta.avg_context_usage = input.avg_context_usage;
  if (input.disk_free_gb !== undefined) meta.disk_free_gb = input.disk_free_gb;
  if (input.memory_free_gb !== undefined) meta.memory_free_gb = input.memory_free_gb;
  if (input.docker_containers !== undefined) meta.docker_containers = input.docker_containers;

  const updates: string[] = [
    'last_heartbeat = NOW()',
    'updated_at = NOW()',
    "status = CASE WHEN status = 'suspended' THEN status ELSE 'healthy' END",
  ];
  const values: unknown[] = [];
  let idx = 1;

  if (Object.keys(meta).length > 0) {
    updates.push(`metadata = metadata || $${idx++}::jsonb`);
    values.push(JSON.stringify(meta));
  }

  if (input.capabilities) {
    updates.push(`capabilities = $${idx++}::jsonb`);
    values.push(JSON.stringify(input.capabilities));
  }

  values.push(fleetId);

  const { rows } = await query(
    `UPDATE overmind_fleets SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  return rows.length > 0 ? rowToFleetMachine(rows[0]) : null;
}

/**
 * Update fleet status manually.
 */
export async function updateFleetStatus(id: string, status: FleetMachineStatus): Promise<void> {
  await query(
    'UPDATE overmind_fleets SET status = $1, updated_at = NOW() WHERE id = $2',
    [status, id]
  );
}

/**
 * Remove a fleet machine.
 */
export async function removeFleet(id: string): Promise<boolean> {
  // First, unlink any workers from this fleet
  await query('UPDATE overmind_fleet SET fleet_id = NULL WHERE fleet_id = $1', [id]);
  const result = await query('DELETE FROM overmind_fleets WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Rotate API key for a fleet. Returns the new key ONCE.
 * Old key remains valid for 5 minutes (grace period).
 */
export async function rotateFleetKey(id: string): Promise<{ api_key: string } | null> {
  const fleet = await getFleetMachine(id);
  if (!fleet) return null;

  const newApiKey = generateFleetKey();
  const newHash = hashSecret(newApiKey);

  // Store the old hash temporarily in metadata for grace period
  const { rows: current } = await query('SELECT api_key_hash FROM overmind_fleets WHERE id = $1', [id]);
  const oldHash = current[0]?.api_key_hash;

  await query(
    `UPDATE overmind_fleets SET
      api_key_hash = $1,
      metadata = metadata || $2::jsonb,
      updated_at = NOW()
     WHERE id = $3`,
    [
      newHash,
      JSON.stringify({ _old_key_hash: oldHash, _key_rotated_at: new Date().toISOString() }),
      id,
    ]
  );

  // Schedule cleanup of old key after 5 minutes
  const cleanupTimer = setTimeout(async () => {
    try {
      await query(
        `UPDATE overmind_fleets SET metadata = metadata - '_old_key_hash' - '_key_rotated_at' WHERE id = $1`,
        [id]
      );
    } catch { /* non-critical */ }
  }, 5 * 60 * 1000);
  if (cleanupTimer.unref) cleanupTimer.unref();

  console.log(`[fleets] API key rotated for fleet: ${fleet.fleet_name}`);
  return { api_key: newApiKey };
}

/**
 * Rotate HMAC secret for a fleet. Returns the new secret ONCE.
 */
export async function rotateHmacSecret(id: string): Promise<{ hmac_secret: string } | null> {
  const fleet = await getFleetMachine(id);
  if (!fleet) return null;

  const newSecret = generateHmacSecret();
  const newHash = hashSecret(newSecret);

  await query(
    'UPDATE overmind_fleets SET hmac_secret_hash = $1, updated_at = NOW() WHERE id = $2',
    [newHash, id]
  );

  console.log(`[fleets] HMAC secret rotated for fleet: ${fleet.fleet_name}`);
  return { hmac_secret: newSecret };
}

/**
 * Re-enable a suspended fleet. Requires key rotation.
 */
export async function unsuspendFleet(id: string): Promise<RegisterFleetResult | null> {
  const fleet = await getFleetMachine(id);
  if (!fleet) return null;
  if (fleet.status !== 'suspended') return null;

  // Force key + secret rotation
  const newApiKey = generateFleetKey();
  const newHmacSecret = generateHmacSecret();

  await query(
    `UPDATE overmind_fleets SET
      status = 'healthy',
      api_key_hash = $1,
      hmac_secret_hash = $2,
      updated_at = NOW()
     WHERE id = $3`,
    [hashSecret(newApiKey), hashSecret(newHmacSecret), id]
  );

  console.log(`[fleets] Fleet unsuspended with new credentials: ${fleet.fleet_name}`);

  return {
    fleet: { ...fleet, status: 'healthy' },
    api_key: newApiKey,
    hmac_secret: newHmacSecret,
  };
}

// ---------------------------------------------------------------------------
// Health Sweep
// ---------------------------------------------------------------------------

const FLEET_UNHEALTHY_TIMEOUT_S = 120;  // 2 minutes (4 missed heartbeats at 30s interval)
const FLEET_OFFLINE_TIMEOUT_S = 600;    // 10 minutes

export async function sweepFleetMachineHealth(): Promise<{
  healthy: number;
  unhealthy: number;
  offline: number;
  suspended: number;
}> {
  const fleets = await listFleetMachines();
  const counts = { healthy: 0, unhealthy: 0, offline: 0, suspended: 0 };

  for (const f of fleets) {
    if (f.status === 'suspended') {
      counts.suspended++;
      continue;
    }

    if (!f.last_heartbeat) {
      await updateFleetStatus(f.id, 'unhealthy');
      counts.unhealthy++;
      continue;
    }

    const elapsed = (Date.now() - new Date(f.last_heartbeat).getTime()) / 1000;

    if (elapsed > FLEET_OFFLINE_TIMEOUT_S) {
      if (f.status !== 'offline') await updateFleetStatus(f.id, 'offline');
      counts.offline++;
    } else if (elapsed > FLEET_UNHEALTHY_TIMEOUT_S) {
      if (f.status !== 'unhealthy') await updateFleetStatus(f.id, 'unhealthy');
      counts.unhealthy++;
    } else {
      counts.healthy++;
    }
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Smart Fleet Routing
// ---------------------------------------------------------------------------

/**
 * Find the best fleet to send a task to.
 *
 * Priority:
 * 1. Must be healthy
 * 2. Must have matching capabilities
 * 3. Prefer local fleet (region = 'local')
 * 4. Prefer fleet with more available capacity
 * 5. Prefer fleet with lower avg context usage
 */
export async function findBestFleet(
  requiredCapabilities?: string[],
  preferLocal: boolean = true
): Promise<OvFleetMachine | null> {
  const fleets = await listHealthyFleets();

  const eligible = fleets
    .filter(f => {
      if (!requiredCapabilities || requiredCapabilities.length === 0) return true;
      return requiredCapabilities.every(cap => f.capabilities.includes(cap));
    })
    .sort((a, b) => {
      // 1. Prefer local fleet
      if (preferLocal) {
        const aLocal = a.region === 'local' ? 0 : 1;
        const bLocal = b.region === 'local' ? 0 : 1;
        if (aLocal !== bLocal) return aLocal - bLocal;
      }

      // 2. Prefer fleet with more capacity (lower utilization)
      const aWorkers = (a.metadata as any)?.workers_active || 0;
      const bWorkers = (b.metadata as any)?.workers_active || 0;
      const aUtil = a.max_workers > 0 ? aWorkers / a.max_workers : 1;
      const bUtil = b.max_workers > 0 ? bWorkers / b.max_workers : 1;
      if (Math.abs(aUtil - bUtil) > 0.2) return aUtil - bUtil;

      // 3. Prefer lower context usage
      const aCtx = (a.metadata as any)?.avg_context_usage || 0;
      const bCtx = (b.metadata as any)?.avg_context_usage || 0;
      return aCtx - bCtx;
    });

  return eligible.length > 0 ? eligible[0] : null;
}

/**
 * Get fleet dashboard status.
 */
export async function getFleetDashboard(): Promise<{
  total: number;
  healthy: number;
  unhealthy: number;
  offline: number;
  suspended: number;
  total_workers_active: number;
  total_workers_capacity: number;
  fleets: OvFleetMachine[];
}> {
  const fleets = await listFleetMachines();

  let totalWorkersActive = 0;
  let totalWorkersCapacity = 0;

  for (const f of fleets) {
    totalWorkersActive += (f.metadata as any)?.workers_active || 0;
    totalWorkersCapacity += f.max_workers;
  }

  return {
    total: fleets.length,
    healthy: fleets.filter(f => f.status === 'healthy').length,
    unhealthy: fleets.filter(f => f.status === 'unhealthy').length,
    offline: fleets.filter(f => f.status === 'offline').length,
    suspended: fleets.filter(f => f.status === 'suspended').length,
    total_workers_active: totalWorkersActive,
    total_workers_capacity: totalWorkersCapacity,
    fleets,
  };
}
