/**
 * Overmind — LLM Integration Layer
 *
 * High-level functions that use LiteLLM for intelligent decision-making:
 *
 * 1. JOB PLANNING   — Parse user prompt → category + tasks + workflow
 * 2. CLEANUP ANALYSIS — Analyze codebase scan results → structured findings
 * 3. ITERATION LOGIC — Decide whether to iterate, accept, or escalate
 * 4. RESISTANCE DETECTION — Detect agents that are gaming the system
 *
 * All LLM calls go through the existing LiteLLM gateway.
 * Tier routing: heavy (Opus) for planning, coder (Sonnet) for analysis,
 * light (Haiku) for classification.
 */

import { chatCompletion, type ChatMessage } from '../litellm';
import * as db from './db';
import { findSkill } from './skills';
import { getActiveRules, getRuleValue } from './orchestrator';
import {
  findMatchingRecipes,
  recordRecipeUsage,
  recipeToJobConfig,
  type OvRecipe,
} from './recipes';
import type {
  OvJob,
  OvTask,
  OvCleanupReport,
  CreateJobInput,
  CleanupFinding,
  CleanupSeverity,
  TargetType,
  TaskType,
  WorkflowStep,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** System prompt prefix for all Overmind LLM calls. */
const OVERMIND_SYSTEM_PREFIX = `You are ELAV8 Overmind, the orchestration engine for a sovereign stack that manages AI agent workers. You are deterministic, thorough, and never trust agents to self-report quality. You always respond in structured JSON when asked.`;

// ---------------------------------------------------------------------------
// Job Planning
// ---------------------------------------------------------------------------

/**
 * Analyze a user prompt and generate a complete job plan.
 *
 * Uses the "heavy" (Opus) tier for architectural decisions.
 *
 * Returns:
 * - Suggested title
 * - Detected target type
 * - Recommended workflow steps
 * - Matched skill for each step
 */
export async function planJobFromPrompt(prompt: string): Promise<{
  title: string;
  target_type: TargetType;
  workflow: WorkflowStep[];
  reasoning: string;
}> {
  const systemPrompt = `${OVERMIND_SYSTEM_PREFIX}

Given a user's request, analyze it and produce a structured build plan.

Respond ONLY in JSON with this exact shape:
{
  "title": "short title for the job (under 60 chars)",
  "target_type": "web_app" | "mobile_app" | "website" | "desktop_app" | "other",
  "workflow": [
    { "type": "spec" | "implementation" | "cleanup" | "test" | "deploy", "skill_name": "optional skill name" }
  ],
  "reasoning": "1-2 sentences explaining your classification"
}

Rules:
- Every build job should include at minimum: spec, implementation, cleanup
- Add "test" if the user mentions testing or it's a complex app
- Add "deploy" if the user mentions deployment or hosting
- Cleanup is ALWAYS included — we never ship without cleanup
- For cleanup-only jobs, workflow is just [{"type": "cleanup"}]`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  const response = await chatCompletion({
    model: 'heavy',
    messages,
    temperature: 0.3,
    max_tokens: 1024,
  });

  try {
    // Extract JSON from the response (handle markdown code blocks)
    const jsonStr = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    return {
      title: parsed.title || 'Untitled Job',
      target_type: parsed.target_type || 'web_app',
      workflow: parsed.workflow || [
        { type: 'spec' },
        { type: 'implementation' },
        { type: 'cleanup' },
      ],
      reasoning: parsed.reasoning || '',
    };
  } catch {
    // Fallback if LLM doesn't return valid JSON
    return {
      title: prompt.slice(0, 60),
      target_type: 'web_app',
      workflow: [
        { type: 'spec' },
        { type: 'implementation' },
        { type: 'cleanup' },
      ],
      reasoning: 'LLM response was not valid JSON; using default workflow',
    };
  }
}

/**
 * Create a job from a user prompt using LLM planning.
 *
 * This is the main entry point for intelligent job creation:
 * 1. LLM analyzes the prompt → determines target_type + title
 * 2. Check for matching recipes → use recipe config if found
 * 3. Load dynamic rules (as fallback/merge)
 * 4. Create job in DB with merged config
 * 5. Auto-generate tasks based on workflow
 * 6. Create conversation thread
 *
 * @param prompt    - User's natural language request
 * @param source    - Channel: web, slack, or api
 * @param recipeId  - Optional: force use of a specific recipe
 */
export async function createPlannedJob(
  prompt: string,
  source: 'web' | 'slack' | 'api',
  recipeId?: string
): Promise<OvJob & { matched_recipe?: { id: string; name: string } }> {
  // Step 1: Plan the job (LLM determines target_type, title, workflow)
  const plan = await planJobFromPrompt(prompt);

  // Step 2: Check for matching recipe
  let matchedRecipe: OvRecipe | null = null;
  let recipeConfig: ReturnType<typeof recipeToJobConfig> | null = null;

  if (recipeId) {
    // Explicit recipe requested
    const { getRecipe } = await import('./recipes');
    matchedRecipe = await getRecipe(recipeId);
    if (matchedRecipe) {
      recipeConfig = recipeToJobConfig(matchedRecipe);
    }
  } else {
    // Auto-match by target_type
    const matches = await findMatchingRecipes(plan.target_type, prompt, 1);
    if (matches.length > 0) {
      matchedRecipe = matches[0];
      recipeConfig = recipeToJobConfig(matchedRecipe);
    }
  }

  // Step 3: Load dynamic rules for this target type
  const rules = await getActiveRules(plan.target_type);

  // Step 4: Merge config — recipe overrides > live rules > defaults
  const minIterations = recipeConfig?.min_iterations
    ?? getRuleValue(rules, 'iteration', 'min_iterations', 2);
  const maxIterations = recipeConfig?.max_iterations
    ?? getRuleValue(rules, 'iteration', 'max_iterations', 5);
  const maxLow = recipeConfig?.cleanup_thresholds?.max_low
    ?? getRuleValue(rules, 'thresholds', 'max_low', 10);
  const maxMedium = recipeConfig?.cleanup_thresholds?.max_medium
    ?? getRuleValue(rules, 'thresholds', 'max_medium', 3);
  const maxHigh = recipeConfig?.cleanup_thresholds?.max_high
    ?? getRuleValue(rules, 'thresholds', 'max_high', 0);
  const failOnCritical = recipeConfig?.cleanup_thresholds?.fail_on_critical
    ?? getRuleValue(rules, 'thresholds', 'fail_on_critical', true);

  // Determine workflow — recipe steps > LLM-planned workflow
  const workflow = recipeConfig?.workflow && recipeConfig.workflow.length > 0
    ? recipeConfig.workflow
    : plan.workflow;

  // Step 5: Create the job with merged config
  const job = await db.createJob({
    title: plan.title,
    description: prompt,
    source,
    target_type: plan.target_type,
    config: {
      min_iterations: minIterations,
      max_iterations: maxIterations,
      cleanup_thresholds: {
        max_low: maxLow,
        max_medium: maxMedium,
        max_high: maxHigh,
        fail_on_critical: failOnCritical,
      },
      workflow,
      // Recipe metadata (if used)
      ...(recipeConfig ? {
        recipe_id: recipeConfig.recipe_id,
        recipe_name: recipeConfig.recipe_name,
        tools: recipeConfig.tools,
        llm_tiers: recipeConfig.llm_tiers,
        iteration_passes: recipeConfig.iteration_passes,
      } : {}),
      // Snapshot the active rules at job creation time for audit trail
      rules_snapshot: rules.map(r => ({ category: r.category, key: r.key, value: r.value })),
    },
  });

  // Step 6: Create tasks for each workflow step
  for (let i = 0; i < workflow.length; i++) {
    const step = workflow[i];

    // Find the best skill for this step
    const skill = findSkill(plan.target_type, step.type as TaskType);

    await db.createTask(job.id, step.type as TaskType, {
      sequence: i,
      skill_name: step.skill_name || skill?.meta.name || null,
      skill_config: skill?.meta.default_config || {},
      prompt: prompt,
      max_iterations: maxIterations,
      status: i === 0 ? 'queued' : 'pending',
    });
  }

  // Step 7: Create a conversation and log the user message
  const conversation = await db.createConversation(job.id, source);
  await db.addMessage(conversation.id, 'user', prompt);

  const recipeNote = matchedRecipe
    ? `\nRecipe: "${matchedRecipe.name}" (matched ${matchedRecipe.target_type})`
    : '\nRecipe: None (LLM-planned)';

  await db.addMessage(
    conversation.id,
    'overmind',
    `Job planned: "${plan.title}"\nTarget: ${plan.target_type}\nWorkflow: ${workflow.map(w => w.type).join(' → ')}${recipeNote}\nReasoning: ${plan.reasoning}`
  );

  // Step 8: Set job to planning status
  await db.updateJobStatus(job.id, 'planning');

  // Step 9: Record recipe usage
  if (matchedRecipe) {
    await recordRecipeUsage(matchedRecipe.id).catch(() => {});
  }

  // Return with recipe match info
  const result = job as OvJob & { matched_recipe?: { id: string; name: string } };
  if (matchedRecipe) {
    result.matched_recipe = { id: matchedRecipe.id, name: matchedRecipe.name };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Cleanup Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze codebase scan results using LLM and produce structured findings.
 *
 * Uses the "coder" (Sonnet) tier for code analysis.
 *
 * @param scanResults - Raw output from linters (tsc, eslint, etc.)
 * @param profilePrompt - The LLM prompt template from the cleanup profile
 * @param codeContext - Optional: relevant code snippets for context
 */
export async function analyzeCleanup(
  scanResults: string,
  profilePrompt: string,
  codeContext?: string
): Promise<{
  severity: CleanupSeverity;
  findings: CleanupFinding[];
  summary: string;
  passed: boolean;
}> {
  const systemPrompt = `${OVERMIND_SYSTEM_PREFIX}

${profilePrompt}

Respond ONLY in JSON with this exact shape:
{
  "severity": "none" | "low" | "medium" | "high" | "critical",
  "findings": [
    {
      "rule": "name of the check that failed",
      "severity": "low" | "medium" | "high" | "critical",
      "file": "path/to/file.ts" or null,
      "line": 42 or null,
      "message": "description of the issue and suggested fix"
    }
  ],
  "summary": "1-2 sentence overview of the codebase quality",
  "passed": true | false
}

Rules:
- severity is the HIGHEST severity across all findings
- If there are no issues, severity is "none" and findings is empty
- Be specific about file paths and line numbers when possible
- Do not rationalize or hide issues — list ALL of them
- "passed" should be true only if no high or critical issues`;

  const userContent = codeContext
    ? `## Scan Results\n\n${scanResults}\n\n## Code Context\n\n${codeContext}`
    : `## Scan Results\n\n${scanResults}`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  const response = await chatCompletion({
    model: 'coder',
    messages,
    temperature: 0.2,
    max_tokens: 4096,
  });

  try {
    const jsonStr = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    return {
      severity: parsed.severity || 'none',
      findings: (parsed.findings || []).map((f: any) => ({
        rule: f.rule || 'unknown',
        severity: f.severity || 'low',
        file: f.file || null,
        line: f.line || null,
        message: f.message || '',
      })),
      summary: parsed.summary || '',
      passed: parsed.passed ?? true,
    };
  } catch {
    return {
      severity: 'medium',
      findings: [{
        rule: 'llm_parse_error',
        severity: 'medium',
        file: null,
        line: null,
        message: 'LLM cleanup analysis returned invalid JSON. Manual review needed.',
      }],
      summary: 'Unable to parse LLM analysis output.',
      passed: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Iteration Logic
// ---------------------------------------------------------------------------

/**
 * Given a cleanup report, decide the next action for the task.
 *
 * Decision matrix (now uses dynamic rules with job.config as fallback):
 * - All clear (no findings) → COMPLETE
 * - Low findings only, under threshold → COMPLETE (with advisory)
 * - Medium+ findings, under max iterations → ITERATE (send back to agent)
 * - Medium+ findings, AT max iterations → ESCALATE (human review)
 * - Critical findings → ALWAYS ESCALATE
 * - Under min_iterations → ALWAYS ITERATE (even if passing)
 */
export async function decideNextAction(
  task: OvTask,
  report: OvCleanupReport,
  job: OvJob
): Promise<{
  action: 'complete' | 'iterate' | 'escalate';
  reason: string;
  iteration_prompt?: string;
}> {
  // Load current rules (may have changed since job was created)
  const rules = await getActiveRules(job.target_type);

  // Merge: live rules take priority, job.config as fallback
  const jobThresholds = job.config?.cleanup_thresholds;
  const maxLow = getRuleValue(rules, 'thresholds', 'max_low', jobThresholds?.max_low ?? 10);
  const maxMedium = getRuleValue(rules, 'thresholds', 'max_medium', jobThresholds?.max_medium ?? 3);
  const maxHigh = getRuleValue(rules, 'thresholds', 'max_high', jobThresholds?.max_high ?? 0);
  const failOnCritical = getRuleValue(rules, 'thresholds', 'fail_on_critical', jobThresholds?.fail_on_critical ?? true);
  const minIterations = getRuleValue(rules, 'iteration', 'min_iterations', job.config?.min_iterations ?? 2);
  const maxIterations = getRuleValue(rules, 'iteration', 'max_iterations', job.config?.max_iterations ?? 5);

  const findings = report.findings;
  const counts = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const f of findings) {
    if (f.severity in counts) {
      counts[f.severity as keyof typeof counts]++;
    }
  }

  // Critical → always escalate
  if (failOnCritical && counts.critical > 0) {
    return {
      action: 'escalate',
      reason: `${counts.critical} critical finding(s) detected. Requires human review.`,
    };
  }

  // Check against thresholds
  const overThreshold =
    counts.high > maxHigh ||
    counts.medium > maxMedium ||
    counts.low > maxLow;

  // Determine the pass configuration for the NEXT iteration
  const nextPassConfig = getPassConfig(task.iteration, job);

  // Enforce minimum iterations — even if clean, iterate until min is met
  if (!overThreshold && task.iteration >= minIterations) {
    return {
      action: 'complete',
      reason: `All findings within thresholds (low: ${counts.low}/${maxLow}, medium: ${counts.medium}/${maxMedium}, high: ${counts.high}/${maxHigh}). Min iterations (${minIterations}) met.`,
    };
  }

  // Under min iterations but clean → still iterate with verification pass
  if (!overThreshold && task.iteration < minIterations) {
    const iterationPrompt = await generateIterationPrompt(task, findings, 'verification');
    return {
      action: 'iterate',
      reason: `Findings within thresholds but minimum iterations not met (${task.iteration}/${minIterations}). Running ${nextPassConfig.type} pass.`,
      iteration_prompt: iterationPrompt || 'Run a verification pass. Review all changes for edge cases, missing error handling, and potential regressions.',
    };
  }

  // Over threshold — can we iterate?
  if (task.iteration < maxIterations) {
    const iterationPrompt = await generateIterationPrompt(task, findings, nextPassConfig.type);

    return {
      action: 'iterate',
      reason: `Findings exceed thresholds. Iteration ${task.iteration + 1}/${maxIterations} (${nextPassConfig.type}, ${nextPassConfig.tier} tier)`,
      iteration_prompt: iterationPrompt,
    };
  }

  // Max iterations reached — check escalation mode
  const escalationMode = (job.config as any)?.iteration_passes?.escalation_mode || 'escalate';
  if (escalationMode === 'force_complete') {
    return {
      action: 'complete',
      reason: `Max iterations (${maxIterations}) reached with ${findings.length} remaining issues. Force-completing per escalation mode.`,
    };
  }

  // Default: escalate
  return {
    action: 'escalate',
    reason: `Max iterations (${maxIterations}) reached with ${findings.length} remaining issues`,
  };
}

// ---------------------------------------------------------------------------
// Iteration Pass Types
// ---------------------------------------------------------------------------

/** Pass type determines HOW the agent approaches each iteration. */
export type IterationPassType =
  | 'full_build'
  | 'focused_fixes'
  | 'resistance_check'
  | 'deep_remediation'
  | 'verification';

/**
 * Determine the pass configuration for a given iteration number.
 *
 * Checks job config for recipe-defined passes first, then falls back to
 * the default progressive escalation pattern.
 */
export function getPassConfig(
  iteration: number,
  job: OvJob
): { type: IterationPassType; disclosure: number; tier: string } {
  // Check for recipe-defined iteration passes
  const passes = job.config?.iteration_passes as Array<{
    iteration: number;
    type: string;
    disclosure: number;
    tier: string;
  }> | undefined;

  if (passes && passes.length > 0) {
    // Find the matching pass config (1-indexed in config)
    const match = passes.find(p => p.iteration === iteration + 1);
    if (match) {
      return {
        type: match.type as IterationPassType,
        disclosure: match.disclosure,
        tier: match.tier,
      };
    }
    // If iteration exceeds defined passes, use the last one
    const last = passes[passes.length - 1];
    return {
      type: last.type as IterationPassType,
      disclosure: last.disclosure,
      tier: last.tier,
    };
  }

  // Default progressive escalation pattern
  if (iteration === 0) {
    return { type: 'full_build', disclosure: 2, tier: 'coder' };
  }
  if (iteration === 1) {
    return { type: 'focused_fixes', disclosure: 1, tier: 'light' };
  }
  if (iteration === 2) {
    return { type: 'resistance_check', disclosure: 3, tier: 'coder' };
  }
  // iteration >= 3
  return { type: 'deep_remediation', disclosure: 3, tier: 'heavy' };
}

/**
 * Generate an iteration prompt for the agent based on:
 * - Cleanup findings
 * - Pass type (determines prompt strategy)
 * - Iteration history (for resistance detection context)
 */
async function generateIterationPrompt(
  task: OvTask,
  findings: CleanupFinding[],
  passType?: IterationPassType
): Promise<string> {
  const effectivePassType = passType || 'focused_fixes';

  // Build different system prompts based on pass type
  let systemPrompt: string;

  switch (effectivePassType) {
    case 'full_build':
      systemPrompt = `${OVERMIND_SYSTEM_PREFIX}

You are generating a comprehensive build prompt for an AI agent worker.
The agent should perform a full implementation pass, addressing all identified issues.
Be thorough — include context for each fix.

Output a plain text prompt (NOT JSON). Keep it under 800 words.`;
      break;

    case 'focused_fixes':
      systemPrompt = `${OVERMIND_SYSTEM_PREFIX}

You are generating a focused remediation prompt for an AI agent worker.
Given the cleanup findings below, write a clear, actionable prompt that tells
the agent EXACTLY what to fix. Be specific about files and issues.
Only include the specific issues — do not ask for broad changes.

Output a plain text prompt (NOT JSON). Keep it under 500 words.
Start with "Fix the following issues:" then list each issue with the fix.`;
      break;

    case 'resistance_check':
      systemPrompt = `${OVERMIND_SYSTEM_PREFIX}

You are generating a RESISTANCE CHECK prompt. The agent has been given these same
issues before and has not fixed them. This prompt should be more forceful:
1. List each unfixed issue with explicit instructions
2. Warn that repeated failure will result in compliance penalties
3. Ask the agent to explain WHY each issue persists if it cannot fix it
4. Suggest alternative approaches if the obvious fix doesn't work

Output a plain text prompt (NOT JSON). Keep it under 600 words.
Start with "RESISTANCE CHECK — The following issues persist from previous iterations:"`;
      break;

    case 'deep_remediation':
      systemPrompt = `${OVERMIND_SYSTEM_PREFIX}

You are generating a DEEP REMEDIATION prompt. This is a last-resort iteration
with a higher-tier LLM. The agent gets full context and maximum detail.
Include:
1. Every remaining issue with full context
2. Root cause analysis hints
3. Step-by-step fix instructions
4. Potential side effects to watch for
5. Verification steps the agent should run

Output a plain text prompt (NOT JSON). Keep it under 1000 words.
Start with "DEEP REMEDIATION — Critical iteration with full context:"`;
      break;

    case 'verification':
      systemPrompt = `${OVERMIND_SYSTEM_PREFIX}

You are generating a VERIFICATION prompt. The cleanup passed thresholds but
we need a final verification pass to catch edge cases.
Ask the agent to:
1. Review all changes for edge cases
2. Check error handling paths
3. Verify no regressions were introduced
4. Run a final build verification

Output a plain text prompt (NOT JSON). Keep it under 400 words.
Start with "VERIFICATION PASS — Final review before acceptance:"`;
      break;

    default:
      systemPrompt = `${OVERMIND_SYSTEM_PREFIX}

Generate a remediation prompt for an AI agent. Be specific about files and issues.
Output plain text (NOT JSON). Keep it under 500 words.`;
  }

  const findingsText = findings.length > 0
    ? findings
        .map(f => `- [${f.severity}] ${f.file || 'unknown file'}${f.line ? `:${f.line}` : ''}: ${f.message}`)
        .join('\n')
    : 'No specific findings — run a general verification pass.';

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Task type: ${task.type}\nIteration: ${task.iteration}\nPass type: ${effectivePassType}\n\nFindings:\n${findingsText}`,
    },
  ];

  // Use the tier from pass config (default to light for speed)
  const tier = effectivePassType === 'deep_remediation' ? 'heavy'
    : effectivePassType === 'resistance_check' ? 'coder'
    : 'light';

  return chatCompletion({
    model: tier,
    messages,
    temperature: 0.3,
    max_tokens: effectivePassType === 'deep_remediation' ? 2048 : 1024,
  });
}

// ---------------------------------------------------------------------------
// Resistance Detection
// ---------------------------------------------------------------------------

/**
 * Check if an agent is "resisting" cleanup — i.e., producing the same
 * issues across multiple iterations without meaningful improvement.
 *
 * Returns a compliance adjustment (negative = penalty).
 */
export async function detectResistance(
  taskId: string
): Promise<{
  resistant: boolean;
  penalty: number;
  reason: string;
}> {
  const reports = await db.getCleanupReportsForTask(taskId);

  if (reports.length < 2) {
    return { resistant: false, penalty: 0, reason: 'Not enough iterations to detect resistance' };
  }

  // Compare the last two reports
  const previous = reports[reports.length - 2];
  const current = reports[reports.length - 1];

  const prevCount = previous.findings.length;
  const currCount = current.findings.length;

  // No improvement (or worse)
  if (currCount >= prevCount) {
    // Check if it's the same issues
    const prevRules = new Set(previous.findings.map(f => `${f.rule}:${f.file}`));
    const currRules = new Set(current.findings.map(f => `${f.rule}:${f.file}`));

    let overlap = 0;
    for (const rule of currRules) {
      if (prevRules.has(rule)) overlap++;
    }

    const overlapPct = currRules.size > 0 ? overlap / currRules.size : 0;

    if (overlapPct > 0.8) {
      return {
        resistant: true,
        penalty: 15,
        reason: `Agent produced ${(overlapPct * 100).toFixed(0)}% identical issues across iterations (${prevCount} → ${currCount} findings)`,
      };
    }

    if (currCount > prevCount) {
      return {
        resistant: true,
        penalty: 20,
        reason: `Findings increased from ${prevCount} to ${currCount}. Agent may be introducing new issues.`,
      };
    }
  }

  // Some improvement detected
  const improvementPct = ((prevCount - currCount) / prevCount) * 100;
  if (improvementPct < 10 && prevCount > 5) {
    return {
      resistant: false,
      penalty: 5,
      reason: `Marginal improvement (${improvementPct.toFixed(0)}%). Mild penalty applied.`,
    };
  }

  return {
    resistant: false,
    penalty: 0,
    reason: `Improvement detected: ${prevCount} → ${currCount} findings (${improvementPct.toFixed(0)}% reduction)`,
  };
}

// ---------------------------------------------------------------------------
// Category Suggestion
// ---------------------------------------------------------------------------

/**
 * Suggest or create a category for an uncategorized job.
 * Uses the "light" tier for fast classification.
 */
export async function suggestCategory(
  jobDescription: string
): Promise<{ category_id: string | null; suggested_name: string }> {
  // First, check existing categories
  const categories = await db.listCategories();

  if (categories.length === 0) {
    return { category_id: null, suggested_name: 'general' };
  }

  const categoryList = categories.map(c => `- ${c.name}: ${c.description || 'no description'}`).join('\n');

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${OVERMIND_SYSTEM_PREFIX}\n\nClassify a job into one of these existing categories. Respond with ONLY the category name, nothing else.\n\nCategories:\n${categoryList}`,
    },
    { role: 'user', content: jobDescription },
  ];

  const response = await chatCompletion({
    model: 'light',
    messages,
    temperature: 0.1,
    max_tokens: 50,
  });

  const suggested = response.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');

  // Try to match to an existing category
  const match = categories.find(
    c => c.name.toLowerCase() === suggested || c.name.toLowerCase().includes(suggested)
  );

  return {
    category_id: match?.id || null,
    suggested_name: match?.name || suggested,
  };
}
