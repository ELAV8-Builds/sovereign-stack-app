/**
 * Overmind Routes — Rules Engine
 *
 * Endpoints for listing, creating, updating, and deleting rules,
 * plus preset application for quick configuration.
 */
import { Router, Request, Response } from 'express';
import * as db from '../../services/overmind/db';
import { invalidateRulesCache } from '../../services/overmind/orchestrator';
import { badRequest, notFound } from './helpers';

export const rulesRouter = Router();

// ── GET /rules — List all rules (optionally filter) ──────────────────

rulesRouter.get('/rules', async (req: Request, res: Response) => {
  const category = req.query.category as string | undefined;
  const scope = req.query.scope as string | undefined;

  try {
    const rules = await db.listRules(category, scope);
    res.json({ rules, total: rules.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to list rules: ${err}` });
  }
});

// ── POST /rules — Create or update a rule (upsert) ──────────────────

rulesRouter.post('/rules', async (req: Request, res: Response) => {
  const { category, key, value, enabled, scope } = req.body || {};

  if (!category || typeof category !== 'string') {
    return badRequest(res, 'category is required');
  }
  if (!key || typeof key !== 'string') {
    return badRequest(res, 'key is required');
  }

  try {
    const rule = await db.upsertRule({
      category,
      key,
      value: value ?? {},
      enabled: enabled !== false,
      scope: scope || 'global',
    });
    // Invalidate orchestrator's rules cache so the next tick uses fresh values
    invalidateRulesCache();
    res.status(201).json(rule);
  } catch (err) {
    res.status(500).json({ error: `Failed to save rule: ${err}` });
  }
});

// ── DELETE /rules/:id — Delete a specific rule ───────────────────────

rulesRouter.delete('/rules/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);

  try {
    const deleted = await db.deleteRule(id);
    if (!deleted) return notFound(res, 'Rule');
    invalidateRulesCache();
    res.json({ deleted: true, id });
  } catch (err) {
    res.status(500).json({ error: `Failed to delete rule: ${err}` });
  }
});

// ── POST /rules/preset/:name — Apply a preset configuration ─────────

const PRESETS: Record<string, Array<{ category: string; key: string; value: any }>> = {
  strict: [
    { category: 'thresholds', key: 'max_low', value: 5 },
    { category: 'thresholds', key: 'max_medium', value: 1 },
    { category: 'thresholds', key: 'max_high', value: 0 },
    { category: 'thresholds', key: 'fail_on_critical', value: true },
    { category: 'iteration', key: 'min_iterations', value: 3 },
    { category: 'iteration', key: 'max_iterations', value: 7 },
    { category: 'agent', key: 'compliance_penalty', value: 15 },
    { category: 'agent', key: 'quarantine_score', value: 40 },
    { category: 'policy', key: 'max_file_lines', value: 200 },
  ],
  normal: [
    { category: 'thresholds', key: 'max_low', value: 10 },
    { category: 'thresholds', key: 'max_medium', value: 3 },
    { category: 'thresholds', key: 'max_high', value: 0 },
    { category: 'thresholds', key: 'fail_on_critical', value: true },
    { category: 'iteration', key: 'min_iterations', value: 2 },
    { category: 'iteration', key: 'max_iterations', value: 5 },
    { category: 'agent', key: 'compliance_penalty', value: 10 },
    { category: 'agent', key: 'quarantine_score', value: 30 },
    { category: 'policy', key: 'max_file_lines', value: 300 },
  ],
  permissive: [
    { category: 'thresholds', key: 'max_low', value: 20 },
    { category: 'thresholds', key: 'max_medium', value: 8 },
    { category: 'thresholds', key: 'max_high', value: 2 },
    { category: 'thresholds', key: 'fail_on_critical', value: true },
    { category: 'iteration', key: 'min_iterations', value: 1 },
    { category: 'iteration', key: 'max_iterations', value: 3 },
    { category: 'agent', key: 'compliance_penalty', value: 5 },
    { category: 'agent', key: 'quarantine_score', value: 20 },
    { category: 'policy', key: 'max_file_lines', value: 500 },
  ],
};

rulesRouter.post('/rules/preset/:name', async (req: Request, res: Response) => {
  const presetName = String(req.params.name).toLowerCase();
  const preset = PRESETS[presetName];

  if (!preset) {
    return badRequest(res, `Unknown preset: ${presetName}. Available: ${Object.keys(PRESETS).join(', ')}`);
  }

  try {
    const results = [];
    for (const rule of preset) {
      const saved = await db.upsertRule({
        category: rule.category,
        key: rule.key,
        value: rule.value,
        enabled: true,
        scope: 'global',
      });
      results.push(saved);
    }
    // Invalidate orchestrator's rules cache so new preset takes effect immediately
    invalidateRulesCache();
    res.json({ applied: true, preset: presetName, rules: results, count: results.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to apply preset: ${err}` });
  }
});

// ── GET /stats — Dashboard stats ─────────────────────────────────────

rulesRouter.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [jobs, agents] = await Promise.all([
      db.listJobs(),
      db.listAgents(),
    ]);

    const running = jobs.filter(j => j.status === 'running' || j.status === 'planning');
    const completed = jobs.filter(j => j.status === 'completed');
    const failed = jobs.filter(j => j.status === 'failed');
    const healthy = agents.filter(a => a.status === 'healthy');

    res.json({
      total_jobs: jobs.length,
      running_jobs: running.length,
      completed_jobs: completed.length,
      failed_jobs: failed.length,
      total_agents: agents.length,
      healthy_agents: healthy.length,
      avg_iterations: 0,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to get stats: ${err}` });
  }
});
