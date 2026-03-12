/**
 * Overmind Routes — Rule Versions & Rollback
 */
import { Router, Request, Response } from 'express';
import * as db from '../../services/overmind/db';
import { invalidateRulesCache } from '../../services/overmind/orchestrator';
import { badRequest, notFound } from './helpers';

export const versionsRouter = Router();

// ── GET /versions — List rule version history ────────────────────
versionsRouter.get('/versions', async (req: Request, res: Response) => {
  const category = req.query.category as string | undefined;
  try {
    const versions = await db.listRuleVersions(category);
    res.json({ versions, total: versions.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to list versions: ${err}` });
  }
});

// ── GET /versions/:id — Get specific version ────────────────────
versionsRouter.get('/versions/:id', async (req: Request, res: Response) => {
  try {
    const version = await db.getRuleVersion(String(req.params.id));
    if (!version) return notFound(res, 'Version');
    res.json(version);
  } catch (err) {
    res.status(500).json({ error: `Failed to get version: ${err}` });
  }
});

// ── POST /versions/rollback — Restore rules to a previous version ─
versionsRouter.post('/versions/rollback', async (req: Request, res: Response) => {
  const { version_id } = req.body || {};
  if (!version_id) return badRequest(res, 'version_id is required');

  try {
    const version = await db.getRuleVersion(version_id);
    if (!version) return notFound(res, 'Version');

    // Delete current rules for this category
    await db.deleteRulesByCategory(version.category);

    // Restore rules from snapshot
    const restored = [];
    for (const rule of version.snapshot) {
      const saved = await db.upsertRule({
        category: rule.category,
        key: rule.key,
        value: rule.value,
        enabled: rule.enabled,
        scope: rule.scope || 'global',
      });
      restored.push(saved);
    }

    // Create a new version recording the rollback
    await db.snapshotRuleCategory(version.category, 'rollback', 'beau', `Rolled back to v${version.version}`);
    invalidateRulesCache();

    res.json({
      rolled_back: true,
      category: version.category,
      restored_version: version.version,
      rules: restored,
      count: restored.length,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to rollback: ${err}` });
  }
});

// ── GET /versions/diff/:v1/:v2 — Compare two versions ──────────
versionsRouter.get('/versions/diff/:v1/:v2', async (req: Request, res: Response) => {
  try {
    const [v1, v2] = await Promise.all([
      db.getRuleVersion(String(req.params.v1)),
      db.getRuleVersion(String(req.params.v2)),
    ]);
    if (!v1) return notFound(res, 'Version v1');
    if (!v2) return notFound(res, 'Version v2');

    // Build diff
    const v1Map = new Map<string, any>(v1.snapshot.map((r: any) => [`${r.category}.${r.key}`, r]));
    const v2Map = new Map<string, any>(v2.snapshot.map((r: any) => [`${r.category}.${r.key}`, r]));

    const added: any[] = [];
    const removed: any[] = [];
    const changed: any[] = [];

    for (const [key, rule] of v2Map) {
      if (!v1Map.has(key)) {
        added.push(rule);
      } else {
        const old = v1Map.get(key);
        if (JSON.stringify(old?.value) !== JSON.stringify(rule.value) || old?.enabled !== rule.enabled) {
          changed.push({ key, before: old, after: rule });
        }
      }
    }
    for (const [key, rule] of v1Map) {
      if (!v2Map.has(key)) removed.push(rule);
    }

    res.json({
      v1: { id: v1.id, version: v1.version, category: v1.category, created_at: v1.created_at },
      v2: { id: v2.id, version: v2.version, category: v2.category, created_at: v2.created_at },
      diff: { added, removed, changed },
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to diff versions: ${err}` });
  }
});

// ── GET /deploys — List deploy history ───────────────────────────
versionsRouter.get('/deploys', async (_req: Request, res: Response) => {
  try {
    const deploys = await db.listDeployRecords();
    res.json({ deploys, total: deploys.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to list deploys: ${err}` });
  }
});

// ── GET /health-events — List health events ─────────────────────
versionsRouter.get('/health-events', async (req: Request, res: Response) => {
  const severity = req.query.severity as string | undefined;
  const limit = parseInt(req.query.limit as string) || 100;
  try {
    const events = await db.listHealthEvents(limit, severity);
    res.json({ events, total: events.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to list health events: ${err}` });
  }
});
