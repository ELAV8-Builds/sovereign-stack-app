/**
 * Overmind Routes — Skills
 *
 * Endpoints for listing, matching, and reloading skills from the filesystem,
 * plus a DB-backed fallback for backwards compatibility.
 */
import { Router, Request, Response } from 'express';
import * as db from '../../services/overmind/db';
import {
  loadAllSkills,
  getSkill,
  findSkill,
  buildSkillPrompt,
  clearSkillCache,
} from '../../services/overmind/skills';
import { suggestCategory } from '../../services/overmind/llm';
import type { TargetType, TaskType, CreateCategoryInput } from '../../services/overmind/types';
import { badRequest, notFound } from './helpers';

export const skillsRouter = Router();

// ── GET /skills — List all skills from the filesystem ────────────────

skillsRouter.get('/skills', (_req: Request, res: Response) => {
  try {
    const skills = loadAllSkills();
    const summary = skills.map(s => ({
      name: s.meta.name,
      category: s.meta.category,
      version: s.meta.version,
      target_type: s.meta.target_type,
      required_capabilities: s.meta.required_capabilities,
      path: s.path,
    }));
    res.json({ skills: summary, total: summary.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to list skills: ${err}` });
  }
});

// ── GET /skills/:name — Get a specific skill with content ────────────

skillsRouter.get('/skills/:name', (req: Request, res: Response) => {
  const name = String(req.params.name);
  const level = parseInt(req.query.level as string || '2', 10) as 1 | 2 | 3;

  try {
    const skill = getSkill(name);
    if (!skill) return notFound(res, 'Skill');

    const content = buildSkillPrompt(name, 'implementation', 1, false);

    res.json({
      meta: skill.meta,
      path: skill.path,
      disclosure_level: level,
      content,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to get skill: ${err}` });
  }
});

// ── GET /skills/match — Find the best skill for a target + task type ─

skillsRouter.get('/skills/match', (req: Request, res: Response) => {
  const targetType = req.query.target_type as string;
  const taskType = req.query.task_type as string;

  if (!targetType || !taskType) {
    return badRequest(res, 'target_type and task_type query params are required');
  }

  try {
    const skill = findSkill(targetType as TargetType, taskType as TaskType);
    if (!skill) {
      return res.json({ match: null, message: 'No matching skill found' });
    }

    res.json({
      match: {
        name: skill.meta.name,
        category: skill.meta.category,
        target_type: skill.meta.target_type,
        path: skill.path,
      },
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to match skill: ${err}` });
  }
});

// ── POST /skills/reload — Clear skill cache and reload from disk ─────

skillsRouter.post('/skills/reload', (_req: Request, res: Response) => {
  clearSkillCache();
  const skills = loadAllSkills();
  res.json({ reloaded: true, count: skills.length });
});

// ── GET /skills/db — DB-based skill listing for backwards compatibility

skillsRouter.get('/skills/db', async (req: Request, res: Response) => {
  const categoryId = req.query.category_id as string | undefined;

  try {
    const skills = await db.listSkills(categoryId);
    res.json({ skills, total: skills.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to list skills: ${err}` });
  }
});

// ── GET /categories — List all categories ────────────────────────────

skillsRouter.get('/categories', async (_req: Request, res: Response) => {
  try {
    const categories = await db.listCategories();
    res.json({ categories, total: categories.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to list categories: ${err}` });
  }
});

// ── POST /categories — Create a new category ────────────────────────

skillsRouter.post('/categories', async (req: Request, res: Response) => {
  const { name, description } = req.body as Partial<CreateCategoryInput> || {};

  if (!name || typeof name !== 'string') {
    return badRequest(res, 'name is required');
  }

  try {
    const category = await db.createCategory({ name, description });
    res.status(201).json(category);
  } catch (err) {
    res.status(500).json({ error: `Failed to create category: ${err}` });
  }
});

// ── POST /categories/suggest — Suggest a category for a description ──

skillsRouter.post('/categories/suggest', async (req: Request, res: Response) => {
  const { description } = req.body || {};

  if (!description || typeof description !== 'string') {
    return badRequest(res, 'description is required');
  }

  try {
    const suggestion = await suggestCategory(description);
    res.json(suggestion);
  } catch (err) {
    res.status(500).json({ error: `Failed to suggest category: ${err}` });
  }
});
