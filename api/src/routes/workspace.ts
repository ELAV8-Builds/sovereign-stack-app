/**
 * Workspace CRUD API — Project lifecycle management
 *
 * Manages workspaces: create from templates, list, inspect, validate,
 * deploy, and archive. Each workspace is a project directory on disk
 * backed by a database record tracking its status.
 */
import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { query, withClient } from '../services/database';
import { logActivity } from '../services/activity-broadcaster';
import { getTemplates, getTemplate, scaffoldProject } from '../services/scaffolder';
import { runValidation } from '../services/build-validator';

export const workspaceRouter = Router();

// ── Constants ───────────────────────────────────────────────────────

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/workspace';

// ── Auto-migrate on first request ───────────────────────────────────

let migrated = false;

async function ensureTables(): Promise<void> {
  if (migrated) return;

  await withClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        template TEXT NOT NULL DEFAULT 'blank',
        description TEXT,
        path TEXT NOT NULL,
        status TEXT DEFAULT 'scaffolding' CHECK (status IN ('scaffolding','ready','building','deploying','deployed','error','archived')),
        build_status JSONB DEFAULT '{}',
        deploy_status JSONB DEFAULT '{}',
        config JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_workspaces_status ON workspaces(status);
      CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug);
    `);
  });

  migrated = true;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Generate a URL-safe slug from a workspace name.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Count files in a directory recursively (best-effort).
 */
async function countFiles(dirPath: string): Promise<number> {
  let count = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      if (entry.isFile()) {
        count++;
      } else if (entry.isDirectory()) {
        count += await countFiles(path.join(dirPath, entry.name));
      }
    }
  } catch {
    // Directory may not exist or be unreadable
  }
  return count;
}

/**
 * Check if a directory has a .git repo and return basic git info.
 */
async function getGitStatus(dirPath: string): Promise<{ initialized: boolean; branch?: string }> {
  try {
    await fs.access(path.join(dirPath, '.git'));
    return { initialized: true, branch: 'main' };
  } catch {
    return { initialized: false };
  }
}

/**
 * Scan WORKSPACE_ROOT for directories that are not tracked in the DB.
 */
async function scanUnregisteredDirs(registeredPaths: Set<string>): Promise<Array<{ name: string; path: string }>> {
  const unregistered: Array<{ name: string; path: string }> = [];
  try {
    const entries = await fs.readdir(WORKSPACE_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip known system/internal directories
      if (['node_modules', '.git', 'fleet', '.cache'].includes(entry.name)) continue;

      const dirPath = path.join(WORKSPACE_ROOT, entry.name);
      if (!registeredPaths.has(dirPath)) {
        unregistered.push({ name: entry.name, path: dirPath });
      }
    }
  } catch {
    // Root dir scan failed — non-fatal
  }
  return unregistered;
}

// ── GET /api/workspaces/templates — Available project templates ──────

workspaceRouter.get('/templates', (_req: Request, res: Response) => {
  const templates = getTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    icon: t.icon,
    category: t.category,
    fileCount: Object.keys(t.files).length,
    hasDependencies: !!(t.dependencies || t.devDependencies),
  }));

  res.json({ templates });
});

// ── GET /api/workspaces — List all workspaces ───────────────────────

workspaceRouter.get('/', async (_req: Request, res: Response) => {
  await ensureTables();

  try {
    const result = await query(
      `SELECT * FROM workspaces WHERE status != 'archived' ORDER BY created_at DESC`
    );

    // Collect registered paths to find unregistered directories
    const registeredPaths = new Set(result.rows.map((r: any) => r.path));
    const unregistered = await scanUnregisteredDirs(registeredPaths);

    res.json({
      workspaces: result.rows,
      unregistered,
    });
  } catch (err) {
    logActivity('workspace', 'error', `Failed to list workspaces: ${err}`);
    res.status(500).json({ error: `Failed to list workspaces: ${err}` });
  }
});

// ── POST /api/workspaces — Create a new workspace ───────────────────

workspaceRouter.post('/', async (req: Request, res: Response) => {
  await ensureTables();

  const { name, template = 'blank', description } = req.body || {};

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }

  const slug = slugify(name);
  if (!slug) {
    return res.status(400).json({ error: 'name must contain at least one alphanumeric character' });
  }

  // Validate template
  const tmpl = getTemplate(template);
  if (!tmpl) {
    return res.status(400).json({
      error: `Unknown template "${template}"`,
      availableTemplates: getTemplates().map((t) => t.id),
    });
  }

  const workspacePath = path.join(WORKSPACE_ROOT, slug);

  try {
    // Check for slug collision in the DB
    const existing = await query(`SELECT id FROM workspaces WHERE slug = $1`, [slug]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: `Workspace with slug "${slug}" already exists` });
    }

    // Insert the record in 'scaffolding' status
    const insertResult = await query(
      `INSERT INTO workspaces (name, slug, template, description, path, status)
       VALUES ($1, $2, $3, $4, $5, 'scaffolding')
       RETURNING *`,
      [name, slug, template, description || null, workspacePath]
    );

    const workspace = insertResult.rows[0];

    logActivity('workspace', 'info', `Scaffolding workspace: ${name} (${template})`);

    // Scaffold the project asynchronously, then update status
    scaffoldProject(template, name, workspacePath)
      .then(async (result) => {
        const newStatus = result.success ? 'ready' : 'error';
        const buildStatus = {
          scaffolded: true,
          filesCreated: result.filesCreated,
          errors: result.errors,
          completedAt: new Date().toISOString(),
        };

        await query(
          `UPDATE workspaces SET status = $1, build_status = $2, updated_at = NOW() WHERE id = $3`,
          [newStatus, JSON.stringify(buildStatus), workspace.id]
        );

        if (result.success) {
          logActivity('workspace', 'success', `Workspace ready: ${name} (${result.filesCreated} files)`);
        } else {
          logActivity('workspace', 'error', `Workspace scaffolding errors: ${result.errors.join(', ')}`);
        }
      })
      .catch(async (err) => {
        await query(
          `UPDATE workspaces SET status = 'error', build_status = $1, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify({ error: String(err) }), workspace.id]
        );
        logActivity('workspace', 'error', `Workspace scaffolding failed: ${err}`);
      });

    // Return immediately with 'scaffolding' status — client can poll for updates
    res.status(201).json(workspace);
  } catch (err) {
    logActivity('workspace', 'error', `Failed to create workspace: ${err}`);
    res.status(500).json({ error: `Failed to create workspace: ${err}` });
  }
});

// ── GET /api/workspaces/:id — Get workspace details ─────────────────

workspaceRouter.get('/:id', async (req: Request, res: Response) => {
  await ensureTables();
  const id = String(req.params.id);

  try {
    const result = await query(`SELECT * FROM workspaces WHERE id = $1`, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const workspace = result.rows[0];

    // Enrich with filesystem info
    const [fileCount, gitStatus] = await Promise.all([
      countFiles(workspace.path),
      getGitStatus(workspace.path),
    ]);

    res.json({
      ...workspace,
      fileCount,
      gitStatus,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to get workspace: ${err}` });
  }
});

// ── DELETE /api/workspaces/:id — Soft-delete (archive) a workspace ──

workspaceRouter.delete('/:id', async (req: Request, res: Response) => {
  await ensureTables();
  const id = String(req.params.id);

  try {
    const result = await query(
      `UPDATE workspaces SET status = 'archived', updated_at = NOW()
       WHERE id = $1 AND status != 'archived'
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found or already archived' });
    }

    logActivity('workspace', 'info', `Workspace archived: ${result.rows[0].name}`);
    res.json({ success: true, workspace: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: `Failed to archive workspace: ${err}` });
  }
});

// ── POST /api/workspaces/:id/validate — Trigger build validation ────

workspaceRouter.post('/:id/validate', async (req: Request, res: Response) => {
  await ensureTables();
  const id = String(req.params.id);

  try {
    const result = await query(`SELECT * FROM workspaces WHERE id = $1`, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const workspace = result.rows[0];

    logActivity('workspace', 'info', `Validation requested: ${workspace.name}`);

    // Update status to 'building' while validation runs
    await query(
      `UPDATE workspaces SET status = 'building', updated_at = NOW() WHERE id = $1`,
      [id]
    );

    // Run the build validation
    const report = await runValidation(workspace.path);

    // Update workspace build_status with the report and restore status
    const newStatus = report.status === 'failing' ? 'error' : 'ready';
    await query(
      `UPDATE workspaces SET status = $1, build_status = $2, updated_at = NOW() WHERE id = $3`,
      [newStatus, JSON.stringify(report), id]
    );

    logActivity(
      'workspace',
      report.status === 'passing' ? 'success' : 'warning',
      `Validation ${report.status}: ${workspace.name} (${report.projectType}, ${report.tier} tier, ${report.totalDurationMs}ms)`
    );

    res.json(report);
  } catch (err) {
    res.status(500).json({ error: `Failed to validate workspace: ${err}` });
  }
});

// ── POST /api/workspaces/:id/deploy — Trigger deployment ────────────

workspaceRouter.post('/:id/deploy', async (req: Request, res: Response) => {
  await ensureTables();
  const id = String(req.params.id);

  try {
    const result = await query(`SELECT * FROM workspaces WHERE id = $1`, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const workspace = result.rows[0];
    const { target } = req.body || {};

    logActivity('workspace', 'info', `Deploy requested: ${workspace.name} (target: ${target || 'auto'})`);

    // Update status to 'deploying'
    await query(
      `UPDATE workspaces SET status = 'deploying', updated_at = NOW() WHERE id = $1`,
      [id]
    );

    try {
      const { deploy } = await import('../services/deployer');
      const report = await deploy(workspace.path, target);

      const newStatus = report.success ? 'deployed' : 'error';
      await query(
        `UPDATE workspaces SET status = $1, deploy_status = $2, updated_at = NOW() WHERE id = $3`,
        [newStatus, JSON.stringify(report), id]
      );

      logActivity(
        'workspace',
        report.success ? 'success' : 'error',
        `Deploy ${report.success ? 'succeeded' : 'failed'}: ${workspace.name} → ${report.target}${report.url ? ` (${report.url})` : ''}`
      );

      res.json(report);
    } catch (deployErr: any) {
      await query(
        `UPDATE workspaces SET status = 'error', deploy_status = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify({ error: deployErr.message }), id]
      );
      res.status(500).json({ error: `Deploy failed: ${deployErr.message}` });
    }
  } catch (err) {
    res.status(500).json({ error: `Failed to deploy workspace: ${err}` });
  }
});

// ── POST /api/workspaces/:id/plan — Generate architecture plan ──────

workspaceRouter.post('/:id/plan', async (req: Request, res: Response) => {
  await ensureTables();
  const id = String(req.params.id);

  try {
    const result = await query(`SELECT * FROM workspaces WHERE id = $1`, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const workspace = result.rows[0];

    // Placeholder — will wire into plan generation service
    logActivity('workspace', 'info', `Plan requested: ${workspace.name}`);
    res.json({ message: 'Plan endpoint ready', workspaceId: id, name: workspace.name });
  } catch (err) {
    res.status(500).json({ error: `Failed to generate plan: ${err}` });
  }
});
