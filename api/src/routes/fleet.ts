/**
 * Fleet Mode — Multi-Agent Management
 *
 * Manages multiple logical AI agents, each with their own:
 * - Name and avatar
 * - System prompt (based on template)
 * - Model tier preference
 * - Workspace subdirectory
 * - Conversation history
 *
 * Layer 1: Agents share the same backend process but have isolated state.
 * Layer 2 (future): Each agent runs in its own Docker container.
 */
import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { query, withClient } from '../services/database';
import { logActivity } from '../services/activity-broadcaster';
import {
  enqueueTask,
  getJob,
  getAgentJobs,
  cancelJob,
  getQueueStats,
  getSystemLoad,
  getPipelineJobs,
  generatePipelineId,
} from '../services/task-queue';

export const fleetRouter = Router();

// ── Auto-migrate on first request ────────────────────────────────────

let migrated = false;

async function ensureTables(): Promise<void> {
  if (migrated) return;

  await withClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS fleet_agents (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name TEXT NOT NULL,
        template TEXT NOT NULL DEFAULT 'custom',
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('starting', 'running', 'stopped', 'error')),
        model TEXT NOT NULL DEFAULT 'coder',
        system_prompt TEXT,
        workspace_path TEXT,
        icon TEXT DEFAULT '🤖',
        config JSONB DEFAULT '{}',
        conversation_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ DEFAULT NOW(),
        stopped_at TIMESTAMPTZ,
        last_error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_fleet_agents_status ON fleet_agents(status);
      CREATE INDEX IF NOT EXISTS idx_fleet_agents_template ON fleet_agents(template);
    `);
  });

  migrated = true;
}

// ── Agent Templates ──────────────────────────────────────────────────

interface AgentTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  model: string;
  systemPrompt: string;
  tools: string[];
}

const AGENT_TEMPLATES: Record<string, AgentTemplate> = {
  code_assistant: {
    id: 'code_assistant',
    name: 'Code Assistant',
    icon: '👨‍💻',
    description: 'Full-stack development with git, npm, and testing tools',
    model: 'coder',
    systemPrompt: `You are a specialized Code Assistant agent in the Sovereign Stack fleet. Your focus is software development.

SPECIALIZATION:
- Full-stack development (React, Node.js, Python, Rust, Go)
- Git workflow management (branching, PRs, rebasing)
- Testing (unit tests, integration tests, E2E)
- Build systems (npm, cargo, pip, docker)
- Code review and refactoring

APPROACH:
1. Read existing code before modifying — understand the patterns in place
2. Write clean, typed code with proper error handling
3. Run tests after every change
4. Use git to track your work with clear commit messages
5. Follow the project's existing style and conventions

When asked to implement something:
1. First explore the codebase to understand structure
2. Plan your approach briefly
3. Implement with real code (never mock data)
4. Test and verify your changes
5. Report what you did and any issues found`,
    tools: ['run_terminal_command', 'read_file', 'write_file', 'list_directory', 'search_files', 'git_clone', 'git_status', 'git_commit_and_push'],
  },

  research_agent: {
    id: 'research_agent',
    name: 'Research Agent',
    icon: '🔬',
    description: 'Web research, data analysis, and report generation',
    model: 'medium',
    systemPrompt: `You are a specialized Research Agent in the Sovereign Stack fleet. Your focus is gathering, analyzing, and synthesizing information.

SPECIALIZATION:
- Web research and data gathering
- Data analysis and visualization scripts
- Report generation (markdown, HTML)
- Comparative analysis and summaries
- Fact-checking and source evaluation

APPROACH:
1. Understand the research question thoroughly
2. Break it into searchable sub-questions
3. Gather data from multiple angles
4. Analyze patterns and synthesize findings
5. Present clear, structured reports with citations

When asked to research something:
1. Clarify the scope and expected output format
2. Use terminal tools to search, curl, and process data
3. Write findings to organized markdown files
4. Include sources, methodology, and confidence levels
5. Highlight key findings and actionable insights`,
    tools: ['run_terminal_command', 'read_file', 'write_file', 'list_directory', 'search_files'],
  },

  devops_agent: {
    id: 'devops_agent',
    name: 'DevOps Agent',
    icon: '🛠️',
    description: 'Docker, CI/CD, infrastructure, and deployment management',
    model: 'coder',
    systemPrompt: `You are a specialized DevOps Agent in the Sovereign Stack fleet. Your focus is infrastructure, deployment, and operations.

SPECIALIZATION:
- Docker and Docker Compose management
- CI/CD pipeline configuration (GitHub Actions, GitLab CI)
- Infrastructure as Code (Terraform, Ansible basics)
- Monitoring, logging, and health checks
- Security hardening and secrets management

APPROACH:
1. Audit current infrastructure state before making changes
2. Use infrastructure-as-code principles — everything in version control
3. Test in staging-equivalent before production
4. Document all configuration changes
5. Always have a rollback plan

When asked to set up infrastructure:
1. Assess current state (docker ps, running services, ports)
2. Plan the changes with clear steps
3. Implement incrementally, testing each step
4. Verify health checks pass after changes
5. Document the setup for future reference`,
    tools: ['run_terminal_command', 'read_file', 'write_file', 'list_directory', 'search_files', 'git_status', 'git_commit_and_push'],
  },

  custom: {
    id: 'custom',
    name: 'Custom Agent',
    icon: '📝',
    description: 'Configure tools and workspace from scratch',
    model: 'coder',
    systemPrompt: `You are a custom AI agent in the Sovereign Stack fleet. You have access to the full set of tools and can adapt to any task the user assigns.

Be flexible and responsive to the user's needs. Ask clarifying questions when the task is ambiguous.`,
    tools: ['run_terminal_command', 'read_file', 'write_file', 'list_directory', 'search_files', 'git_clone', 'git_status', 'git_commit_and_push'],
  },
};

// ── Workspace Setup ──────────────────────────────────────────────────

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/workspace';

async function ensureAgentWorkspace(agentId: string): Promise<string> {
  const agentDir = path.join(WORKSPACE_ROOT, 'fleet', agentId);
  try {
    await fs.mkdir(agentDir, { recursive: true });
  } catch {
    // Directory may already exist
  }
  return agentDir;
}

// ── GET /api/fleet/templates — List available templates ──────────────

fleetRouter.get('/templates', (_req: Request, res: Response) => {
  const templates = Object.values(AGENT_TEMPLATES).map(t => ({
    id: t.id,
    name: t.name,
    icon: t.icon,
    description: t.description,
    model: t.model,
    toolCount: t.tools.length,
  }));
  res.json({ templates });
});

// ── GET /api/fleet/agents — List all agents ──────────────────────────

fleetRouter.get('/agents', async (_req: Request, res: Response) => {
  await ensureTables();

  try {
    const result = await query(
      `SELECT
        fa.id, fa.name, fa.template, fa.status, fa.model, fa.icon,
        fa.workspace_path, fa.conversation_id, fa.config, fa.system_prompt,
        fa.created_at, fa.started_at, fa.stopped_at, fa.last_error,
        (SELECT COUNT(*)::int FROM conversation_messages cm
         WHERE cm.conversation_id = fa.conversation_id) AS message_count
      FROM fleet_agents fa
      ORDER BY fa.created_at DESC`
    );

    res.json({ agents: result.rows });
  } catch (err) {
    logActivity('fleet', 'error', `Failed to list agents: ${err}`);
    res.status(500).json({ error: `Failed to list agents: ${err}` });
  }
});

// ── POST /api/fleet/agents — Create and launch a new agent ──────────

fleetRouter.post('/agents', async (req: Request, res: Response) => {
  await ensureTables();

  const { name, template = 'custom', model, customPrompt } = req.body || {};

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }

  const tmpl = AGENT_TEMPLATES[template] || AGENT_TEMPLATES.custom;
  const agentModel = model || tmpl.model;
  const systemPrompt = customPrompt || tmpl.systemPrompt;

  try {
    // Create a conversation for this agent (linked via agent_id)
    // We insert with a placeholder agent_id, then update once we have the real id
    const convResult = await query(
      `INSERT INTO conversations (title) VALUES ($1) RETURNING id`,
      [`${tmpl.icon} ${name}`]
    );
    const conversationId = convResult.rows[0].id;

    // Create the agent record
    const agentResult = await query(
      `INSERT INTO fleet_agents (name, template, model, system_prompt, icon, conversation_id, config)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        name,
        template,
        agentModel,
        systemPrompt,
        tmpl.icon,
        conversationId,
        JSON.stringify({ tools: tmpl.tools }),
      ]
    );

    const agent = agentResult.rows[0];

    // Create workspace directory
    const workspacePath = await ensureAgentWorkspace(agent.id);
    await query(
      `UPDATE fleet_agents SET workspace_path = $1 WHERE id = $2`,
      [workspacePath, agent.id]
    );
    agent.workspace_path = workspacePath;

    // Link conversation back to this agent
    await query(
      `UPDATE conversations SET agent_id = $1 WHERE id = $2`,
      [agent.id, conversationId]
    );

    logActivity('fleet', 'info', `Agent launched: ${name} (${template})`);
    res.status(201).json(agent);
  } catch (err) {
    logActivity('fleet', 'error', `Failed to create agent: ${err}`);
    res.status(500).json({ error: `Failed to create agent: ${err}` });
  }
});

// ── GET /api/fleet/agents/:id — Get single agent details ────────────

fleetRouter.get('/agents/:id', async (req: Request, res: Response) => {
  await ensureTables();
  const id = String(req.params.id);

  try {
    const result = await query(
      `SELECT *,
        (SELECT COUNT(*)::int FROM conversation_messages cm
         WHERE cm.conversation_id = fleet_agents.conversation_id) AS message_count
       FROM fleet_agents WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: `Failed to get agent: ${err}` });
  }
});

// ── PATCH /api/fleet/agents/:id — Update agent (name, status, etc.) ─

fleetRouter.patch('/agents/:id', async (req: Request, res: Response) => {
  await ensureTables();
  const id = String(req.params.id);
  const { name, status, model, icon } = req.body || {};

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (name !== undefined) { updates.push(`name = $${paramIdx++}`); values.push(name); }
  if (status !== undefined) {
    updates.push(`status = $${paramIdx++}`);
    values.push(status);
    if (status === 'stopped') {
      updates.push(`stopped_at = NOW()`);
    } else if (status === 'running') {
      updates.push(`started_at = NOW()`);
      updates.push(`stopped_at = NULL`);
    }
  }
  if (model !== undefined) { updates.push(`model = $${paramIdx++}`); values.push(model); }
  if (icon !== undefined) { updates.push(`icon = $${paramIdx++}`); values.push(icon); }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  values.push(id);

  try {
    const result = await query(
      `UPDATE fleet_agents SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    logActivity('fleet', 'info', `Agent updated: ${result.rows[0].name}`);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: `Failed to update agent: ${err}` });
  }
});

// ── POST /api/fleet/agents/:id/stop — Stop an agent ─────────────────

fleetRouter.post('/agents/:id/stop', async (req: Request, res: Response) => {
  await ensureTables();
  const id = String(req.params.id);

  try {
    const result = await query(
      `UPDATE fleet_agents SET status = 'stopped', stopped_at = NOW()
       WHERE id = $1 AND status = 'running' RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found or already stopped' });
    }

    logActivity('fleet', 'info', `Agent stopped: ${result.rows[0].name}`);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: `Failed to stop agent: ${err}` });
  }
});

// ── POST /api/fleet/agents/:id/start — Restart a stopped agent ──────

fleetRouter.post('/agents/:id/start', async (req: Request, res: Response) => {
  await ensureTables();
  const id = String(req.params.id);

  try {
    const result = await query(
      `UPDATE fleet_agents SET status = 'running', started_at = NOW(), stopped_at = NULL
       WHERE id = $1 AND status = 'stopped' RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found or already running' });
    }

    logActivity('fleet', 'info', `Agent restarted: ${result.rows[0].name}`);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: `Failed to restart agent: ${err}` });
  }
});

// ── DELETE /api/fleet/agents/:id — Destroy agent permanently ────────

fleetRouter.delete('/agents/:id', async (req: Request, res: Response) => {
  await ensureTables();
  const id = String(req.params.id);

  try {
    // Get agent info first (for workspace cleanup)
    const agentResult = await query(
      `SELECT * FROM fleet_agents WHERE id = $1`,
      [id]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const agent = agentResult.rows[0];

    // Delete conversation and messages (CASCADE handles messages)
    if (agent.conversation_id) {
      await query(`DELETE FROM conversations WHERE id = $1`, [agent.conversation_id]);
    }

    // Delete the agent
    await query(`DELETE FROM fleet_agents WHERE id = $1`, [id]);

    // Clean up workspace directory
    if (agent.workspace_path) {
      try {
        await fs.rm(agent.workspace_path, { recursive: true, force: true });
      } catch {
        // Workspace cleanup is best-effort
      }
    }

    logActivity('fleet', 'info', `Agent destroyed: ${agent.name}`);
    res.json({ success: true, name: agent.name });
  } catch (err) {
    res.status(500).json({ error: `Failed to delete agent: ${err}` });
  }
});

// ── POST /api/fleet/agents/:id/chat — Chat with a specific agent ────
// This proxies to the agent engine but injects the fleet agent's system prompt

fleetRouter.post('/agents/:id/chat', async (req: Request, res: Response) => {
  await ensureTables();
  const id = String(req.params.id);
  const { message, history = [] } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    // Load agent config
    const agentResult = await query(
      `SELECT * FROM fleet_agents WHERE id = $1`,
      [id]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const agent = agentResult.rows[0];

    if (agent.status !== 'running') {
      return res.status(400).json({ error: `Agent is ${agent.status}, not running` });
    }

    // Forward to the agent engine with fleet-specific overrides
    // We rewrite the request body and forward internally
    req.body = {
      message,
      conversation_id: agent.conversation_id,
      model: agent.model,
      history,
      // Fleet override: custom system prompt
      system_prompt: agent.system_prompt,
      // Fleet override: workspace root for this agent
      workspace_root: agent.workspace_path || undefined,
    };

    // Import and call the agent handler directly isn't clean,
    // so we forward by redirecting to the agent endpoint
    // But SSE responses can't be easily proxied internally.
    // Instead, use the agent engine's internal functions.

    // For now, we set fleet context headers and redirect
    res.redirect(307, `/api/agent?fleet_agent_id=${id}`);
  } catch (err) {
    res.status(500).json({ error: `Failed to chat with agent: ${err}` });
  }
});

// ── GET /api/fleet/stats — Fleet overview stats ──────────────────────

fleetRouter.get('/stats', async (_req: Request, res: Response) => {
  await ensureTables();

  try {
    const result = await query(`
      SELECT
        COUNT(*)::int AS total_agents,
        COUNT(*) FILTER (WHERE status = 'running')::int AS running_agents,
        COUNT(*) FILTER (WHERE status = 'stopped')::int AS stopped_agents,
        COUNT(*) FILTER (WHERE status = 'error')::int AS error_agents,
        COUNT(DISTINCT template)::int AS template_types
      FROM fleet_agents
    `);

    res.json(result.rows[0]);
  } catch (err) {
    res.json({
      total_agents: 0,
      running_agents: 0,
      stopped_agents: 0,
      error_agents: 0,
      template_types: 0,
    });
  }
});

// ══════════════════════════════════════════════════════════════
// PARALLEL EXECUTION — Background Tasks
// ══════════════════════════════════════════════════════════════

// ── POST /api/fleet/agents/:id/task — Submit a background task ──────

fleetRouter.post('/agents/:id/task', async (req: Request, res: Response) => {
  await ensureTables();
  const id = String(req.params.id);
  const { message } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const agentResult = await query(
      `SELECT * FROM fleet_agents WHERE id = $1`,
      [id]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const agent = agentResult.rows[0];

    if (agent.status !== 'running') {
      return res.status(400).json({ error: `Agent is ${agent.status}, not running` });
    }

    const { dependsOn, pipelineId } = req.body;
    // Enqueue the task — it will run in the background
    const job = await enqueueTask(agent.id, agent.name, message, {
      dependsOn: Array.isArray(dependsOn) ? dependsOn : undefined,
      pipelineId: typeof pipelineId === 'string' ? pipelineId : undefined,
    });

    res.status(202).json(job);
  } catch (err) {
    res.status(500).json({ error: `Failed to submit task: ${err}` });
  }
});

// ── GET /api/fleet/agents/:id/tasks — List agent's tasks ────────────

fleetRouter.get('/agents/:id/tasks', async (req: Request, res: Response) => {
  const id = String(req.params.id);

  try {
    const jobs = await getAgentJobs(id);
    res.json({ jobs });
  } catch (err) {
    res.json({ jobs: [] });
  }
});

// ── GET /api/fleet/jobs/:jobId — Get job status ─────────────────────

fleetRouter.get('/jobs/:jobId', async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);

  const job = await getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json(job);
});

// ── POST /api/fleet/jobs/:jobId/cancel — Cancel a job ───────────────

fleetRouter.post('/jobs/:jobId/cancel', async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);

  const cancelled = await cancelJob(jobId);
  if (!cancelled) {
    return res.status(404).json({ error: 'Job not found or already completed' });
  }

  res.json({ success: true, jobId });
});

// ── GET /api/fleet/queue — Queue stats + system health ──────────────

fleetRouter.get('/queue', async (_req: Request, res: Response) => {
  const stats = await getQueueStats();
  const system = getSystemLoad();

  res.json({
    ...stats,
    system: {
      cpuCount: system.cpuCount,
      loadAvg: Math.round(system.loadAvg * 100) / 100,
      loadPercent: Math.round(system.loadPercent * 100),
      memFreeGB: Math.round(system.memFreeGB * 100) / 100,
    },
  });
});

// ══════════════════════════════════════════════════════════════
// PIPELINES — Multi-stage task chains with dependencies
// ══════════════════════════════════════════════════════════════

// ── POST /api/fleet/pipelines — Create a pipeline of tasks ──────────

interface PipelineTaskDef {
  agentId: string;
  message: string;
  dependsOnIndex?: number[];  // Indices into the tasks array
}

fleetRouter.post('/pipelines', async (req: Request, res: Response) => {
  await ensureTables();
  const { tasks, name } = req.body || {};

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return res.status(400).json({ error: 'tasks array is required and must not be empty' });
  }

  try {
    const pipelineId = generatePipelineId();
    const createdJobs: Array<{ index: number; jobId: string }> = [];

    for (let i = 0; i < tasks.length; i++) {
      const taskDef = tasks[i] as PipelineTaskDef;

      // Look up agent
      const agentResult = await query(
        `SELECT id, name, status FROM fleet_agents WHERE id = $1`,
        [taskDef.agentId]
      );
      if (agentResult.rows.length === 0) {
        return res.status(400).json({ error: `Agent not found: ${taskDef.agentId} (task index ${i})` });
      }
      const agent = agentResult.rows[0];

      // Resolve dependsOnIndex to actual job IDs
      const dependsOn: string[] = [];
      if (taskDef.dependsOnIndex) {
        for (const depIdx of taskDef.dependsOnIndex) {
          const dep = createdJobs.find(j => j.index === depIdx);
          if (!dep) {
            return res.status(400).json({
              error: `Task ${i} depends on index ${depIdx} which hasn't been created yet. Dependencies must reference earlier tasks.`
            });
          }
          dependsOn.push(dep.jobId);
        }
      }

      const job = await enqueueTask(agent.id, agent.name, taskDef.message, {
        dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
        pipelineId,
      });

      createdJobs.push({ index: i, jobId: job.id });
    }

    logActivity('fleet', 'info', `Pipeline created: ${name || pipelineId} (${tasks.length} tasks)`);

    res.status(201).json({
      pipelineId,
      name: name || null,
      taskCount: tasks.length,
      jobs: createdJobs.map(j => ({ index: j.index, jobId: j.jobId })),
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to create pipeline: ${err}` });
  }
});

// ── GET /api/fleet/pipelines/:id — Get pipeline status ──────────────

fleetRouter.get('/pipelines/:id', async (req: Request, res: Response) => {
  const pipelineId = String(req.params.id);

  try {
    const jobs = await getPipelineJobs(pipelineId);
    if (jobs.length === 0) {
      return res.status(404).json({ error: 'Pipeline not found or has no jobs' });
    }

    const completed = jobs.filter(j => j.status === 'completed').length;
    const failed = jobs.filter(j => j.status === 'failed').length;
    const running = jobs.filter(j => j.status === 'running').length;
    const queued = jobs.filter(j => j.status === 'queued').length;

    let overallStatus: string;
    if (failed > 0) overallStatus = 'failed';
    else if (completed === jobs.length) overallStatus = 'completed';
    else if (running > 0) overallStatus = 'running';
    else overallStatus = 'queued';

    res.json({
      pipelineId,
      status: overallStatus,
      progress: { completed, failed, running, queued, total: jobs.length },
      jobs,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to get pipeline: ${err}` });
  }
});
