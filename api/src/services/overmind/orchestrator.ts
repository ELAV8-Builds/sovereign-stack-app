/**
 * Overmind — Orchestrator Loop
 *
 * The main periodic process that drives the entire Overmind system.
 * Runs on configurable intervals and performs:
 *
 * 1. Agent health sweeps (every tick)
 * 2. Stuck task recovery (every tick)
 * 3. Task assignment from queue (every tick)
 * 4. Job completion checks (every tick)
 * 5. Context warden — monitor worker context, trigger checkpoints (every tick)
 * 6. Fleet health sweep — heartbeat-based worker status (every tick)
 * 7. Memory summaries (after job completion)
 * 8. Orchestrator self-health reporting
 *
 * The orchestrator is stateless — all state lives in PostgreSQL and Redis.
 * It's safe to restart at any time.
 */

import { orchestratorTick, publishEvent } from './agent-contract';
import { contextWardenTick, type WardenTickResult } from './context-warden';
import { sweepFleetHealth } from './fleet';
import { sweepFleetMachineHealth } from './fleets';
import { isSlackConfigured } from './slack';
import * as db from './db';
import type { OvRule } from './db';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** How often the orchestrator tick runs (milliseconds). */
const TICK_INTERVAL_MS = parseInt(process.env.OVERMIND_TICK_INTERVAL || '15000', 10);

/** Whether to run the orchestrator loop automatically. */
const AUTO_START = process.env.OVERMIND_AUTO_START !== 'false';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let tickInterval: NodeJS.Timeout | null = null;
let tickCount = 0;
let lastTickResult: Record<string, unknown> | null = null;
let isRunning = false;
let startedAt: Date | null = null;

// ---------------------------------------------------------------------------
// Orchestrator Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the orchestrator loop.
 * Safe to call multiple times — it won't create duplicate intervals.
 */
export function startOrchestrator(): void {
  if (tickInterval) {
    console.log('[overmind] Orchestrator already running');
    return;
  }

  isRunning = true;
  startedAt = new Date();
  tickCount = 0;

  console.log(`[overmind] Orchestrator starting (tick every ${TICK_INTERVAL_MS}ms)`);

  // Run first tick immediately
  runTick().catch(err => {
    console.error('[overmind] First tick failed:', err);
  });

  // Set up periodic ticks
  tickInterval = setInterval(() => {
    runTick().catch(err => {
      console.error('[overmind] Tick failed:', err);
    });
  }, TICK_INTERVAL_MS);
}

/**
 * Stop the orchestrator loop.
 */
export function stopOrchestrator(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  isRunning = false;
  console.log('[overmind] Orchestrator stopped');
}

/**
 * Get the current orchestrator status.
 */
export function getOrchestratorStatus(): {
  running: boolean;
  tick_count: number;
  tick_interval_ms: number;
  started_at: string | null;
  last_tick: Record<string, unknown> | null;
  slack_configured: boolean;
} {
  return {
    running: isRunning,
    tick_count: tickCount,
    tick_interval_ms: TICK_INTERVAL_MS,
    started_at: startedAt?.toISOString() || null,
    last_tick: lastTickResult,
    slack_configured: isSlackConfigured(),
  };
}

// ---------------------------------------------------------------------------
// Tick Execution
// ---------------------------------------------------------------------------

/**
 * Execute a single orchestrator tick.
 */
async function runTick(): Promise<void> {
  const tickStart = Date.now();
  tickCount++;

  try {
    // Core orchestrator tick (agents, tasks, jobs)
    const result = await orchestratorTick();

    // Context warden tick (monitor worker context, trigger checkpoints)
    let wardenResult: WardenTickResult | null = null;
    try {
      wardenResult = await contextWardenTick();
    } catch (wardenErr) {
      console.warn('[overmind] Context warden error (non-critical):', wardenErr);
    }

    // Fleet health sweep (heartbeat-based worker status)
    let fleetResult: { healthy: number; unhealthy: number; quarantined: number; context_hot: number } | null = null;
    try {
      fleetResult = await sweepFleetHealth();
    } catch (fleetErr) {
      console.warn('[overmind] Fleet sweep error (non-critical):', fleetErr);
    }

    // Fleet MACHINE health sweep (heartbeat-based machine status)
    let fleetMachineResult: { healthy: number; unhealthy: number; offline: number; suspended: number } | null = null;
    try {
      fleetMachineResult = await sweepFleetMachineHealth();
    } catch (machErr) {
      console.warn('[overmind] Fleet machine sweep error (non-critical):', machErr);
    }

    const elapsed = Date.now() - tickStart;
    lastTickResult = {
      ...result,
      warden: wardenResult,
      fleet: fleetResult,
      fleet_machines: fleetMachineResult,
      tick_number: tickCount,
      elapsed_ms: elapsed,
      timestamp: new Date().toISOString(),
    };

    // Log significant events
    if (result.recovered > 0) {
      console.log(`[overmind] Tick #${tickCount}: Recovered ${result.recovered} stuck task(s)`);
    }
    if (result.assigned > 0) {
      console.log(`[overmind] Tick #${tickCount}: Assigned ${result.assigned} task(s)`);
    }
    if (result.agents.quarantined > 0) {
      console.log(`[overmind] Tick #${tickCount}: ${result.agents.quarantined} agent(s) quarantined`);
    }
    if (wardenResult && wardenResult.checkpoints_sent > 0) {
      console.log(`[overmind] Tick #${tickCount}: Context warden sent ${wardenResult.checkpoints_sent} checkpoint(s)`);
    }
    if (wardenResult && wardenResult.restarts_sent > 0) {
      console.log(`[overmind] Tick #${tickCount}: Context warden triggered ${wardenResult.restarts_sent} restart(s)`);
    }
    if (fleetMachineResult && (fleetMachineResult.offline > 0 || fleetMachineResult.suspended > 0)) {
      console.log(`[overmind] Tick #${tickCount}: Fleet machines — ${fleetMachineResult.offline} offline, ${fleetMachineResult.suspended} suspended`);
    }

    // Every 100 ticks (~25 minutes at 15s interval), publish a health report
    if (tickCount % 100 === 0) {
      await publishEvent('orchestrator_health', {
        tick_count: tickCount,
        uptime_seconds: startedAt ? (Date.now() - startedAt.getTime()) / 1000 : 0,
        ...result,
        warden: wardenResult,
        fleet: fleetResult,
        fleet_machines: fleetMachineResult,
      });
    }
  } catch (err) {
    console.error(`[overmind] Tick #${tickCount} error:`, err);
    lastTickResult = {
      error: String(err),
      tick_number: tickCount,
      timestamp: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Memory Integration
// ---------------------------------------------------------------------------

/**
 * After a job completes, store a summary in memU for long-term memory.
 * This allows future Overmind sessions to learn from past jobs.
 */
export async function memorizeJobCompletion(jobId: string): Promise<boolean> {
  const MEMU_URL = process.env.MEMU_URL || 'http://localhost:8090';

  try {
    const job = await db.getJobWithTasks(jobId);
    if (!job) return false;

    const taskSummary = job.tasks
      .map(t => `- ${t.type}: ${t.status}${t.iteration > 0 ? ` (${t.iteration} iterations)` : ''}`)
      .join('\n');

    const summary = `Overmind Job Completed: "${job.title}"
Target: ${job.target_type}
Status: ${job.status}
Tasks:
${taskSummary}
Created: ${job.created_at}
Completed: ${job.completed_at || 'N/A'}`;

    const response = await fetch(`${MEMU_URL}/memorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: [{
          role: 'assistant',
          content: { text: summary },
          created_at: new Date().toISOString(),
        }],
      }),
      signal: AbortSignal.timeout(5000),
    });

    return response.ok;
  } catch (err) {
    console.warn('[overmind] Memory integration failed (non-critical):', err);
    return false;
  }
}

/**
 * Retrieve relevant context from memU before planning a new job.
 */
export async function retrieveJobContext(query: string): Promise<string | null> {
  const MEMU_URL = process.env.MEMU_URL || 'http://localhost:8090';

  try {
    const response = await fetch(`${MEMU_URL}/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const data = await response.json() as any;
    return data.results?.[0]?.content || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Policy Headers (Dynamic Rules)
// ---------------------------------------------------------------------------

/**
 * In-memory cache for rules — refreshed once per orchestrator tick.
 * Avoids hitting the DB on every prompt build while still reflecting changes.
 */
let _cachedRules: OvRule[] = [];
let _rulesCacheTime = 0;
const RULES_CACHE_TTL_MS = 15_000; // same as tick interval

/**
 * Load enabled rules (with short-lived cache so tick-aligned).
 * The scope is 'global' by default but can be narrowed per target_type.
 */
export async function getActiveRules(scope: string = 'global'): Promise<OvRule[]> {
  const now = Date.now();
  if (_cachedRules.length > 0 && now - _rulesCacheTime < RULES_CACHE_TTL_MS) {
    // Filter by scope from cache
    return _cachedRules.filter(r => r.scope === 'global' || r.scope === scope);
  }
  try {
    _cachedRules = await db.getEnabledRules(scope);
    _rulesCacheTime = now;
    return _cachedRules;
  } catch {
    return _cachedRules; // stale is better than nothing
  }
}

/** Convenience: get a single rule value, with a fallback default. */
export function getRuleValue<T>(rules: OvRule[], category: string, key: string, fallback: T): T {
  const match = rules.find(r => r.category === category && r.key === key);
  return match ? (match.value as T) : fallback;
}

/** Invalidate the rule cache (called when rules are saved via API). */
export function invalidateRulesCache(): void {
  _rulesCacheTime = 0;
  _cachedRules = [];
}

/**
 * Build the standard policy headers that are prepended to every
 * agent instruction. These are non-negotiable core rules, PLUS any
 * dynamic policy rules from the database.
 *
 * @param rules  - pre-loaded rules for the current scope
 */
export function buildPolicyHeaders(rules?: OvRule[]): string {
  // Core policies that never change
  const coreLines = [
    '1. NEVER mark your own task as "completed". Report results and Overmind will validate.',
    '2. NEVER skip cleanup or testing steps, even if the code "looks fine".',
    '3. NEVER use mock data. Show empty states, loading states, or error states instead.',
    '4. ALWAYS run the full build chain (tsc + build) after every change.',
    '5. ALWAYS report errors immediately — never silently swallow failures.',
  ];

  // Dynamic policies loaded from the rules engine
  const dynamicLines: string[] = [];
  let nextNum = coreLines.length + 1;

  if (rules && rules.length > 0) {
    const maxFileLines = getRuleValue(rules, 'policy', 'max_file_lines', 300);
    dynamicLines.push(`${nextNum++}. ALWAYS keep files under ${maxFileLines} lines. Split if larger.`);

    // Add any custom policy rules from the DB
    const policyRules = rules.filter(r => r.category === 'policy' && r.key !== 'max_file_lines');
    for (const r of policyRules) {
      dynamicLines.push(`${nextNum++}. ${r.key.replace(/_/g, ' ').toUpperCase()}: ${r.value}`);
    }
  } else {
    // Fallback when no rules loaded (bootstrap / first run)
    dynamicLines.push(`${nextNum++}. ALWAYS keep files under 300 lines. Split if larger.`);
  }

  // Always-present trailing policies
  dynamicLines.push(`${nextNum++}. EVERY async operation must have visible feedback (loading, success, error states).`);
  dynamicLines.push(`${nextNum++}. NO direct external API calls from browser JavaScript — use backend proxy routes.`);
  dynamicLines.push(`${nextNum++}. Commit messages must describe WHY, not just WHAT.`);
  dynamicLines.push(`${nextNum++}. When stuck for more than 5 minutes on a single issue, report it as blocked.`);

  return `## OVERMIND POLICY HEADERS — NON-NEGOTIABLE

${[...coreLines, ...dynamicLines].join('\n')}

Violations of these policies will result in compliance score deductions.
Repeated violations will lead to quarantine (no new tasks assigned).`;
}

/**
 * Build the full agent prompt for a task, including:
 * - Policy headers (with dynamic rules)
 * - Cleanup thresholds (so the agent knows the quality bar)
 * - Skill instructions (at the appropriate disclosure level)
 * - Task-specific prompt
 * - Iteration context (if applicable)
 *
 * @param skillContent  - Markdown skill instructions at the right disclosure level
 * @param taskPrompt    - The user/system prompt for this specific task
 * @param iteration     - Current iteration number (0 = first pass)
 * @param previousError - Error message from the previous iteration (if any)
 * @param rules         - Pre-loaded dynamic rules from the DB
 */
export function buildAgentPrompt(
  skillContent: string | null,
  taskPrompt: string,
  iteration: number,
  previousError?: string | null,
  rules?: OvRule[]
): string {
  const parts: string[] = [];

  // 1. Policy headers (dynamic)
  parts.push(buildPolicyHeaders(rules));

  // 2. Cleanup thresholds — show the agent the quality bar
  if (rules && rules.length > 0) {
    const maxLow = getRuleValue(rules, 'thresholds', 'max_low', 10);
    const maxMed = getRuleValue(rules, 'thresholds', 'max_medium', 3);
    const maxHigh = getRuleValue(rules, 'thresholds', 'max_high', 0);
    const failCritical = getRuleValue(rules, 'thresholds', 'fail_on_critical', true);
    const minIter = getRuleValue(rules, 'iteration', 'min_iterations', 2);
    const maxIter = getRuleValue(rules, 'iteration', 'max_iterations', 5);

    parts.push('\n\n## QUALITY THRESHOLDS');
    parts.push(`Your output will be scanned. These thresholds MUST be met:`);
    parts.push(`- Max low-severity findings: ${maxLow}`);
    parts.push(`- Max medium-severity findings: ${maxMed}`);
    parts.push(`- Max high-severity findings: ${maxHigh}`);
    if (failCritical) {
      parts.push(`- ANY critical finding = automatic escalation`);
    }
    parts.push(`- Iteration budget: ${minIter}–${maxIter} passes`);
  }

  // 3. Skill instructions
  if (skillContent) {
    parts.push('\n\n---\n');
    parts.push(skillContent);
  }

  // 4. Task prompt
  parts.push('\n\n---\n');
  parts.push('## YOUR TASK\n');
  parts.push(taskPrompt);

  // 5. Iteration context
  if (iteration > 0) {
    parts.push(`\n\n## ITERATION CONTEXT\nThis is iteration ${iteration}. Previous attempt(s) did not pass cleanup validation.`);
    if (previousError) {
      parts.push(`\nPrevious error: ${previousError}`);
    }
    parts.push('\nFocus on fixing the specific issues identified in the cleanup report.');
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Auto-start on import (if configured)
// ---------------------------------------------------------------------------

/**
 * Initialize the orchestrator. Call this from the main app startup.
 */
export function initOrchestrator(): void {
  if (AUTO_START) {
    // Delay start by 5 seconds to let DB and Redis connect first
    setTimeout(() => {
      startOrchestrator();
    }, 5000);
  } else {
    console.log('[overmind] Orchestrator auto-start disabled (OVERMIND_AUTO_START=false)');
  }
}
