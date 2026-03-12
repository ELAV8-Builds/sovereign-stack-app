/**
 * Remotion Routes — Motion Graphics / Video Generation API
 *
 * GET  /api/remotion/status               — Check Remotion availability
 * GET  /api/remotion/projects              — List all projects
 * GET  /api/remotion/projects/:id          — Get project details
 * POST /api/remotion/projects              — Create a new project
 * POST /api/remotion/projects/:id/render   — Start a render job
 * GET  /api/remotion/render-jobs/:id       — Get render job status
 * GET  /api/remotion/projects/:id/render-jobs — List render jobs for a project
 */
import { Router, Request, Response } from 'express';
import {
  ensureRemotionTables,
  createRemotionProject,
  listRemotionProjects,
  getRemotionProject,
  startRender,
  getRenderJob,
  listRenderJobs,
  checkRemotionHealth,
} from '../services/remotion';

export const remotionRouter = Router();

// ── GET /status — Health check ────────────────────────────

remotionRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const health = await checkRemotionHealth();
    res.json(health);
  } catch (err) {
    res.status(500).json({ error: `Health check failed: ${(err as Error).message}` });
  }
});

// ── GET /projects — List all projects ─────────────────────

remotionRouter.get('/projects', async (_req: Request, res: Response) => {
  try {
    await ensureRemotionTables();
    const projects = await listRemotionProjects();
    res.json({ projects, count: projects.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to list projects: ${(err as Error).message}` });
  }
});

// ── GET /projects/:id — Get project details ───────────────

remotionRouter.get('/projects/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const project = await getRemotionProject(id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: `Failed to get project: ${(err as Error).message}` });
  }
});

// ── POST /projects — Create a new project ─────────────────

remotionRouter.post('/projects', async (req: Request, res: Response) => {
  const { name, template } = req.body || {};

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required (string)' });
  }

  try {
    const project = await createRemotionProject(name, template);
    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: `Failed to create project: ${(err as Error).message}` });
  }
});

// ── POST /projects/:id/render — Start a render job ────────

remotionRouter.post('/projects/:id/render', async (req: Request, res: Response) => {
  const projectId = req.params.id as string;
  const { composition, props, outputFormat } = req.body || {};

  if (!composition || typeof composition !== 'string') {
    return res.status(400).json({ error: 'composition is required (string)' });
  }

  const validFormats = ['mp4', 'webm', 'gif'];
  if (outputFormat && !validFormats.includes(outputFormat)) {
    return res.status(400).json({ error: `outputFormat must be one of: ${validFormats.join(', ')}` });
  }

  try {
    const job = await startRender({
      projectId,
      composition,
      props,
      outputFormat,
    });
    res.status(202).json(job);
  } catch (err) {
    res.status(500).json({ error: `Failed to start render: ${(err as Error).message}` });
  }
});

// ── GET /render-jobs/:id — Get render job status ──────────

remotionRouter.get('/render-jobs/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const job = await getRenderJob(id);
    if (!job) {
      return res.status(404).json({ error: 'Render job not found' });
    }
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: `Failed to get render job: ${(err as Error).message}` });
  }
});

// ── GET /projects/:id/render-jobs — List jobs for project ─

remotionRouter.get('/projects/:id/render-jobs', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id as string;
    const jobs = await listRenderJobs(projectId);
    res.json({ jobs, count: jobs.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to list render jobs: ${(err as Error).message}` });
  }
});
