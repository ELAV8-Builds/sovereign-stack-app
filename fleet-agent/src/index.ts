/**
 * Sovereign Stack Fleet Agent
 *
 * Lightweight service that runs on each compute node.
 * Registers with the central Overmind, accepts task pushes,
 * manages local Docker containers, and reports results.
 *
 * Port: 3300 (configurable via PORT env var)
 */

import express from 'express';
import https from 'https';
import fs from 'fs';
import { loadConfig, type FleetAgentConfig } from './config';
import { announceToOvermind, deregisterFromOvermind } from './registration';
import { startHeartbeat, stopHeartbeat } from './heartbeat';
import { handleTaskPush, getTaskStatus } from './task-runner';
import { isDockerAvailable, listContainers, cleanupAllContainers } from './docker-manager';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Load Configuration
// ---------------------------------------------------------------------------

const config = loadConfig();

// ---------------------------------------------------------------------------
// Local Admin Auth Middleware
// ---------------------------------------------------------------------------

/**
 * Verify local admin access using FLEET_ADMIN_TOKEN env var.
 * Protects management endpoints (tasks, docker, cleanup).
 */
function requireLocalAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const adminToken = process.env.FLEET_ADMIN_TOKEN;

  // If no token set, restrict to localhost only
  if (!adminToken) {
    const ip = req.ip || req.socket.remoteAddress || '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!isLocal) {
      res.status(403).json({ error: 'Admin access restricted to localhost when FLEET_ADMIN_TOKEN is not set' });
      return;
    }
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Admin authentication required' });
    return;
  }

  const token = authHeader.slice(7);
  const expected = Buffer.from(adminToken, 'utf8');
  const provided = Buffer.from(token, 'utf8');

  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    res.status(403).json({ error: 'Invalid admin token' });
    return;
  }

  next();
}

// ---------------------------------------------------------------------------
// Express App
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: '10mb' }));

// -- Health Endpoint (public but with minimal info) -------------------------

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    fleet_name: config.fleetName,
    active_tasks: getTaskStatus().active,
    max_workers: config.maxWorkers,
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// -- Task Push Endpoint (from Overmind — HMAC verified in handler) ----------

app.post('/tasks/execute', (req, res) => {
  handleTaskPush(req, res, config);
});

// -- Task Status Endpoint (admin only) ------------------------------------

app.get('/tasks', requireLocalAdmin, (_req, res) => {
  res.json(getTaskStatus());
});

// -- Docker Status Endpoint (admin only) ----------------------------------

app.get('/docker', requireLocalAdmin, (_req, res) => {
  res.json({
    available: isDockerAvailable(),
    containers: listContainers(),
  });
});

// -- Cleanup Endpoint (admin only) ----------------------------------------

app.post('/cleanup', requireLocalAdmin, (_req, res) => {
  const cleaned = cleanupAllContainers();
  res.json({ ok: true, cleaned });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  console.log('===================================================================');
  console.log('  Sovereign Stack Fleet Agent');
  console.log(`  Fleet: ${config.fleetName} | Machine: ${config.machineName}`);
  console.log(`  Region: ${config.region} | Port: ${config.port}`);
  console.log(`  Capabilities: ${config.capabilities.join(', ')}`);
  console.log(`  Overmind: ${config.overmindUrl}`);
  console.log('===================================================================');

  // Check Docker
  if (isDockerAvailable()) {
    console.log('[startup] Docker: available');
  } else {
    console.warn('[startup] Docker: NOT available — container management disabled');
  }

  // Start HTTP(S) server
  if (config.tlsCert && config.tlsKey) {
    const cert = fs.readFileSync(config.tlsCert);
    const key = fs.readFileSync(config.tlsKey);
    https.createServer({ cert, key }, app).listen(config.port, () => {
      console.log(`[startup] Fleet Agent listening on https://0.0.0.0:${config.port}`);
    });
  } else {
    app.listen(config.port, () => {
      console.log(`[startup] Fleet Agent listening on http://0.0.0.0:${config.port}`);
    });
  }

  // Announce to Overmind (retry up to 3 times)
  let announced = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    announced = await announceToOvermind(config);
    if (announced) break;
    console.log(`[startup] Retry announcement (${attempt}/3) in 5s...`);
    await new Promise(r => setTimeout(r, 5000));
  }

  if (!announced) {
    console.error('[startup] WARNING: Could not reach Overmind. Will keep retrying via heartbeat.');
  }

  // Start heartbeat loop
  startHeartbeat(config);

  console.log('[startup] Fleet Agent ready');
}

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[shutdown] Received ${signal}. Shutting down gracefully...`);

  // Stop heartbeat
  stopHeartbeat();

  // Clean up containers
  cleanupAllContainers();

  // Deregister from Overmind
  await deregisterFromOvermind(config);

  console.log('[shutdown] Goodbye.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

start().catch(err => {
  console.error('[startup] FATAL:', err);
  process.exit(1);
});
