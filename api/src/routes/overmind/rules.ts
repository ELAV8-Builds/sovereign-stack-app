/**
 * Overmind Routes — Rules Engine
 *
 * Endpoints for listing, creating, updating, and deleting rules,
 * plus preset application for quick configuration.
 *
 * IMPORTANT: Route order matters! Specific paths (seed, preset) must
 * come before parameterized paths (:id) to avoid route conflicts.
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
    invalidateRulesCache();
    res.status(201).json(rule);
  } catch (err) {
    res.status(500).json({ error: `Failed to save rule: ${err}` });
  }
});

// ── POST /rules/preset/:name — Apply a preset configuration ─────────
// MUST come before /rules/:id to avoid route conflicts

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
    invalidateRulesCache();
    res.json({ applied: true, preset: presetName, rules: results, count: results.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to apply preset: ${err}` });
  }
});

// ── POST /rules/seed — Seed default build rules ──────────────────────
// MUST come before /rules/:id to avoid route conflicts

const DEFAULT_RULES: Array<{ category: string; key: string; value: any; scope?: string }> = [
  // Build rules (B1-B11)
  { category: 'build', key: 'no_external_api_in_browser', value: 'NEVER call external APIs from browser JS. Use proxy/backend.' },
  { category: 'build', key: 'wire_env_to_app', value: 'Verify app actually READS env vars, not just .env file creation.' },
  { category: 'build', key: 'async_feedback_required', value: 'Every async action: loading state, disabled during op, toast on success/error.' },
  { category: 'build', key: 'no_mock_data', value: 'Show real empty states, error messages, loading states. Never mock data.' },
  { category: 'build', key: 'verify_before_done', value: 'Run tsc --noEmit + npm run build after EVERY change before reporting done.' },
  { category: 'build', key: 'tiered_verification', value: { small: 'tsc + build + spot-check', medium: '+ runtime + env + feedback', large: '+ full test + no-mock audit' } },
  { category: 'build', key: 'test_docker_builds', value: 'Missing package-lock.json breaks npm ci in Docker.' },
  { category: 'build', key: 'warn_vite_keys', value: 'VITE_* keys are embedded in JS bundles. Use serverless functions.' },
  { category: 'build', key: 'api_preflight', value: 'Search current docs, verify installed version, test call before wiring.' },
  { category: 'build', key: 'port_reservation', value: 'Reserved: 3000, 3001, 3100, 4000, 4010, 5173, 5175, 5180, 5432, 6379, 8090, 11434, 18789' },
  { category: 'build', key: 'always_validate', value: 'Run full build chain after changes. Fix errors and re-validate.' },
  // Iteration rules
  { category: 'iteration', key: 'min_iterations', value: 2 },
  { category: 'iteration', key: 'max_iterations', value: 5 },
  { category: 'iteration', key: 'always_iterate', value: true },
  // Quality rules
  { category: 'quality', key: 'cleanup_threshold', value: 'medium' },
  { category: 'quality', key: 'max_file_lines', value: 300 },
  // Context warden rules
  { category: 'context', key: 'warn_threshold', value: 65 },
  { category: 'context', key: 'checkpoint_threshold', value: 75 },
  { category: 'context', key: 'restart_threshold', value: 85 },
];

rulesRouter.post('/rules/seed', async (_req: Request, res: Response) => {
  try {
    const existing = await db.listRules();
    if (existing.length > 0) {
      return res.json({ seeded: false, message: 'Rules already exist. Use presets to override.', rules: existing, count: existing.length });
    }

    const results = [];
    for (const rule of DEFAULT_RULES) {
      const saved = await db.upsertRule({
        category: rule.category,
        key: rule.key,
        value: rule.value,
        enabled: true,
        scope: rule.scope || 'global',
      });
      results.push(saved);
    }
    invalidateRulesCache();
    res.json({ seeded: true, rules: results, count: results.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to seed rules: ${err}` });
  }
});

// ── POST /rules/:id — Update a specific rule ────────────────────────
// MUST come AFTER all /rules/specific paths to avoid conflicts

rulesRouter.post('/rules/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const updates = req.body || {};

  try {
    const existing = await db.listRules();
    const rule = existing.find(r => r.id === id);
    if (!rule) return notFound(res, 'Rule');

    const merged = {
      category: updates.category || rule.category,
      key: updates.key || rule.key,
      value: updates.value !== undefined ? updates.value : rule.value,
      enabled: updates.enabled !== undefined ? updates.enabled : rule.enabled,
      scope: updates.scope || rule.scope,
    };

    const saved = await db.upsertRule(merged);
    invalidateRulesCache();
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: `Failed to update rule: ${err}` });
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
