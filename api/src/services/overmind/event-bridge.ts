/**
 * Overmind — Event Bridge (Redis → WebSocket)
 *
 * Subscribes to the `overmind:events` Redis pub/sub channel and
 * forwards every event to connected browser clients over WebSocket.
 *
 * Also sends a snapshot of current state on connect so the frontend
 * has an immediate picture without waiting for the next tick.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { createClient } from 'redis';
import * as db from './db';
import { getOrchestratorStatus } from './orchestrator';
import { listWorkers, getFleetStatus } from './fleet';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const EVENT_CHANNEL = 'overmind:events';

let wss: WebSocketServer | null = null;

/**
 * Set up the Overmind WebSocket bridge.
 * @param server The WebSocketServer bound to /ws/overmind
 */
export async function setupOvermindBridge(server: WebSocketServer): Promise<void> {
  wss = server;

  // Create a dedicated subscriber (Redis requires separate connections for pub/sub)
  let subscriber: ReturnType<typeof createClient> | null = null;

  try {
    subscriber = createClient({ url: REDIS_URL });

    subscriber.on('error', (err) => {
      console.warn('[overmind-bridge] Redis subscriber error:', err.message);
    });

    await subscriber.connect();

    // Subscribe to the Overmind event channel
    await subscriber.subscribe(EVENT_CHANNEL, (message) => {
      broadcast(message);
    });

    console.log('[overmind-bridge] Subscribed to Redis channel:', EVENT_CHANNEL);
  } catch (err) {
    console.warn('[overmind-bridge] Redis subscription failed (events will not stream):', (err as Error).message);
  }

  // Handle new WebSocket connections
  wss.on('connection', (ws) => {
    console.log('[overmind-bridge] Client connected');

    // Send a snapshot of current state
    sendSnapshot(ws);

    ws.on('close', () => {
      console.log('[overmind-bridge] Client disconnected');
    });

    ws.on('error', () => {
      // Swallow errors for individual connections
    });
  });
}

/**
 * Broadcast a raw JSON message to every connected client.
 */
function broadcast(message: string): void {
  if (!wss) return;

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

/**
 * Send an initial snapshot so the client has state immediately on connect.
 */
async function sendSnapshot(ws: WebSocket): Promise<void> {
  try {
    const [jobs, agents, fleetWorkers, fleetStatus] = await Promise.all([
      db.listJobs(),
      db.listAgents(),
      listWorkers().catch(() => []),
      getFleetStatus().catch(() => null),
    ]);

    const orchestrator = getOrchestratorStatus();

    const snapshot = JSON.stringify({
      type: 'snapshot',
      data: {
        jobs: jobs.map(j => ({ id: j.id, title: j.title, status: j.status })),
        agents: agents.map(a => ({
          id: a.id,
          name: a.name,
          status: a.status,
          current_load: a.current_load,
        })),
        fleet: {
          workers: fleetWorkers.map(w => ({
            id: w.id,
            name: w.name,
            status: w.status,
            current_load: w.current_load,
            context_usage: w.context_usage,
          })),
          status: fleetStatus,
        },
        orchestrator,
      },
      timestamp: new Date().toISOString(),
    });

    ws.send(snapshot);
  } catch {
    // Snapshot is best-effort
  }
}

/**
 * Directly push an event to all connected Overmind clients.
 * Use this for events that don't go through Redis (e.g., API actions).
 */
export function pushEvent(type: string, data: Record<string, unknown>): void {
  const message = JSON.stringify({
    type,
    data,
    timestamp: new Date().toISOString(),
  });
  broadcast(message);
}
