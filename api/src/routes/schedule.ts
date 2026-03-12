/**
 * Schedule Routes — CRUD for Scheduled Tasks
 *
 * Manages scheduled tasks that fire on cron expressions,
 * intervals, or one-time at a specific datetime.
 */
import { Router, Request, Response } from 'express';
import {
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  pauseScheduledTask,
  resumeScheduledTask,
  listScheduledTasks,
  getScheduledTask,
  getTaskRuns,
} from '../services/scheduler';

export const scheduleRouter = Router();

// ── GET / — List all scheduled tasks ─────────────────────────

scheduleRouter.get('/', async (req: Request, res: Response) => {
  try {
    const agentId = req.query.agent_id as string | undefined;
    const tasks = await listScheduledTasks(agentId);
    res.json({ tasks });
  } catch (err) {
    res.status(500).json({ error: `Failed to list tasks: ${(err as Error).message}` });
  }
});

// ── GET /:id — Get single task ───────────────────────────────

scheduleRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const task = await getScheduledTask(id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: `Failed to get task: ${(err as Error).message}` });
  }
});

// ── POST / — Create a new scheduled task ─────────────────────

scheduleRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { name, message, schedule_type, schedule_value, agent_id, max_runs, is_active } = req.body || {};

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }
    if (!schedule_type || !['cron', 'interval', 'once'].includes(schedule_type)) {
      return res.status(400).json({ error: 'schedule_type must be one of: cron, interval, once' });
    }
    if (!schedule_value || typeof schedule_value !== 'string') {
      return res.status(400).json({ error: 'schedule_value is required' });
    }

    const task = await createScheduledTask({
      name,
      message,
      schedule_type,
      schedule_value,
      agent_id: agent_id || undefined,
      max_runs: max_runs !== undefined ? max_runs : undefined,
      is_active: is_active !== undefined ? is_active : undefined,
    });

    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: `Failed to create task: ${(err as Error).message}` });
  }
});

// ── PUT /:id — Update a scheduled task ───────────────────────

scheduleRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { name, message, schedule_type, schedule_value, max_runs, is_active, agent_id } = req.body || {};

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (message !== undefined) updates.message = message;
    if (schedule_type !== undefined) updates.schedule_type = schedule_type;
    if (schedule_value !== undefined) updates.schedule_value = schedule_value;
    if (max_runs !== undefined) updates.max_runs = max_runs;
    if (is_active !== undefined) updates.is_active = is_active;
    if (agent_id !== undefined) updates.agent_id = agent_id;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const task = await updateScheduledTask(id, updates);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(task);
  } catch (err) {
    res.status(500).json({ error: `Failed to update task: ${(err as Error).message}` });
  }
});

// ── DELETE /:id — Delete a scheduled task ────────────────────

scheduleRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const deleted = await deleteScheduledTask(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to delete task: ${(err as Error).message}` });
  }
});

// ── POST /:id/pause — Pause a scheduled task ────────────────

scheduleRouter.post('/:id/pause', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const task = await pauseScheduledTask(id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: `Failed to pause task: ${(err as Error).message}` });
  }
});

// ── POST /:id/resume — Resume a paused task ─────────────────

scheduleRouter.post('/:id/resume', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const task = await resumeScheduledTask(id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: `Failed to resume task: ${(err as Error).message}` });
  }
});

// ── GET /:id/runs — Get run history for a task ──────────────

scheduleRouter.get('/:id/runs', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // Verify task exists
    const task = await getScheduledTask(id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const runs = await getTaskRuns(id);
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: `Failed to get runs: ${(err as Error).message}` });
  }
});
