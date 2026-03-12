/**
 * Change Classifier — Determines Track A (config) vs Track B (code)
 *
 * Analyzes user intent to determine if a change can be handled
 * by modifying rules/config (instant) or requires code changes (rebuild).
 */

export interface ClassificationResult {
  track: 'A' | 'B';
  confidence: number;
  reasoning: string;
  proposed_changes?: {
    rules?: Array<{ category: string; key: string; value: unknown; action: 'create' | 'update' | 'delete' }>;
    files?: Array<{ path: string; action: 'create' | 'modify' | 'delete'; description: string }>;
  };
  risk_level: 'low' | 'medium' | 'high';
}

// Keywords that strongly suggest Track A (config/rules)
const TRACK_A_SIGNALS = [
  'iteration', 'iterations', 'rule', 'rules', 'threshold', 'limit',
  'preset', 'config', 'configuration', 'setting', 'preference',
  'enable', 'disable', 'toggle', 'switch', 'change model', 'model tier',
  'min_', 'max_', 'quality', 'strict', 'permissive', 'normal',
  'policy', 'workflow', 'fps', 'frame rate', 'resolution',
];

// Keywords that strongly suggest Track B (code changes)
const TRACK_B_SIGNALS = [
  'add tab', 'new tab', 'new component', 'new endpoint', 'new api',
  'new feature', 'new page', 'integration', 'install', 'npm',
  'change ui', 'redesign', 'refactor', 'new button', 'webhook',
  'database', 'new table', 'migration', 'deploy', 'build',
  'file upload', 'authentication', 'new route',
];

/**
 * Classify a user request as Track A or Track B.
 * Uses keyword matching + heuristics. For ambiguous cases,
 * defaults to Track A (less risky).
 */
export function classifyChange(userMessage: string): ClassificationResult {
  const lower = userMessage.toLowerCase();

  let aScore = 0;
  let bScore = 0;
  const aMatches: string[] = [];
  const bMatches: string[] = [];

  for (const signal of TRACK_A_SIGNALS) {
    if (lower.includes(signal)) {
      aScore += 2;
      aMatches.push(signal);
    }
  }

  for (const signal of TRACK_B_SIGNALS) {
    if (lower.includes(signal)) {
      bScore += 2;
      bMatches.push(signal);
    }
  }

  // Boost Track A if talking about numbers/values
  if (/\b\d+\b/.test(lower) && aScore > 0) aScore += 1;

  // Boost Track B if talking about creating/adding new things
  if (/(add|create|build|implement|make)\s+(a|an|the|new)/i.test(lower)) bScore += 2;

  // If it mentions "rules" or "settings" explicitly, strong Track A signal
  if (/\b(adjust|modify|update|change)\s+(the\s+)?(rules?|settings?|config)/i.test(lower)) aScore += 3;

  const total = aScore + bScore;
  const isTrackA = aScore >= bScore;
  const confidence = total > 0 ? Math.min(0.95, (Math.abs(aScore - bScore) / total) * 0.5 + 0.5) : 0.5;

  // Determine risk level
  let risk_level: 'low' | 'medium' | 'high' = 'low';
  if (!isTrackA) {
    if (bMatches.some(m => ['authentication', 'database', 'migration'].includes(m))) {
      risk_level = 'high';
    } else if (bMatches.length > 2) {
      risk_level = 'medium';
    }
  }

  return {
    track: isTrackA ? 'A' : 'B',
    confidence,
    reasoning: isTrackA
      ? `Detected config/rule signals: ${aMatches.join(', ') || 'general preference language'}`
      : `Detected code change signals: ${bMatches.join(', ') || 'structural change language'}`,
    risk_level,
  };
}

/**
 * Format the classification as a user-facing explanation.
 */
export function explainClassification(result: ClassificationResult): string {
  if (result.track === 'A') {
    return `This is a **config change** — I can update rules/settings instantly without any rebuild.\n` +
           `Confidence: ${Math.round(result.confidence * 100)}% · Risk: ${result.risk_level}`;
  } else {
    return `This requires a **code change** — I'll need to modify source files, rebuild, and redeploy.\n` +
           `Confidence: ${Math.round(result.confidence * 100)}% · Risk: ${result.risk_level}`;
  }
}
