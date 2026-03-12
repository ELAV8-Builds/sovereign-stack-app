import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { logActivity } from '../services/activity-broadcaster';

export const skillsRouter = Router();

// Skills are stored in the Claude skills directory
// In Docker, this is mounted from the host's ~/.claude/skills
const SKILLS_DIR = process.env.SKILLS_DIR || '/home/node/.claude/skills';
const EXCHANGE_DIR = process.env.EXCHANGE_DIR || '/data/sovereign-skills/skills';
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/workspace';

// Additional directories where the agent might create skills
const WORKSPACE_SKILL_DIRS = [
  path.join(WORKSPACE_ROOT, 'skills'),
  path.join(WORKSPACE_ROOT, '.skills'),
];

interface SkillManifestEntry {
  name: string;
  version: string;
  description: string;
  category: string;
  tags: string[];
}

interface SkillInfo {
  name: string;
  version: string;
  description: string;
  category: string;
  tags: string[];
  installed: boolean;
  hasUpdate: boolean;
  source: 'local' | 'exchange' | 'both';
}

/**
 * Parse version and description from a SKILL.md file.
 * Looks for patterns like "Version: X.Y" or "v1.2" in the first 20 lines.
 */
async function parseSkillMd(filePath: string): Promise<{ version: string; description: string }> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').slice(0, 30);

    let version = '1.0';
    let description = '';

    for (const line of lines) {
      // Version patterns
      const vMatch = line.match(/(?:version|Version|VERSION)[:\s]*v?(\d+\.\d+(?:\.\d+)?)/i);
      if (vMatch) {
        version = vMatch[1];
      }

      // Description: first non-heading, non-empty line after the title
      if (!description && !line.startsWith('#') && !line.startsWith('---') && line.trim().length > 10) {
        const trimmed = line.trim();
        // Skip version lines and metadata
        if (!trimmed.match(/^(version|category|tags)/i)) {
          description = trimmed;
        }
      }
    }

    return { version, description };
  } catch {
    return { version: '1.0', description: '' };
  }
}

/**
 * Read the exchange manifest.json if available.
 */
async function readExchangeManifest(): Promise<SkillManifestEntry[]> {
  try {
    const manifestPath = path.join(EXCHANGE_DIR, 'manifest.json');
    const raw = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw);
    return manifest.skills || [];
  } catch {
    return [];
  }
}

/**
 * Scan a single directory for skills (dirs with SKILL.md).
 */
async function scanSkillDir(
  dir: string,
  skills: Map<string, { version: string; description: string; source: string }>
): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !skills.has(entry.name)) {
        const skillMdPath = path.join(dir, entry.name, 'SKILL.md');
        try {
          await fs.access(skillMdPath);
          const info = await parseSkillMd(skillMdPath);
          skills.set(entry.name, { ...info, source: dir });
        } catch {
          // No SKILL.md — not a valid skill
        }
      }
    }
  } catch {
    // Dir doesn't exist — skip
  }
}

/**
 * List all locally installed skills (dirs with SKILL.md).
 * Scans the standard skills dir PLUS workspace directories where the agent creates skills.
 */
async function listLocalSkills(): Promise<Map<string, { version: string; description: string }>> {
  const skills = new Map<string, { version: string; description: string; source: string }>();

  // Scan standard skills dir first (takes priority)
  await scanSkillDir(SKILLS_DIR, skills);

  // Also scan workspace skill directories (agent-created skills)
  for (const wsDir of WORKSPACE_SKILL_DIRS) {
    await scanSkillDir(wsDir, skills);
  }

  // Convert to expected return type (drop source field)
  const result = new Map<string, { version: string; description: string }>();
  for (const [name, info] of skills) {
    result.set(name, { version: info.version, description: info.description });
  }
  return result;
}

// ─── GET /api/skills — List all skills (installed + available) ────────

skillsRouter.get('/', async (_req: Request, res: Response) => {
  logActivity('api', 'info', 'Fetching skills list...');

  const [localSkills, exchangeManifest] = await Promise.all([
    listLocalSkills(),
    readExchangeManifest(),
  ]);

  const skillMap = new Map<string, SkillInfo>();

  // Add all local skills
  for (const [name, info] of localSkills) {
    skillMap.set(name, {
      name,
      version: info.version,
      description: info.description,
      category: 'uncategorized',
      tags: [],
      installed: true,
      hasUpdate: false,
      source: 'local',
    });
  }

  // Merge exchange skills
  for (const entry of exchangeManifest) {
    const existing = skillMap.get(entry.name);
    if (existing) {
      // Skill exists locally — check if exchange version is newer
      existing.category = entry.category;
      existing.tags = entry.tags;
      existing.description = entry.description || existing.description;
      existing.source = 'both';

      // Simple version comparison
      const localVer = parseFloat(existing.version) || 0;
      const exchangeVer = parseFloat(entry.version) || 0;
      if (exchangeVer > localVer) {
        existing.hasUpdate = true;
        existing.version = `${existing.version} → ${entry.version}`;
      }
    } else {
      // Only in exchange — available but not installed
      skillMap.set(entry.name, {
        name: entry.name,
        version: entry.version,
        description: entry.description,
        category: entry.category,
        tags: entry.tags,
        installed: false,
        hasUpdate: false,
        source: 'exchange',
      });
    }
  }

  const skills = Array.from(skillMap.values()).sort((a, b) => {
    // Installed first, then by name
    if (a.installed && !b.installed) return -1;
    if (!a.installed && b.installed) return 1;
    return a.name.localeCompare(b.name);
  });

  const installedCount = skills.filter(s => s.installed).length;
  const availableCount = skills.filter(s => !s.installed).length;
  const updatesCount = skills.filter(s => s.hasUpdate).length;

  logActivity('api', 'success', `Skills: ${installedCount} installed, ${availableCount} available, ${updatesCount} updates`);

  res.json({
    skills,
    stats: {
      installed: installedCount,
      available: availableCount,
      updates: updatesCount,
      total: skills.length,
    },
  });
});

// ─── GET /api/skills/:name — Get a single skill's details ────────────

skillsRouter.get('/:name', async (req: Request, res: Response) => {
  const name = String(req.params.name);

  // Try reading local SKILL.md from all known directories
  const searchDirs = [SKILLS_DIR, ...WORKSPACE_SKILL_DIRS, EXCHANGE_DIR];
  let content = '';
  let installed = false;

  for (const dir of searchDirs) {
    try {
      const skillMdPath = path.join(dir, name, 'SKILL.md');
      content = await fs.readFile(skillMdPath, 'utf-8');
      installed = dir !== EXCHANGE_DIR; // Installed if found outside exchange
      break;
    } catch {
      // Not in this dir — try next
    }
  }

  if (!content) {
    return res.status(404).json({ error: `Skill "${name}" not found` });
  }

  res.json({ name, installed, content });
});

// ─── POST /api/skills/:name/install — Install a skill from exchange ──

skillsRouter.post('/:name/install', async (req: Request, res: Response) => {
  const name = String(req.params.name);
  logActivity('api', 'info', `Installing skill: ${name}`);

  const exchangeSkillDir = path.join(EXCHANGE_DIR, name);
  const localSkillDir = path.join(SKILLS_DIR, name);

  try {
    // Verify skill exists in exchange
    await fs.access(path.join(exchangeSkillDir, 'SKILL.md'));
  } catch {
    return res.status(404).json({ error: `Skill "${name}" not found in exchange` });
  }

  try {
    // Create local skill directory
    await fs.mkdir(localSkillDir, { recursive: true });

    // Copy all files from exchange to local
    const files = await fs.readdir(exchangeSkillDir);
    for (const file of files) {
      const src = path.join(exchangeSkillDir, file);
      const dst = path.join(localSkillDir, file);
      const stat = await fs.stat(src);
      if (stat.isFile()) {
        await fs.copyFile(src, dst);
      }
    }

    logActivity('api', 'success', `Skill installed: ${name}`);
    res.json({ success: true, message: `Skill "${name}" installed successfully` });
  } catch (err) {
    logActivity('api', 'error', `Failed to install skill ${name}: ${err}`);
    res.status(500).json({ error: `Failed to install skill: ${err}` });
  }
});

// ─── POST /api/skills/:name/update — Update a skill from exchange ────

skillsRouter.post('/:name/update', async (req: Request, res: Response) => {
  const name = String(req.params.name);
  logActivity('api', 'info', `Updating skill: ${name}`);

  // Same logic as install — just overwrite
  const exchangeSkillDir = path.join(EXCHANGE_DIR, name);
  const localSkillDir = path.join(SKILLS_DIR, name);

  try {
    await fs.access(path.join(exchangeSkillDir, 'SKILL.md'));
  } catch {
    return res.status(404).json({ error: `Skill "${name}" not found in exchange` });
  }

  try {
    await fs.mkdir(localSkillDir, { recursive: true });
    const files = await fs.readdir(exchangeSkillDir);
    for (const file of files) {
      const src = path.join(exchangeSkillDir, file);
      const dst = path.join(localSkillDir, file);
      const stat = await fs.stat(src);
      if (stat.isFile()) {
        await fs.copyFile(src, dst);
      }
    }

    logActivity('api', 'success', `Skill updated: ${name}`);
    res.json({ success: true, message: `Skill "${name}" updated successfully` });
  } catch (err) {
    logActivity('api', 'error', `Failed to update skill ${name}: ${err}`);
    res.status(500).json({ error: `Failed to update skill: ${err}` });
  }
});

// ─── DELETE /api/skills/:name — Remove a locally installed skill ─────

skillsRouter.delete('/:name', async (req: Request, res: Response) => {
  const name = String(req.params.name);

  // Safety: don't allow deleting system skills
  const systemSkills = ['agent-browser', 'slack', 'show-screenshot', 'keybindings-help'];
  if (systemSkills.includes(name)) {
    return res.status(403).json({ error: `Cannot remove system skill "${name}"` });
  }

  logActivity('api', 'info', `Removing skill: ${name}`);

  const localSkillDir = path.join(SKILLS_DIR, name);

  try {
    await fs.access(localSkillDir);
    await fs.rm(localSkillDir, { recursive: true });
    logActivity('api', 'success', `Skill removed: ${name}`);
    res.json({ success: true, message: `Skill "${name}" removed` });
  } catch {
    res.status(404).json({ error: `Skill "${name}" not found locally` });
  }
});
