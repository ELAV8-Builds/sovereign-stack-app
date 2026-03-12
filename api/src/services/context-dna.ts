/**
 * Context DNA — Compressed worker state for continuity
 *
 * Captures the essential "DNA" of a worker's context:
 * - Active rules and versions
 * - User preferences from conversation history
 * - Key decisions made this session
 * - Files modified recently
 * - Active project context
 *
 * This DNA transfers to new workers when the old one is recycled at 85%.
 */
import { getEnabledRules, getLatestRuleVersion, logHealthEvent } from './overmind/db';
import { query } from './database';

export interface ContextDNA {
  id: string;
  worker_id: string;
  captured_at: string;
  context_usage: number;
  rules: {
    active_count: number;
    categories: Record<string, number>; // category → version
    key_rules: Array<{ category: string; key: string; value: unknown }>;
  };
  conversations: {
    recent_count: number;
    last_topics: string[];
  };
  decisions: Array<{
    decision: string;
    timestamp: string;
  }>;
  files_modified: string[];
  project_context: string;
}

/**
 * Capture the current context DNA for a worker.
 */
export async function captureContextDNA(
  workerId: string,
  contextUsage: number,
  additionalContext?: {
    decisions?: string[];
    files_modified?: string[];
    project_context?: string;
  }
): Promise<ContextDNA> {
  // 1. Get active rules snapshot
  const rules = await getEnabledRules('global');
  const categories = [...new Set(rules.map(r => r.category))];
  const categoryVersions: Record<string, number> = {};

  for (const cat of categories) {
    const latest = await getLatestRuleVersion(cat);
    categoryVersions[cat] = latest?.version || 0;
  }

  // 2. Get recent conversation topics
  let recentTopics: string[] = [];
  try {
    const { rows } = await query(
      `SELECT content FROM overmind_messages
       WHERE role = 'user'
       ORDER BY created_at DESC LIMIT 5`
    );
    recentTopics = (rows as any[]).map((r: any) => {
      const msg = String(r.content);
      return msg.length > 60 ? msg.slice(0, 60) + '...' : msg;
    });
  } catch {
    // Non-critical
  }

  // 3. Get recent conversation count
  let recentCount = 0;
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int as count FROM overmind_conversations
       WHERE created_at > NOW() - INTERVAL '24 hours'`
    );
    recentCount = (rows as any[])[0]?.count || 0;
  } catch {
    // Non-critical
  }

  const dna: ContextDNA = {
    id: `dna-${Date.now()}`,
    worker_id: workerId,
    captured_at: new Date().toISOString(),
    context_usage: contextUsage,
    rules: {
      active_count: rules.length,
      categories: categoryVersions,
      key_rules: rules.slice(0, 10).map(r => ({ category: r.category, key: r.key, value: r.value })),
    },
    conversations: {
      recent_count: recentCount,
      last_topics: recentTopics,
    },
    decisions: (additionalContext?.decisions || []).map(d => ({
      decision: d,
      timestamp: new Date().toISOString(),
    })),
    files_modified: additionalContext?.files_modified || [],
    project_context: additionalContext?.project_context || '',
  };

  // Log the capture
  await logHealthEvent({
    event_type: 'context_dna_captured',
    severity: 'info',
    source: 'context-dna',
    message: `DNA captured for worker ${workerId} at ${contextUsage}% context`,
    metadata: { worker_id: workerId, rules_count: rules.length, categories: Object.keys(categoryVersions).length },
  });

  return dna;
}

/**
 * Format DNA as a system prompt injection for a new worker.
 * This is how context transfers when a worker is recycled.
 */
export function formatDNAForPrompt(dna: ContextDNA): string {
  const parts: string[] = [
    '## CONTEXT DNA — Inherited from previous worker session',
    `Previous worker: ${dna.worker_id} (recycled at ${dna.context_usage}% context)`,
    '',
    '### Active Rules',
    `${dna.rules.active_count} rules across ${Object.keys(dna.rules.categories).length} categories:`,
  ];

  for (const [cat, ver] of Object.entries(dna.rules.categories)) {
    parts.push(`  - ${cat}: v${ver}`);
  }

  if (dna.rules.key_rules.length > 0) {
    parts.push('');
    parts.push('Key rules:');
    for (const r of dna.rules.key_rules) {
      parts.push(`  - ${r.category}.${r.key} = ${JSON.stringify(r.value)}`);
    }
  }

  if (dna.conversations.last_topics.length > 0) {
    parts.push('');
    parts.push('### Recent Conversation Topics');
    parts.push(`${dna.conversations.recent_count} conversations in the last 24h:`);
    for (const topic of dna.conversations.last_topics) {
      parts.push(`  - "${topic}"`);
    }
  }

  if (dna.decisions.length > 0) {
    parts.push('');
    parts.push('### Key Decisions This Session');
    for (const d of dna.decisions) {
      parts.push(`  - ${d.decision}`);
    }
  }

  if (dna.files_modified.length > 0) {
    parts.push('');
    parts.push('### Recently Modified Files');
    for (const f of dna.files_modified) {
      parts.push(`  - ${f}`);
    }
  }

  if (dna.project_context) {
    parts.push('');
    parts.push('### Project Context');
    parts.push(dna.project_context);
  }

  return parts.join('\n');
}
