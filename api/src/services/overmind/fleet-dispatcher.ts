/**
 * Overmind — Fleet Dispatcher
 *
 * Pushes task payloads to remote Fleet Agent endpoints.
 * All requests are HMAC-SHA256 signed with the fleet's credentials.
 *
 * Flow:
 * 1. Orchestrator has a queued task
 * 2. findBestFleet() selects a fleet machine
 * 3. dispatchToFleet() sends the task to that fleet's endpoint
 * 4. Fleet Agent accepts (202) or rejects (429/500)
 * 5. If rejected, try next best fleet or fall back to local agent
 */

import crypto from 'crypto';
import { query } from '../database';
import { signRequest } from '../../middleware/fleet-auth';
import { logFleetAudit } from '../../middleware/fleet-auth';
import { findBestFleet, type OvFleetMachine } from './fleets';
import * as db from './db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DispatchResult {
  dispatched: boolean;
  fleet_id?: string;
  fleet_name?: string;
  error?: string;
  fallback_to_local?: boolean;
}

interface TaskDispatchPayload {
  task_id: string;
  job_id: string;
  type: string;
  prompt: string;
  config: Record<string, unknown>;
  skill_name?: string;
  skill_config?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch a task to the best available fleet.
 * Falls back to local assignment if all remote fleets are full or unreachable.
 */
export async function dispatchTaskToFleet(
  taskId: string,
  requiredCapabilities?: string[]
): Promise<DispatchResult> {
  // Get the task details
  const task = await db.getTask(taskId);
  if (!task) return { dispatched: false, error: 'Task not found' };

  // Find the best fleet
  const fleet = await findBestFleet(requiredCapabilities);
  if (!fleet) {
    return { dispatched: false, error: 'No eligible fleet', fallback_to_local: true };
  }

  // Build the payload
  const payload: TaskDispatchPayload = {
    task_id: task.id,
    job_id: task.job_id,
    type: task.type,
    prompt: (task as any).input_payload?.prompt || task.type,
    config: (task as any).input_payload || {},
    skill_name: (task as any).skill_id || undefined,
  };

  // Send to fleet
  const result = await pushToFleet(fleet, payload);

  if (result.dispatched) {
    // Update task metadata with fleet info
    try {
      await query(
        `UPDATE overmind_tasks SET
          metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
          updated_at = NOW()
         WHERE id = $2`,
        [
          JSON.stringify({
            dispatched_to_fleet: fleet.id,
            fleet_name: fleet.fleet_name,
            dispatched_at: new Date().toISOString(),
          }),
          taskId,
        ]
      );
    } catch (err) {
      console.warn('[fleet-dispatcher] Failed to update task metadata:', err);
    }
  }

  return result;
}

/**
 * Push a task payload to a specific Fleet Agent endpoint.
 */
async function pushToFleet(
  fleet: OvFleetMachine,
  payload: TaskDispatchPayload
): Promise<DispatchResult> {
  const url = `${fleet.endpoint}/tasks/execute`;
  const bodyStr = JSON.stringify(payload);
  const startTime = Date.now();

  // Get the HMAC secret for this specific fleet (per-fleet env var, then shared fallback)
  const fleetEnvKey = `FLEET_HMAC_SECRET_${fleet.fleet_name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const hmacSecret = process.env[fleetEnvKey] || process.env.FLEET_HMAC_SECRET;

  if (!hmacSecret) {
    console.error(`[fleet-dispatcher] No HMAC secret for fleet ${fleet.fleet_name} (checked ${fleetEnvKey} and FLEET_HMAC_SECRET)`);
    return {
      dispatched: false,
      fleet_id: fleet.id,
      fleet_name: fleet.fleet_name,
      error: 'No HMAC secret configured for this fleet',
      fallback_to_local: true,
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Overmind-Signature': signRequest(bodyStr, hmacSecret),
    'X-Request-ID': crypto.randomUUID(),
    'X-Timestamp': new Date().toISOString(),
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: AbortSignal.timeout(15_000), // 15s timeout
    });

    const latency = Date.now() - startTime;

    // Audit log
    await logFleetAudit({
      fleet_id: fleet.id,
      direction: 'outbound',
      method: 'POST',
      path: '/tasks/execute',
      status_code: response.status,
      request_id: headers['X-Request-ID'],
      latency_ms: latency,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    });

    if (response.ok || response.status === 202) {
      console.log(`[fleet-dispatcher] Task ${payload.task_id} dispatched to ${fleet.fleet_name} (${latency}ms)`);
      return {
        dispatched: true,
        fleet_id: fleet.id,
        fleet_name: fleet.fleet_name,
      };
    }

    if (response.status === 429) {
      // Fleet is at capacity — try another fleet
      return {
        dispatched: false,
        fleet_id: fleet.id,
        fleet_name: fleet.fleet_name,
        error: 'Fleet at capacity',
        fallback_to_local: true,
      };
    }

    const errText = await response.text().catch(() => 'unknown');
    return {
      dispatched: false,
      fleet_id: fleet.id,
      fleet_name: fleet.fleet_name,
      error: `HTTP ${response.status}: ${errText}`,
      fallback_to_local: true,
    };
  } catch (err) {
    const latency = Date.now() - startTime;

    await logFleetAudit({
      fleet_id: fleet.id,
      direction: 'outbound',
      method: 'POST',
      path: '/tasks/execute',
      request_id: headers['X-Request-ID'],
      error: (err as Error).message,
      latency_ms: latency,
    });

    console.error(`[fleet-dispatcher] Failed to reach ${fleet.fleet_name}: ${(err as Error).message}`);
    return {
      dispatched: false,
      fleet_id: fleet.id,
      fleet_name: fleet.fleet_name,
      error: (err as Error).message,
      fallback_to_local: true,
    };
  }
}
