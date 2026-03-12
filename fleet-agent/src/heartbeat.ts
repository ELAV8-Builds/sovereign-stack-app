/**
 * Fleet Agent — Heartbeat Loop
 *
 * Sends periodic health reports to Overmind every 30 seconds.
 * If heartbeat fails 3 times consecutively, logs a warning.
 * Never crashes the service — heartbeat is best-effort.
 */

import os from 'os';
import { execSync } from 'child_process';
import type { FleetAgentConfig } from './config';
import { createSignedHeaders } from './security';

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
const MAX_CONSECUTIVE_FAILURES = 3;

let heartbeatTimer: NodeJS.Timeout | null = null;
let consecutiveFailures = 0;
let activeWorkers = 0;
let activeContainers = 0;

/**
 * Start the heartbeat loop.
 */
export function startHeartbeat(config: FleetAgentConfig): void {
  if (heartbeatTimer) {
    console.warn('[heartbeat] Already running');
    return;
  }

  console.log(`[heartbeat] Starting (every ${HEARTBEAT_INTERVAL_MS / 1000}s)`);

  heartbeatTimer = setInterval(async () => {
    await sendHeartbeat(config);
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * Stop the heartbeat loop.
 */
export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log('[heartbeat] Stopped');
  }
}

/**
 * Update the active worker/container counts (called by task-runner).
 */
export function updateWorkerCounts(workers: number, containers: number): void {
  activeWorkers = workers;
  activeContainers = containers;
}

/**
 * Send a single heartbeat to Overmind.
 */
async function sendHeartbeat(config: FleetAgentConfig): Promise<void> {
  const url = `${config.overmindUrl}/api/overmind/fleets/heartbeat`;

  const body = JSON.stringify({
    workers_active: activeWorkers,
    workers_max: config.maxWorkers,
    avg_context_usage: 0, // TODO: aggregate from active workers
    disk_free_gb: getDiskFreeGb(),
    memory_free_gb: Math.round(os.freemem() / (1024 * 1024 * 1024) * 10) / 10,
    docker_containers: activeContainers,
    capabilities: config.capabilities,
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
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
      const status = response.status;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`[heartbeat] ${consecutiveFailures} consecutive failures (last: ${status})`);
      }
      if (status === 401 || status === 403) {
        console.error('[heartbeat] Auth failure — credentials may be invalid or fleet suspended');
      }
    }
  } catch (err) {
    consecutiveFailures++;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error(`[heartbeat] Cannot reach Overmind (${consecutiveFailures} failures):`, (err as Error).message);
    }
  }
}

function getDiskFreeGb(): number {
  try {
    const output = execSync("df -BG / | tail -1 | awk '{print $4}'", { encoding: 'utf-8' });
    return parseInt(output.replace('G', '')) || 0;
  } catch {
    return 0;
  }
}
