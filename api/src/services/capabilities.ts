/**
 * Dynamic Capabilities Manifest
 *
 * Builds a live snapshot of what the agent can actually do RIGHT NOW:
 * - Which API keys are configured (vault)
 * - Which services are healthy
 * - Which skills are installed
 * - Which fleet agents exist
 *
 * Injected into the system prompt at chat time so the agent
 * always knows its true capabilities.
 */
import { query } from './database';
import { checkLiteLLMHealth } from './litellm';
import { logActivity } from './activity-broadcaster';
import fs from 'fs/promises';
import path from 'path';

const VAULT_PREFIX = 'vault.';
const SKILLS_DIR = process.env.SKILLS_DIR || '/home/node/.claude/skills';
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/workspace';
const MEMU_URL = process.env.MEMU_URL || 'http://localhost:8090';
const ANYTHINGLLM_URL = process.env.ANYTHINGLLM_URL || 'http://localhost:3001';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

// ── Key Registry (human names for vault IDs) ─────────────

const KEY_NAMES: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  gemini: 'Google Gemini',
  grok: 'Grok (xAI)',
  manus: 'Manus AI',
  elevenlabs: 'ElevenLabs (Voice TTS)',
  runway: 'Runway (Video Gen)',
  heygen: 'HeyGen (Avatar Video)',
  deepgram: 'DeepGram (Speech-to-Text)',
  kling: 'Kling (Video Gen)',
  slack_bot: 'Slack Bot',
  slack_app: 'Slack App',
  slack_signing: 'Slack Signing Secret',
  brave_search: 'Brave Search (Web Search)',
  x_api: 'X/Twitter API',
  anythingllm: 'AnythingLLM (RAG)',
  litellm_master: 'LiteLLM Master Key',
};

const KEY_CAPABILITIES: Record<string, string> = {
  anthropic: 'Use Claude models via LiteLLM for AI tasks',
  openai: 'Use GPT models for code, crosscheck, and critic tasks',
  gemini: 'Use Gemini for creative, visual, and design tasks',
  grok: 'Use Grok models for alternative AI perspectives',
  manus: 'Use Manus AI agent platform',
  elevenlabs: 'Generate speech and voice from text (TTS)',
  runway: 'Generate AI videos from text/image prompts',
  heygen: 'Create AI avatar videos with custom scripts',
  deepgram: 'Transcribe speech to text in real-time (STT)',
  kling: 'Generate videos using Kling AI',
  slack_bot: 'Send and receive Slack messages',
  slack_app: 'Access Slack app-level features (Socket Mode)',
  brave_search: 'Search the web using Brave Search API',
  x_api: 'Access X/Twitter data and posting',
  anythingllm: 'Search uploaded documents via RAG (knowledge base)',
  litellm_master: 'Route requests across AI model tiers',
};

// ── Service Health Checks ────────────────────────────────

async function checkService(url: string, timeout = 3000): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    return r.status > 0 && r.status < 500;
  } catch {
    return false;
  }
}

// ── Build Manifest ───────────────────────────────────────

export interface CapabilityManifest {
  configuredKeys: Array<{ id: string; name: string; capability: string }>;
  missingKeys: Array<{ id: string; name: string; capability: string }>;
  services: Record<string, boolean>;
  skills: Array<{ name: string; description: string }>;
  fleetAgents: Array<{ name: string; status: string; model: string }>;
  summary: string;
}

export async function buildCapabilityManifest(): Promise<CapabilityManifest> {
  const manifest: CapabilityManifest = {
    configuredKeys: [],
    missingKeys: [],
    services: {},
    skills: [],
    fleetAgents: [],
    summary: '',
  };

  // 1. Check configured vault keys
  try {
    const result = await query(
      `SELECT key FROM settings WHERE key LIKE $1`,
      [`${VAULT_PREFIX}%`]
    );
    const configuredIds = new Set(result.rows.map((r: any) => r.key.replace(VAULT_PREFIX, '')));

    for (const [id, name] of Object.entries(KEY_NAMES)) {
      if (configuredIds.has(id)) {
        manifest.configuredKeys.push({
          id,
          name,
          capability: KEY_CAPABILITIES[id] || '',
        });
      } else {
        manifest.missingKeys.push({
          id,
          name,
          capability: KEY_CAPABILITIES[id] || '',
        });
      }
    }
  } catch {
    // DB down — can't check keys
  }

  // 2. Check service health (in parallel)
  const [litellm, ollama, memu, anythingllm] = await Promise.all([
    checkLiteLLMHealth(),
    checkService(`${OLLAMA_URL}/api/tags`),
    checkService(`${MEMU_URL}/health`),
    checkService(`${ANYTHINGLLM_URL}/api/v1/auth`),
  ]);
  manifest.services = { litellm, ollama, memu, anythingllm };

  // 3. List installed skills
  try {
    // Check standard skills dir
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMd = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
        try {
          const content = await fs.readFile(skillMd, 'utf-8');
          const descLine = content.split('\n').find(l => l.trim().length > 10 && !l.startsWith('#') && !l.startsWith('---'));
          manifest.skills.push({
            name: entry.name,
            description: descLine?.trim() || '',
          });
        } catch { /* no SKILL.md */ }
      }
    }

    // Also scan workspace for agent-created skills
    const workspaceSkillDirs = [
      path.join(WORKSPACE_ROOT, 'skills'),
      path.join(WORKSPACE_ROOT, '.skills'),
    ];
    for (const dir of workspaceSkillDirs) {
      try {
        const wsEntries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of wsEntries) {
          if (entry.isDirectory()) {
            const skillMd = path.join(dir, entry.name, 'SKILL.md');
            try {
              const content = await fs.readFile(skillMd, 'utf-8');
              const descLine = content.split('\n').find(l => l.trim().length > 10 && !l.startsWith('#') && !l.startsWith('---'));
              if (!manifest.skills.some(s => s.name === entry.name)) {
                manifest.skills.push({
                  name: entry.name,
                  description: (descLine?.trim() || '') + ' (workspace)',
                });
              }
            } catch { /* no SKILL.md */ }
          }
        }
      } catch { /* dir doesn't exist */ }
    }
  } catch { /* skills dir error */ }

  // 4. List fleet agents
  try {
    const result = await query(
      `SELECT name, status, model FROM fleet_agents ORDER BY created_at DESC LIMIT 20`
    );
    manifest.fleetAgents = result.rows.map((r: any) => ({
      name: r.name,
      status: r.status,
      model: r.model,
    }));
  } catch { /* DB down or table doesn't exist */ }

  // 5. Build summary string
  manifest.summary = buildSummaryText(manifest);

  return manifest;
}

// ── Format for System Prompt ─────────────────────────────

function buildSummaryText(m: CapabilityManifest): string {
  const lines: string[] = [];

  lines.push('LIVE CAPABILITY STATUS (auto-generated):');
  lines.push('');

  // Keys
  if (m.configuredKeys.length > 0) {
    lines.push(`Active API Keys (${m.configuredKeys.length}):`);
    for (const k of m.configuredKeys) {
      lines.push(`  ✓ ${k.name} — ${k.capability}`);
    }
  }

  const importantMissing = m.missingKeys.filter(k =>
    !['kling', 'manus', 'grok', 'litellm_master', 'slack_signing'].includes(k.id)
  );
  if (importantMissing.length > 0) {
    lines.push(`Not Configured (${importantMissing.length}):`);
    for (const k of importantMissing) {
      lines.push(`  ✗ ${k.name} — ${k.capability} [user must add key in Settings → Security]`);
    }
  }
  lines.push('');

  // Services
  lines.push('Services:');
  lines.push(`  ${m.services.litellm ? '✓' : '✗'} LiteLLM (multi-model routing)`);
  lines.push(`  ${m.services.ollama ? '✓' : '✗'} Ollama (local models & embeddings)`);
  lines.push(`  ${m.services.memu ? '✓' : '✗'} memU (semantic long-term memory)`);
  lines.push(`  ${m.services.anythingllm ? '✓' : '✗'} AnythingLLM (document RAG)`);
  lines.push('');

  // Skills
  if (m.skills.length > 0) {
    lines.push(`Installed Skills (${m.skills.length}):`);
    for (const s of m.skills) {
      lines.push(`  • ${s.name}${s.description ? ' — ' + s.description : ''}`);
    }
    lines.push('');
  }

  // Fleet
  if (m.fleetAgents.length > 0) {
    const running = m.fleetAgents.filter(a => a.status === 'running');
    const stopped = m.fleetAgents.filter(a => a.status !== 'running');
    if (running.length > 0) {
      lines.push(`Running Fleet Agents (${running.length}):`);
      for (const a of running) {
        lines.push(`  🟢 ${a.name} (${a.model})`);
      }
    }
    if (stopped.length > 0) {
      lines.push(`Stopped Fleet Agents (${stopped.length}):`);
      for (const a of stopped) {
        lines.push(`  ⏸ ${a.name}`);
      }
    }
    lines.push('');
  }

  // Memory guidance
  if (m.services.memu) {
    lines.push('MEMORY: memU is available. Use memory_search before starting non-trivial tasks to check for prior context. Use memory_save to store key decisions and learnings.');
  }

  return lines.join('\n');
}

/**
 * Get the capability manifest as a string ready to inject into the system prompt.
 * Cached for 30 seconds to avoid hammering health checks on every message.
 */
let cachedManifest: { text: string; timestamp: number } | null = null;
const CACHE_TTL = 30_000; // 30 seconds

export async function getCapabilitySummary(): Promise<string> {
  const now = Date.now();
  if (cachedManifest && (now - cachedManifest.timestamp) < CACHE_TTL) {
    return cachedManifest.text;
  }

  try {
    const manifest = await buildCapabilityManifest();
    cachedManifest = { text: manifest.summary, timestamp: now };
    return manifest.summary;
  } catch (err) {
    logActivity('capabilities', 'warning', `Failed to build capability manifest: ${(err as Error).message}`);
    return '(Capability manifest unavailable)';
  }
}
