/**
 * Overmind — Skill Parser & Router
 *
 * Reads SKILL.md files from the skills/ directory, parses YAML frontmatter,
 * and implements progressive disclosure (Level 1/2/3).
 *
 * Skills are recipe files that tell agents exactly how to execute a task type.
 * The Overmind loads only as much detail as the agent needs:
 *   - Level 1: Quick brief (~200 tokens) for simple/familiar tasks
 *   - Level 2: Detailed instructions (~1000 tokens) for standard execution
 *   - Level 3: Exhaustive reference (full document) for complex/unfamiliar tasks
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import type { OvSkill, TargetType, TaskType } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillFrontmatter {
  name: string;
  category: string;
  version: string;
  target_type: TargetType;
  required_capabilities: string[];
  default_config: Record<string, unknown>;
  cleanup_profile?: string;
}

export interface ParsedSkill {
  /** Frontmatter metadata */
  meta: SkillFrontmatter;
  /** Full raw markdown body (everything after frontmatter) */
  body: string;
  /** Level 1 — Quick Brief section */
  level1: string;
  /** Level 2 — Detailed Instructions section */
  level2: string;
  /** Level 3 — Exhaustive Reference section */
  level3: string;
  /** File path relative to skills/ root */
  path: string;
}

export type DisclosureLevel = 1 | 2 | 3;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKILLS_ROOT = join(__dirname, '../../../skills');

// ---------------------------------------------------------------------------
// Frontmatter Parser
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Expects content delimited by `---` at the top of the file.
 */
function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  const lines = content.split('\n');

  // Must start with ---
  if (lines[0]?.trim() !== '---') {
    return { meta: {}, body: content };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { meta: {}, body: content };
  }

  const yamlLines = lines.slice(1, endIndex);
  const body = lines.slice(endIndex + 1).join('\n').trim();

  // Simple YAML parser for flat + shallow nested structures
  const meta: Record<string, unknown> = {};
  let currentKey = '';
  let currentArray: string[] | null = null;

  for (const line of yamlLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Array item
    if (trimmed.startsWith('- ') && currentArray !== null) {
      currentArray.push(trimmed.slice(2).trim());
      continue;
    }

    // If we were collecting an array, save it
    if (currentArray !== null) {
      meta[currentKey] = currentArray;
      currentArray = null;
    }

    // Key-value pair
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();

    if (value === '') {
      // Could be start of an array or nested object
      currentKey = key;
      currentArray = [];
    } else {
      // Remove quotes if present
      const cleaned = value.replace(/^["']|["']$/g, '');
      meta[key] = cleaned;
    }
  }

  // Save final array if we were collecting one
  if (currentArray !== null) {
    meta[currentKey] = currentArray;
  }

  return { meta, body };
}

// ---------------------------------------------------------------------------
// Section Extraction
// ---------------------------------------------------------------------------

/**
 * Extract content for a specific heading level section.
 * Looks for `## Level N` headings and extracts everything until the next `## Level` heading.
 */
function extractLevel(body: string, level: number): string {
  const levelPatterns: Record<number, RegExp> = {
    1: /^##\s+Level\s+1\b.*$/im,
    2: /^##\s+Level\s+2\b.*$/im,
    3: /^##\s+Level\s+3\b.*$/im,
  };

  const pattern = levelPatterns[level];
  if (!pattern) return '';

  const match = body.match(pattern);
  if (!match || match.index === undefined) return '';

  const startIndex = match.index + match[0].length;
  const remaining = body.slice(startIndex);

  // Find the next ## Level heading
  const nextLevelMatch = remaining.match(/^##\s+Level\s+\d\b/im);
  const endIndex = nextLevelMatch?.index ?? remaining.length;

  return remaining.slice(0, endIndex).trim();
}

// ---------------------------------------------------------------------------
// Skill Loading
// ---------------------------------------------------------------------------

/** Cache of parsed skills keyed by skill name. */
const skillCache = new Map<string, ParsedSkill>();

/**
 * Load and parse a single SKILL.md file.
 */
function loadSkillFile(dirPath: string): ParsedSkill | null {
  const skillFile = join(dirPath, 'SKILL.md');
  if (!existsSync(skillFile)) return null;

  try {
    const content = readFileSync(skillFile, 'utf-8');
    const { meta, body } = parseFrontmatter(content);

    const parsed: ParsedSkill = {
      meta: {
        name: (meta.name as string) || basename(dirPath),
        category: (meta.category as string) || 'uncategorized',
        version: (meta.version as string) || '1.0',
        target_type: (meta.target_type as TargetType) || 'web_app',
        required_capabilities: (meta.required_capabilities as string[]) || [],
        default_config: meta.default_config as Record<string, unknown> || {},
        cleanup_profile: meta.cleanup_profile as string | undefined,
      },
      body,
      level1: extractLevel(body, 1),
      level2: extractLevel(body, 2),
      level3: extractLevel(body, 3),
      path: `skills/${basename(dirPath)}/SKILL.md`,
    };

    return parsed;
  } catch (err) {
    console.error(`Failed to load skill at ${dirPath}:`, err);
    return null;
  }
}

/**
 * Load all skills from the skills/ directory.
 * Results are cached in memory.
 */
export function loadAllSkills(): ParsedSkill[] {
  if (skillCache.size > 0) {
    return Array.from(skillCache.values());
  }

  if (!existsSync(SKILLS_ROOT)) {
    console.warn(`Skills directory not found at ${SKILLS_ROOT}`);
    return [];
  }

  const dirs = readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const dir of dirs) {
    const skill = loadSkillFile(join(SKILLS_ROOT, dir));
    if (skill) {
      skillCache.set(skill.meta.name, skill);
    }
  }

  return Array.from(skillCache.values());
}

/**
 * Get a parsed skill by name.
 */
export function getSkill(name: string): ParsedSkill | null {
  // Ensure skills are loaded
  if (skillCache.size === 0) loadAllSkills();
  return skillCache.get(name) || null;
}

/**
 * Clear the skill cache (e.g. when skills are updated on disk).
 */
export function clearSkillCache(): void {
  skillCache.clear();
}

// ---------------------------------------------------------------------------
// Progressive Disclosure
// ---------------------------------------------------------------------------

/**
 * Get the appropriate skill content for a given disclosure level.
 *
 * - Level 1: Only the quick brief (~200 tokens, for experienced agents)
 * - Level 2: Brief + detailed instructions (~1000 tokens, standard execution)
 * - Level 3: Everything including exhaustive reference (full document)
 */
export function getSkillContent(skill: ParsedSkill, level: DisclosureLevel): string {
  const header = `# Skill: ${skill.meta.name} (v${skill.meta.version})\n\n`;

  switch (level) {
    case 1:
      return header + skill.level1;
    case 2:
      return header + skill.level1 + '\n\n' + skill.level2;
    case 3:
      return header + skill.body;
    default:
      return header + skill.level2;
  }
}

/**
 * Determine the appropriate disclosure level for a task.
 *
 * Heuristics:
 * - First iteration → Level 2 (standard)
 * - Subsequent iterations (agent already knows the task) → Level 1
 * - Failed previous attempt or escalation → Level 3
 * - Cleanup tasks → Level 2 always (need specific rules)
 */
export function determineDisclosureLevel(
  taskType: TaskType,
  iteration: number,
  previousFailed: boolean
): DisclosureLevel {
  // Escalated or previously failed → give everything
  if (previousFailed) return 3;

  // Cleanup tasks always get full instructions (they need the specific rules)
  if (taskType === 'cleanup') return 2;

  // First iteration → standard level
  if (iteration <= 1) return 2;

  // Subsequent iterations → agent already has context, just give brief
  return 1;
}

// ---------------------------------------------------------------------------
// Skill Router
// ---------------------------------------------------------------------------

/**
 * Find the best matching skill for a given target type and task type.
 *
 * Routing logic:
 * 1. Exact match on category name (e.g. "web-app-build")
 * 2. Match by target_type + task type pattern
 * 3. Fallback to the first skill matching the target_type
 */
export function findSkill(
  targetType: TargetType,
  taskType: TaskType
): ParsedSkill | null {
  const skills = loadAllSkills();

  // Build the expected category name pattern
  const targetPrefix = targetType.replace('_', '-'); // web_app → web-app
  const categoryName = `${targetPrefix}-${taskType === 'implementation' ? 'build' : taskType}`;

  // 1. Exact match on category
  const exactMatch = skills.find(s => s.meta.category === categoryName);
  if (exactMatch) return exactMatch;

  // 2. Match by target_type and name pattern
  const nameMatch = skills.find(
    s => s.meta.target_type === targetType && s.meta.name.includes(taskType)
  );
  if (nameMatch) return nameMatch;

  // 3. Fallback: any skill matching target_type
  const fallback = skills.find(s => s.meta.target_type === targetType);
  return fallback || null;
}

/**
 * Get the full skill prompt for an agent, given a task context.
 *
 * This is the main function called by the task executor to build
 * the skill instructions that get sent to the agent.
 */
export function buildSkillPrompt(
  skillName: string,
  taskType: TaskType,
  iteration: number,
  previousFailed: boolean
): string | null {
  const skill = getSkill(skillName);
  if (!skill) return null;

  const level = determineDisclosureLevel(taskType, iteration, previousFailed);
  return getSkillContent(skill, level);
}
