/**
 * Overmind Routes — Jobs & Conversations
 *
 * Endpoints for creating, listing, and managing jobs,
 * plus conversation threads and messages.
 */
import { Router, Request, Response } from 'express';
import * as db from '../../services/overmind/db';
import { createPlannedJob } from '../../services/overmind/llm';
import { memorizeJobCompletion } from '../../services/overmind/orchestrator';
import type { CreateJobInput, JobStatus, TaskType } from '../../services/overmind/types';
import { badRequest, notFound } from './helpers';

export const jobsRouter = Router();

// ── POST /jobs — Create a new job ────────────────────────────────────

jobsRouter.post('/jobs', async (req: Request, res: Response) => {
  const { title, description, source, category_id, target_type, config } =
    req.body as Partial<CreateJobInput> || {};

  if (!title || typeof title !== 'string') {
    return badRequest(res, 'title is required');
  }
  if (!description || typeof description !== 'string') {
    return badRequest(res, 'description is required');
  }

  const validSources = ['web', 'slack', 'api'];
  const jobSource = validSources.includes(source as string) ? source! : 'api';

  const validTargetTypes = ['web_app', 'mobile_app', 'website', 'desktop_app', 'other'];
  const jobTargetType = validTargetTypes.includes(target_type as string) ? target_type! : 'web_app';

  try {
    const job = await db.createJob({
      title,
      description,
      source: jobSource,
      category_id: category_id || undefined,
      target_type: jobTargetType,
      config,
    });

    // If a category was provided and has a default workflow, auto-create tasks
    if (job.category_id) {
      const category = await db.getCategory(job.category_id);
      if (category) {
        const workflow = job.config?.workflow;
        if (workflow && Array.isArray(workflow)) {
          for (let i = 0; i < workflow.length; i++) {
            const step = workflow[i];
            await db.createTask(job.id, step.type, {
              sequence: i,
              skill_name: step.skill_name || null,
              skill_config: step.config || {},
              status: i === 0 ? 'queued' : 'pending',
            });
          }
        }
      }
    }

    // Create a conversation thread for this job
    await db.createConversation(job.id, jobSource);

    // Log the initial user message
    const conversations = await db.listConversationsForJob(job.id);
    if (conversations.length > 0) {
      await db.addMessage(conversations[0].id, 'user', description);
    }

    const jobWithTasks = await db.getJobWithTasks(job.id);
    res.status(201).json(jobWithTasks);
  } catch (err) {
    res.status(500).json({ error: `Failed to create job: ${err}` });
  }
});

// ── GET /jobs — List all jobs (optionally filter by status) ──────────

jobsRouter.get('/jobs', async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;

  const validStatuses = ['pending', 'planning', 'running', 'needs_review', 'completed', 'failed'];
  const filterStatus = validStatuses.includes(status as string)
    ? (status as JobStatus)
    : undefined;

  try {
    const jobs = await db.listJobs(filterStatus);
    res.json({ jobs, total: jobs.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to list jobs: ${err}` });
  }
});

// ── GET /jobs/:id — Get a single job with its tasks ──────────────────

jobsRouter.get('/jobs/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);

  try {
    const job = await db.getJobWithTasks(id);
    if (!job) return notFound(res, 'Job');
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: `Failed to get job: ${err}` });
  }
});

// ── PATCH /jobs/:id — Update job status ──────────────────────────────

jobsRouter.patch('/jobs/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { status } = req.body || {};

  const validStatuses = ['pending', 'planning', 'running', 'needs_review', 'completed', 'failed'];
  if (!validStatuses.includes(status)) {
    return badRequest(res, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
  }

  try {
    const job = await db.getJob(id);
    if (!job) return notFound(res, 'Job');

    await db.updateJobStatus(id, status as JobStatus);
    const updated = await db.getJobWithTasks(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: `Failed to update job: ${err}` });
  }
});

// ── GET /jobs/:id/tasks — List tasks for a job ───────────────────────

jobsRouter.get('/jobs/:id/tasks', async (req: Request, res: Response) => {
  const id = String(req.params.id);

  try {
    const job = await db.getJob(id);
    if (!job) return notFound(res, 'Job');

    const tasks = await db.getTasksForJob(id);
    res.json({ tasks, total: tasks.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to list tasks: ${err}` });
  }
});

// ── POST /jobs/:id/tasks — Add a task to an existing job ─────────────

jobsRouter.post('/jobs/:id/tasks', async (req: Request, res: Response) => {
  const jobId = String(req.params.id);
  const { type, skill_name, skill_config, prompt } = req.body || {};

  const validTypes = ['spec', 'implementation', 'cleanup', 'test', 'deploy'];
  if (!validTypes.includes(type)) {
    return badRequest(res, `Invalid task type. Must be one of: ${validTypes.join(', ')}`);
  }

  try {
    const job = await db.getJob(jobId);
    if (!job) return notFound(res, 'Job');

    const task = await db.createTask(jobId, type as TaskType, {
      skill_name: skill_name || null,
      skill_config: skill_config || {},
      prompt: prompt || '',
    });

    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: `Failed to create task: ${err}` });
  }
});

// ── POST /jobs/plan — Create a job using LLM job planning ────────────

jobsRouter.post('/jobs/plan', async (req: Request, res: Response) => {
  const { prompt, source, recipe_id } = req.body || {};

  if (!prompt || typeof prompt !== 'string') {
    return badRequest(res, 'prompt is required');
  }

  const validSources = ['web', 'slack', 'api'];
  const jobSource = validSources.includes(source) ? source : 'api';

  try {
    const job = await createPlannedJob(prompt, jobSource, recipe_id);
    const jobWithTasks = await db.getJobWithTasks(job.id);
    res.status(201).json({
      ...jobWithTasks,
      matched_recipe: job.matched_recipe || null,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to plan job: ${err}` });
  }
});

// ── GET /jobs/:id/conversations — List conversations for a job ───────

jobsRouter.get('/jobs/:id/conversations', async (req: Request, res: Response) => {
  const jobId = String(req.params.id);

  try {
    const job = await db.getJob(jobId);
    if (!job) return notFound(res, 'Job');

    const conversations = await db.listConversationsForJob(jobId);
    res.json({ conversations, total: conversations.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to list conversations: ${err}` });
  }
});

// ── GET /conversations/:id/messages — Get messages in a conversation ─

jobsRouter.get('/conversations/:id/messages', async (req: Request, res: Response) => {
  const conversationId = String(req.params.id);

  try {
    const messages = await db.getMessages(conversationId);
    res.json({ messages, total: messages.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to get messages: ${err}` });
  }
});

// ── POST /conversations/:id/messages — Add a message ─────────────────

jobsRouter.post('/conversations/:id/messages', async (req: Request, res: Response) => {
  const conversationId = String(req.params.id);
  const { role, content } = req.body || {};

  const validRoles = ['user', 'system', 'agent', 'overmind'];
  if (!validRoles.includes(role)) {
    return badRequest(res, `Invalid role. Must be one of: ${validRoles.join(', ')}`);
  }
  if (!content || typeof content !== 'string') {
    return badRequest(res, 'content is required');
  }

  try {
    const message = await db.addMessage(conversationId, role, content);
    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ error: `Failed to add message: ${err}` });
  }
});

// ── POST /jobs/:id/memorize — Store job summary in memU ──────────────

jobsRouter.post('/jobs/:id/memorize', async (req: Request, res: Response) => {
  const jobId = String(req.params.id);

  try {
    const job = await db.getJob(jobId);
    if (!job) return notFound(res, 'Job');

    const success = await memorizeJobCompletion(jobId);
    res.json({ memorized: success, job_id: jobId });
  } catch (err) {
    res.status(500).json({ error: `Failed to memorize job: ${err}` });
  }
});
