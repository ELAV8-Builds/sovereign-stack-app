import { WebSocketServer, WebSocket } from 'ws';
import { query } from './database';

export interface ActivityEntry {
  id: string;
  agent: string;
  level: 'info' | 'success' | 'warning' | 'error' | 'thinking';
  message: string;
  timestamp: string;
}

let wss: WebSocketServer | null = null;

export function setupActivityBroadcast(server: WebSocketServer): void {
  wss = server;

  wss.on('connection', (ws) => {
    console.log('Activity feed client connected');

    // Send recent activity on connect
    sendRecentActivity(ws);

    ws.on('close', () => {
      console.log('Activity feed client disconnected');
    });
  });
}

async function sendRecentActivity(ws: WebSocket): Promise<void> {
  try {
    const result = await query(
      'SELECT id, agent, level, message, created_at as timestamp FROM agent_activity ORDER BY created_at DESC LIMIT 50'
    );
    const entries = result.rows.reverse();
    ws.send(JSON.stringify({ type: 'history', entries }));
  } catch {
    // Database might not be ready yet
  }
}

export function broadcast(entry: ActivityEntry): void {
  if (!wss) return;

  const message = JSON.stringify({ type: 'activity', entry });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });

  // Persist to database
  persistActivity(entry).catch(() => {});
}

async function persistActivity(entry: ActivityEntry): Promise<void> {
  await query(
    'INSERT INTO agent_activity (agent, level, message) VALUES ($1, $2, $3)',
    [entry.agent, entry.level, entry.message]
  );
}

// Convenience for logging from tools/services
export function logActivity(agent: string, level: ActivityEntry['level'], message: string): void {
  broadcast({
    id: crypto.randomUUID(),
    agent,
    level,
    message,
    timestamp: new Date().toISOString(),
  });
}
