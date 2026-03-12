/**
 * Fleet Agent — Registration with Overmind
 *
 * On startup, the Fleet Agent announces itself to the central Overmind.
 * This is NOT the initial registration (which creates credentials) —
 * this is the "I'm alive and ready" announcement using existing credentials.
 */

import os from 'os';
import { execSync } from 'child_process';
import type { FleetAgentConfig } from './config';
import { createSignedHeaders } from './security';

/**
 * Announce to Overmind that this Fleet Agent is online and ready.
 * Uses the heartbeat endpoint since registration requires admin access.
 */
export async function announceToOvermind(config: FleetAgentConfig): Promise<boolean> {
  const url = `${config.overmindUrl}/api/overmind/fleets/heartbeat`;

  const body = JSON.stringify({
    workers_active: 0,
    workers_max: config.maxWorkers,
    avg_context_usage: 0,
    capabilities: config.capabilities,
    disk_free_gb: getDiskFreeGb(),
    memory_free_gb: getMemoryFreeGb(),
    docker_containers: 0,
  });

  const headers = createSignedHeaders(body, config.apiKey, config.hmacSecret);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      const data = await response.json() as Record<string, unknown>;
      const fleet = data.fleet as Record<string, unknown> | undefined;
      console.log(`[registration] Announced to Overmind: ${fleet?.fleet_name || 'ok'}`);
      return true;
    }

    const errText = await response.text();
    console.error(`[registration] Overmind rejected announcement (${response.status}): ${errText}`);

    if (response.status === 401) {
      console.error('[registration] FATAL: API key rejected. Check FLEET_API_KEY in .env');
    } else if (response.status === 403) {
      console.error('[registration] FATAL: Fleet is suspended. Contact admin.');
    }

    return false;
  } catch (err) {
    console.error(`[registration] Failed to reach Overmind at ${config.overmindUrl}:`, err);
    return false;
  }
}

/**
 * Deregister from Overmind on graceful shutdown.
 * We don't actually remove the fleet — just signal we're going offline.
 */
export async function deregisterFromOvermind(config: FleetAgentConfig): Promise<void> {
  const url = `${config.overmindUrl}/api/overmind/fleets/heartbeat`;

  const body = JSON.stringify({
    workers_active: 0,
    workers_max: 0,
    capabilities: [],
  });

  const headers = createSignedHeaders(body, config.apiKey, config.hmacSecret);

  try {
    await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(5_000),
    });
    console.log('[registration] Deregistered from Overmind');
  } catch {
    console.warn('[registration] Could not reach Overmind for deregistration (non-critical)');
  }
}

// ---------------------------------------------------------------------------
// System Info Helpers
// ---------------------------------------------------------------------------

function getDiskFreeGb(): number {
  try {
    const output = execSync("df -BG / | tail -1 | awk '{print $4}'", { encoding: 'utf-8' });
    return parseInt(output.replace('G', '')) || 0;
  } catch {
    return 0;
  }
}

function getMemoryFreeGb(): number {
  return Math.round(os.freemem() / (1024 * 1024 * 1024) * 10) / 10;
}
