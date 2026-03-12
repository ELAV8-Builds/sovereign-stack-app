/**
 * Overmind Routes — Agents
 *
 * Endpoints for agent registration, heartbeat, and status management.
 */
import { Router, Request, Response } from 'express';
import * as db from '../../services/overmind/db';
import { recordHeartbeat } from '../../services/overmind/agent-contract';
import type { RegisterAgentInput } from '../../services/overmind/types';
import { badRequest, notFound } from './helpers';

export const agentsRouter = Router();

// ── GET /agents — List all registered agents ─────────────────────────

agentsRouter.get('/agents', async (_req: Request, res: Response) => {
  try {
    const agents = await db.listAgents();
    res.json({ agents, total: agents.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to list agents: ${err}` });
  }
});

// ── GET /agents/:id — Get a single agent ─────────────────────────────

agentsRouter.get('/agents/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);

  try {
    const agent = await db.getAgent(id);
    if (!agent) return notFound(res, 'Agent');
    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: `Failed to get agent: ${err}` });
  }
});

// ── POST /agents/register — Register or re-register an agent ────────

agentsRouter.post('/agents/register', async (req: Request, res: Response) => {
  const { name, location, endpoint, max_concurrent_tasks } =
    req.body as Partial<RegisterAgentInput> || {};

  if (!name || typeof name !== 'string') {
    return badRequest(res, 'name is required');
  }
  if (!endpoint || typeof endpoint !== 'string') {
    return badRequest(res, 'endpoint is required');
  }

  const validLocations = ['local', 'remote', 'cloud'];
  const agentLocation = validLocations.includes(location as string) ? location! : 'local';

  try {
    const agent = await db.registerAgent({
      name,
      location: agentLocation,
      endpoint,
      max_concurrent_tasks: max_concurrent_tasks ?? 1,
    });

    res.status(201).json(agent);
  } catch (err) {
    res.status(500).json({ error: `Failed to register agent: ${err}` });
  }
});

// ── POST /agents/:id/heartbeat — Update agent heartbeat ─────────────

agentsRouter.post('/agents/:id/heartbeat', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { current_load } = req.body || {};

  try {
    const agent = await db.getAgent(id);
    if (!agent) return notFound(res, 'Agent');

    await db.updateAgentHeartbeat(id);
    if (typeof current_load === 'number') {
      await db.updateAgentLoad(id, current_load);
    }

    if (agent.status === 'unhealthy') {
      await db.updateAgentStatus(id, 'healthy');
    }

    res.json({ ok: true, agent_id: id });
  } catch (err) {
    res.status(500).json({ error: `Failed to update heartbeat: ${err}` });
  }
});

// ── PATCH /agents/:id — Update agent status ──────────────────────────

agentsRouter.patch('/agents/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { status } = req.body || {};

  const validStatuses = ['healthy', 'unhealthy', 'quarantined'];
  if (!validStatuses.includes(status)) {
    return badRequest(res, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
  }

  try {
    const agent = await db.getAgent(id);
    if (!agent) return notFound(res, 'Agent');

    await db.updateAgentStatus(id, status);
    const updated = await db.getAgent(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: `Failed to update agent: ${err}` });
  }
});
