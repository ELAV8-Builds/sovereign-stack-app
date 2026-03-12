import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import http from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

import { chatRouter } from './routes/chat';
import { servicesRouter } from './routes/services';
import { settingsRouter } from './routes/settings';
import { toolsRouter } from './routes/tools';
import { codeRouter } from './routes/code';
import { activityRouter } from './routes/activity';
import { healthRouter } from './routes/health';
import { whatsappRouter } from './routes/whatsapp';
import { skillsRouter } from './routes/skills';
import { conversationsRouter } from './routes/conversations';
import { agentRouter } from './routes/agent';
import { fleetRouter } from './routes/fleet';
import { ragRouter } from './routes/rag';
import { voiceRouter } from './routes/voice';
import { scheduleRouter } from './routes/schedule';
import { remotionRouter } from './routes/remotion';
import { workspaceRouter } from './routes/workspace';
import { canvasRouter } from './routes/canvas';
import { integrationsRouter } from './routes/integrations';
import { overmindRouter } from './routes/overmind';
import { runMigration as runOvermindMigration } from './services/overmind/db';
import { initOrchestrator } from './services/overmind/orchestrator';
import { setupActivityBroadcast } from './services/activity-broadcaster';
import { setupOvermindBridge } from './services/overmind/event-bridge';
import { initDatabase } from './services/database';
import { initRedis } from './services/redis';
import { initScheduler } from './services/scheduler';
import { initSlackListener } from './services/slack-listener';

const PORT = parseInt(process.env.PORT || '3100', 10);
const app = express();
const server = http.createServer(app);

// ── WebSocket servers for real-time feeds ────────────────
const wss = new WebSocketServer({ server, path: '/ws/activity' });
const overmindWss = new WebSocketServer({ server, path: '/ws/overmind' });

// ── Middleware ───────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));

// ── Routes ──────────────────────────────────────────────
app.use('/api/chat', chatRouter);
app.use('/api/services', servicesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/tools', toolsRouter);
app.use('/api/code', codeRouter);
app.use('/api/activity', activityRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/agent', agentRouter);
app.use('/api/fleet', fleetRouter);
app.use('/api/rag', ragRouter);
app.use('/api/voice', voiceRouter);
app.use('/api/schedule', scheduleRouter);
app.use('/api/remotion', remotionRouter);
app.use('/api/workspaces', workspaceRouter);
app.use('/api/canvas', canvasRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/overmind', overmindRouter);
app.use('/health', healthRouter);

// ── Start ───────────────────────────────────────────────
async function start() {
  try {
    await initDatabase();
    console.log('✓ Database connected');
  } catch (e) {
    console.warn('⚠ Database connection failed, running in degraded mode:', (e as Error).message);
  }

  try {
    await initRedis();
    console.log('✓ Redis connected');
  } catch (e) {
    console.warn('⚠ Redis connection failed, running in degraded mode:', (e as Error).message);
  }

  try {
    await initScheduler();
    console.log('✓ Scheduler initialized');
  } catch (e) {
    console.warn('⚠ Scheduler initialization failed, running in degraded mode:', (e as Error).message);
  }

  try {
    await runOvermindMigration();
    console.log('✓ Overmind tables initialized');
    initOrchestrator();
  } catch (e) {
    console.warn('⚠ Overmind migration failed, running in degraded mode:', (e as Error).message);
  }

  setupActivityBroadcast(wss);

  try {
    await setupOvermindBridge(overmindWss);
    console.log('✓ Overmind event bridge connected');
  } catch (e) {
    console.warn('⚠ Overmind event bridge failed (live updates unavailable):', (e as Error).message);
  }

  server.listen(PORT, '0.0.0.0', async () => {
    console.log(`
╔══════════════════════════════════════════════╗
║  Sovereign Stack API — v1.0.0               ║
║  Listening on port ${PORT}                    ║
║  WebSocket: ws://0.0.0.0:${PORT}/ws/activity  ║
║  WebSocket: ws://0.0.0.0:${PORT}/ws/overmind  ║
╚══════════════════════════════════════════════╝
    `);

    // Start Slack listener after server is listening (needs /api/overmind/chat available)
    try {
      await initSlackListener();
    } catch (e) {
      console.warn('⚠ Slack listener failed:', (e as Error).message);
    }
  });
}

start();
