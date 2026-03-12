/**
 * Overmind Routes — Tasks, Polling & Cleanup
 *
 * Endpoints for task CRUD, agent polling, cleanup reports,
 * and the Do-Not-Trust lifecycle.
 */
import { Router, Request, Response } from 'express';
import * as db from '../../services/overmind/db';
import {
  validateTaskCompletion,
  handleTaskFailure,
  recoverStuckTasks,
  getQueueDepths,
  orchestratorTick,
  checkJobCompletion,
} from '../../services/overmind/agent-contract';
import {
  analyzeCleanup,
  decideNextAction,
  detectResistance,
  getPassConfig,
} from '../../services/overmind/llm';
import type {
  TaskType,
  TaskOverrideInput,
  TaskStatusUpdate,
} from '../../services/overmind/types';
import { badRequest, notFound } from './helpers';

export const tasksRouter = Router();

// ── GET /tasks/:id — Get a single task with cleanup reports ──────────

tasksRouter.get('/tasks/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);

  try {
    const task = await db.getTask(id);
    if (!task) return notFound(res, 'Task');

    const cleanup_reports = await db.getCleanupReportsForTask(id);
    res.json({ ...task, cleanup_reports });
  } catch (err) {
    res.status(500).json({ error: `Failed to get task: ${err}` });
  }
});

// ── PATCH /tasks/:id — Update task status (agent callback) ──────────

tasksRouter.patch('/tasks/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { status, result, error } = req.body as Partial<TaskStatusUpdate> || {};

  const validStatuses = [
    'pending', 'queued', 'running', 'awaiting_cleanup', 'iterating',
    'completed', 'escalated', 'failed',
  ];
  if (!status || !validStatuses.includes(status)) {
    return badRequest(res, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
  }

  try {
    const task = await db.getTask(id);
    if (!task) return notFound(res, 'Task');

    await db.updateTaskStatus(id, status);

    if (status === 'completed' && result) {
      await db.completeTask(id, result);
    }

    if ((status === 'failed' || status === 'escalated') && error) {
      await db.failTask(id, error);
    }

    const updated = await db.getTask(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: `Failed to update task: ${err}` });
  }
});

// ── POST /tasks/:id/override — Override task parameters ──────────────

tasksRouter.post('/tasks/:id/override', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { skill_name, skill_config, prompt, max_iterations } =
    req.body as Partial<TaskOverrideInput> || {};

  try {
    const task = await db.getTask(id);
    if (!task) return notFound(res, 'Task');

    if (!['pending', 'queued'].includes(task.status)) {
      return badRequest(res, `Cannot override task in status '${task.status}'. Task must be pending or queued.`);
    }

    await db.overrideTask(id, { skill_name, skill_config, prompt, max_iterations });
    const updated = await db.getTask(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: `Failed to override task: ${err}` });
  }
});

// ── POST /tasks/:id/iterate — Bump the iteration counter ────────────

tasksRouter.post('/tasks/:id/iterate', async (req: Request, res: Response) => {
  const id = String(req.params.id);

  try {
    const task = await db.getTask(id);
    if (!task) return notFound(res, 'Task');

    if (!['running', 'awaiting_cleanup', 'iterating'].includes(task.status)) {
      return badRequest(res, `Cannot iterate task in status '${task.status}'`);
    }

    const newIteration = await db.incrementTaskIteration(id);
    await db.updateTaskStatus(id, 'iterating');

    if (newIteration >= task.max_iterations) {
      await db.updateTaskStatus(id, 'escalated');
      await db.failTask(id, `Max iterations (${task.max_iterations}) reached`);
      return res.json({
        task_id: id,
        iteration: newIteration,
        max_iterations: task.max_iterations,
        escalated: true,
        message: 'Task escalated — max iterations reached',
      });
    }

    res.json({
      task_id: id,
      iteration: newIteration,
      max_iterations: task.max_iterations,
      escalated: false,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to iterate task: ${err}` });
  }
});

// ── GET /tasks/poll — Agent polls for available tasks ────────────────

tasksRouter.get('/tasks/poll', async (req: Request, res: Response) => {
  const agent_id = req.query.agent_id as string;
  const typesParam = req.query.types as string | undefined;
  const limitParam = req.query.limit as string | undefined;

  if (!agent_id) {
    return badRequest(res, 'agent_id query parameter is required');
  }

  try {
    const agent = await db.getAgent(agent_id);
    if (!agent) return notFound(res, 'Agent');
    if (agent.status !== 'healthy') {
      return badRequest(res, `Agent is ${agent.status}, cannot accept tasks`);
    }

    if (agent.current_load >= agent.max_concurrent_tasks) {
      return res.json({ tasks: [], message: 'Agent at capacity' });
    }

    const types = typesParam
      ? (typesParam.split(',').filter(Boolean) as TaskType[])
      : undefined;
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    const availableTasks = await db.pollTasks(agent_id, types, limit);

    const claimed: typeof availableTasks = [];
    for (const task of availableTasks) {
      if (agent.current_load + claimed.length >= agent.max_concurrent_tasks) break;

      await db.assignTask(task.id, agent_id);
      await db.updateTaskStatus(task.id, 'running');
      claimed.push({ ...task, agent_id, status: 'running' });
    }

    if (claimed.length > 0) {
      await db.updateAgentLoad(agent_id, agent.current_load + claimed.length);
    }

    res.json({ tasks: claimed, total: claimed.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to poll tasks: ${err}` });
  }
});

// ── POST /tasks/:id/cleanup — Submit a cleanup report for a task ─────

tasksRouter.post('/tasks/:id/cleanup', async (req: Request, res: Response) => {
  const taskId = String(req.params.id);
  const { severity, findings, profile_id } = req.body || {};

  const validSeverities = ['none', 'low', 'medium', 'high', 'critical'];
  if (!validSeverities.includes(severity)) {
    return badRequest(res, `Invalid severity. Must be one of: ${validSeverities.join(', ')}`);
  }

  try {
    const task = await db.getTask(taskId);
    if (!task) return notFound(res, 'Task');

    const report = await db.createCleanupReport({
      task_id: taskId,
      profile_id: profile_id || undefined,
      severity,
      findings: Array.isArray(findings) ? findings : [],
    });

    const job = await db.getJob(task.job_id);
    const thresholds = job?.config?.cleanup_thresholds;

    let passed = true;
    if (thresholds && Array.isArray(findings)) {
      const counts = { low: 0, medium: 0, high: 0, critical: 0 };
      for (const f of findings) {
        if (f.severity in counts) {
          counts[f.severity as keyof typeof counts]++;
        }
      }
      if (thresholds.fail_on_critical && counts.critical > 0) passed = false;
      if (counts.high > thresholds.max_high) passed = false;
      if (counts.medium > thresholds.max_medium) passed = false;
      if (counts.low > thresholds.max_low) passed = false;
    }

    if (passed) {
      await db.updateTaskStatus(taskId, 'completed');
    } else {
      const currentIteration = task.iteration;
      if (currentIteration < task.max_iterations) {
        await db.updateTaskStatus(taskId, 'iterating');
      } else {
        await db.updateTaskStatus(taskId, 'escalated');
      }
    }

    res.status(201).json({ ...report, passed });
  } catch (err) {
    res.status(500).json({ error: `Failed to submit cleanup report: ${err}` });
  }
});

// ── GET /tasks/:id/cleanup — Get cleanup reports for a task ──────────

tasksRouter.get('/tasks/:id/cleanup', async (req: Request, res: Response) => {
  const taskId = String(req.params.id);

  try {
    const task = await db.getTask(taskId);
    if (!task) return notFound(res, 'Task');

    const reports = await db.getCleanupReportsForTask(taskId);
    res.json({ reports, total: reports.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to get cleanup reports: ${err}` });
  }
});

// ── GET /tasks/stuck — Find tasks that haven't been updated ──────────

tasksRouter.get('/tasks/stuck', async (req: Request, res: Response) => {
  const timeoutMinutes = parseInt(req.query.timeout_minutes as string || '30', 10);

  try {
    const tasks = await db.getStuckTasks(timeoutMinutes);
    res.json({ tasks, total: tasks.length, timeout_minutes: timeoutMinutes });
  } catch (err) {
    res.status(500).json({ error: `Failed to get stuck tasks: ${err}` });
  }
});

// ── POST /tasks/:id/complete — Agent reports task completion ─────────

tasksRouter.post('/tasks/:id/complete', async (req: Request, res: Response) => {
  const taskId = String(req.params.id);
  const { result } = req.body || {};

  if (!result || typeof result !== 'object') {
    return badRequest(res, 'result object is required');
  }

  try {
    const validation = await validateTaskCompletion(taskId, result);
    res.json(validation);

    const task = await db.getTask(taskId);
    if (task) {
      await checkJobCompletion(task.job_id);
    }
  } catch (err) {
    res.status(500).json({ error: `Failed to process completion: ${err}` });
  }
});

// ── POST /tasks/:id/fail — Agent reports task failure ────────────────

tasksRouter.post('/tasks/:id/fail', async (req: Request, res: Response) => {
  const taskId = String(req.params.id);
  const { error: errorMsg, agent_id } = req.body || {};

  if (!errorMsg || typeof errorMsg !== 'string') {
    return badRequest(res, 'error message is required');
  }
  if (!agent_id || typeof agent_id !== 'string') {
    return badRequest(res, 'agent_id is required');
  }

  try {
    const result = await handleTaskFailure(taskId, errorMsg, agent_id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Failed to process failure: ${err}` });
  }
});

// ── POST /tasks/recover — Recover stuck tasks ────────────────────────

tasksRouter.post('/tasks/recover', async (req: Request, res: Response) => {
  const timeoutMinutes = parseInt(req.body?.timeout_minutes || '30', 10);

  try {
    const result = await recoverStuckTasks(timeoutMinutes);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Failed to recover tasks: ${err}` });
  }
});

// ── POST /tasks/:id/analyze — Run LLM cleanup analysis ──────────────

tasksRouter.post('/tasks/:id/analyze', async (req: Request, res: Response) => {
  const taskId = String(req.params.id);
  const { scan_results, code_context } = req.body || {};

  if (!scan_results || typeof scan_results !== 'string') {
    return badRequest(res, 'scan_results is required');
  }

  try {
    const task = await db.getTask(taskId);
    if (!task) return notFound(res, 'Task');

    const job = await db.getJob(task.job_id);
    if (!job) return notFound(res, 'Job');

    const profilePrompt = 'You are a code quality auditor. Analyze the following codebase scan results. List ALL residual issues. For each issue, provide: file path, line number (if known), severity (low/medium/high/critical), and a suggested fix.';

    const analysis = await analyzeCleanup(scan_results, profilePrompt, code_context);

    const report = await db.createCleanupReport({
      task_id: taskId,
      severity: analysis.severity,
      findings: analysis.findings,
    });

    const decision = await decideNextAction(task, { ...report, findings: analysis.findings }, job);

    if (decision.action === 'complete') {
      await db.updateTaskStatus(taskId, 'completed');
    } else if (decision.action === 'iterate') {
      await db.incrementTaskIteration(taskId);
      await db.updateTaskStatus(taskId, 'iterating');
    } else {
      await db.updateTaskStatus(taskId, 'escalated');
    }

    const resistance = await detectResistance(taskId);
    if (resistance.penalty > 0 && task.agent_id) {
      await db.decrementComplianceScore(task.agent_id, resistance.penalty);
    }

    // Include pass config for the current and next iteration
    const currentPass = getPassConfig(task.iteration, job);
    const nextPass = decision.action === 'iterate'
      ? getPassConfig(task.iteration + 1, job)
      : null;

    res.json({
      analysis,
      decision,
      resistance,
      report_id: report.id,
      iteration_info: {
        current: task.iteration,
        max: task.max_iterations,
        current_pass: currentPass,
        next_pass: nextPass,
      },
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to analyze task: ${err}` });
  }
});

// ── GET /queue — Get queue depths for all task types ─────────────────

tasksRouter.get('/queue', async (_req: Request, res: Response) => {
  try {
    const depths = await getQueueDepths();
    const total = Object.values(depths).reduce((a, b) => a + b, 0);
    res.json({ queues: depths, total });
  } catch (err) {
    res.status(500).json({ error: `Failed to get queue depths: ${err}` });
  }
});

// ── POST /tasks/:id/force-iterate — Force another iteration (manual override) ─

tasksRouter.post('/tasks/:id/force-iterate', async (req: Request, res: Response) => {
  const taskId = String(req.params.id);

  try {
    const task = await db.getTask(taskId);
    if (!task) return notFound(res, 'Task');

    // Allow force-iterate on completed, escalated, or iterating tasks
    if (!['completed', 'escalated', 'iterating', 'awaiting_cleanup', 'running'].includes(task.status)) {
      return badRequest(res, `Cannot force-iterate task in status '${task.status}'`);
    }

    const newIteration = await db.incrementTaskIteration(taskId);
    await db.updateTaskStatus(taskId, 'iterating');

    const job = await db.getJob(task.job_id);
    const passConfig = job ? getPassConfig(newIteration, job) : null;

    res.json({
      task_id: taskId,
      iteration: newIteration,
      status: 'iterating',
      pass_config: passConfig,
      message: `Forced iteration ${newIteration}. Pass type: ${passConfig?.type || 'unknown'}`,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to force iterate: ${err}` });
  }
});

// ── POST /tasks/:id/force-accept — Accept task as-is (manual override) ──────

tasksRouter.post('/tasks/:id/force-accept', async (req: Request, res: Response) => {
  const taskId = String(req.params.id);

  try {
    const task = await db.getTask(taskId);
    if (!task) return notFound(res, 'Task');

    if (['pending', 'queued'].includes(task.status)) {
      return badRequest(res, `Cannot force-accept task that hasn't been worked on yet`);
    }

    await db.updateTaskStatus(taskId, 'completed');

    // Check if this completes the job
    await checkJobCompletion(task.job_id);

    res.json({
      task_id: taskId,
      status: 'completed',
      message: 'Task force-accepted via manual override',
      iteration: task.iteration,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to force accept: ${err}` });
  }
});

// ── GET /tasks/:id/iteration-history — Get iteration pass history ────────────

tasksRouter.get('/tasks/:id/iteration-history', async (req: Request, res: Response) => {
  const taskId = String(req.params.id);

  try {
    const task = await db.getTask(taskId);
    if (!task) return notFound(res, 'Task');

    const reports = await db.getCleanupReportsForTask(taskId);
    const job = await db.getJob(task.job_id);

    // Build iteration history from cleanup reports
    const history = reports.map((report, i) => {
      const passConfig = job ? getPassConfig(i, job) : null;
      return {
        iteration: i,
        pass_type: passConfig?.type || 'unknown',
        disclosure_level: passConfig?.disclosure || 2,
        llm_tier: passConfig?.tier || 'coder',
        severity: report.severity,
        findings_count: report.findings.length,
        passed: report.passed,
        created_at: report.created_at,
      };
    });

    res.json({
      task_id: taskId,
      current_iteration: task.iteration,
      max_iterations: task.max_iterations,
      history,
      total: history.length,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to get iteration history: ${err}` });
  }
});

// ── POST /orchestrator/tick — Manually trigger an orchestrator cycle ──

tasksRouter.post('/orchestrator/tick', async (_req: Request, res: Response) => {
  try {
    const result = await orchestratorTick();
    res.json({ ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: `Failed to run orchestrator tick: ${err}` });
  }
});
