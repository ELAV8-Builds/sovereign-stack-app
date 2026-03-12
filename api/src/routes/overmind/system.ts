/**
 * Overmind Routes — System, Health, Slack & Orchestrator
 *
 * Endpoints for health probes, orchestrator control, Slack integration,
 * and policy headers.
 */
import { Router, Request, Response } from 'express';
import * as db from '../../services/overmind/db';
import {
  processSlackEvent,
  extractPromptFromSlack,
  notifyJobCreated,
  isSlackConfigured,
} from '../../services/overmind/slack';
import {
  getOrchestratorStatus,
  startOrchestrator,
  stopOrchestrator,
  buildPolicyHeaders,
} from '../../services/overmind/orchestrator';
import { createPlannedJob } from '../../services/overmind/llm';
import {
  getSlackListenerStatus,
  reconnectSlackListener,
} from '../../services/slack-listener';

export const systemRouter = Router();

// ── GET /healthz — Liveness probe ────────────────────────────────────

systemRouter.get('/healthz', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'overmind',
    timestamp: new Date().toISOString(),
  });
});

// ── GET /readyz — Readiness probe (checks DB connectivity) ───────────

systemRouter.get('/readyz', async (_req: Request, res: Response) => {
  try {
    await db.listAgents();

    res.json({
      status: 'ready',
      service: 'overmind',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'not_ready',
      service: 'overmind',
      error: `Database check failed: ${err}`,
      timestamp: new Date().toISOString(),
    });
  }
});

// ── POST /slack/events — Receive Slack webhook events ────────────────

systemRouter.post('/slack/events', async (req: Request, res: Response) => {
  try {
    const result = await processSlackEvent(req.body);

    const event = req.body?.event;
    if (event?.text && !req.body.challenge) {
      const prompt = extractPromptFromSlack(event.text);
      if (prompt.length > 5) {
        createPlannedJob(prompt, 'slack').then(async (job) => {
          await notifyJobCreated(job, event.channel, event.thread_ts || event.ts);
        }).catch(err => {
          console.error('[overmind/slack] Failed to create job:', err);
        });
      }
    }

    res.status(result.statusCode).json(result.body);
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err) });
  }
});

// ── GET /slack/status — Check Slack integration status ───────────────

systemRouter.get('/slack/status', (_req: Request, res: Response) => {
  res.json({
    configured: isSlackConfigured(),
    events_url: '/api/overmind/slack/events',
  });
});

// ── GET /slack/listener — Socket Mode listener status ────────────────

systemRouter.get('/slack/listener', (_req: Request, res: Response) => {
  const status = getSlackListenerStatus();
  res.json({
    ...status,
    webhook_configured: isSlackConfigured(),
  });
});

// ── POST /slack/reconnect — Reconnect the Socket Mode listener ───────

systemRouter.post('/slack/reconnect', async (_req: Request, res: Response) => {
  try {
    await reconnectSlackListener();
    const status = getSlackListenerStatus();
    res.json({
      success: true,
      ...status,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: `Reconnect failed: ${err}`,
    });
  }
});

// ── GET /orchestrator/status — Get orchestrator status ────────────────

systemRouter.get('/orchestrator/status', (_req: Request, res: Response) => {
  res.json(getOrchestratorStatus());
});

// ── POST /orchestrator/start — Start the orchestrator loop ───────────

systemRouter.post('/orchestrator/start', (_req: Request, res: Response) => {
  startOrchestrator();
  res.json({ started: true, ...getOrchestratorStatus() });
});

// ── POST /orchestrator/stop — Stop the orchestrator loop ─────────────

systemRouter.post('/orchestrator/stop', (_req: Request, res: Response) => {
  stopOrchestrator();
  res.json({ stopped: true, ...getOrchestratorStatus() });
});

// ── GET /policy — Get the current policy headers ─────────────────────

systemRouter.get('/policy', (_req: Request, res: Response) => {
  res.json({
    headers: buildPolicyHeaders(),
  });
});
