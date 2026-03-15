/**
 * Overmind Routes — Chat Gateway
 *
 * ALL chat messages route through the Overmind brain.
 * The Overmind decides: answer directly, delegate to a fleet worker,
 * or create a background job. This is the single entry point for
 * human-to-AI conversation.
 *
 * Flow:
 * 1. User sends message
 * 2. Overmind loads active rules, fleet status, and policy headers
 * 3. Overmind injects context into the agent's system prompt
 * 4. Proxies the request to the agent engine (SSE streaming)
 * 5. Logs the conversation in the overmind conversation table
 */
import { Router, Request, Response } from 'express';
import {
  getActiveRules,
  buildPolicyHeaders,
  getOrchestratorStatus,
  retrieveJobContext,
} from '../../services/overmind/orchestrator';
import { listWorkers, getFleetStatus } from '../../services/overmind/fleet';
import { pushEvent } from '../../services/overmind/event-bridge';
import { logActivity } from '../../services/activity-broadcaster';
import { query } from '../../services/database';
import { badRequest } from './helpers';
import { classifyChange, explainClassification } from '../../services/change-classifier';
import { matchPlaybookToIntent, type OvRecipe } from '../../services/overmind/recipes';

export const chatRouter = Router();

// ── Types ─────────────────────────────────────────────────

interface ChatRequest {
  message: string;
  conversation_id?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: string;
}

// ── Conversation Helpers (lightweight, no overmind job) ────

/**
 * Create a standalone chat conversation (no linked job).
 * Uses the overmind_conversations table with a NULL job_id.
 */
async function createChatConversation(): Promise<string> {
  const { rows } = await query(
    `INSERT INTO overmind_conversations (job_id, source)
     VALUES (NULL, 'web')
     RETURNING id`
  );
  return rows[0].id;
}

async function logChatMessage(
  conversationId: string,
  role: 'user' | 'overmind',
  content: string
): Promise<void> {
  await query(
    `INSERT INTO overmind_messages (conversation_id, role, content)
     VALUES ($1, $2, $3)`,
    [conversationId, role, content]
  );
}

async function listRecentConversations(limit: number): Promise<unknown[]> {
  const { rows } = await query(
    `SELECT c.id, c.source, c.created_at,
            (SELECT content FROM overmind_messages m
             WHERE m.conversation_id = c.id
             ORDER BY m.created_at ASC LIMIT 1) AS first_message,
            (SELECT COUNT(*) FROM overmind_messages m
             WHERE m.conversation_id = c.id)::int AS message_count
     FROM overmind_conversations c
     ORDER BY c.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

async function getConversationMessages(
  conversationId: string,
  limit: number
): Promise<unknown[]> {
  const { rows } = await query(
    `SELECT id, role, content, created_at
     FROM overmind_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [conversationId, limit]
  );
  return rows;
}

// ── Build Overmind Context ────────────────────────────────

/**
 * Builds the enriched system prompt with Overmind context.
 * Includes playbook awareness, skill detection, and fleet status.
 */
async function buildOvermindContext(message: string): Promise<{ prompt: string; matchedPlaybook: OvRecipe | null }> {
  const parts: string[] = [];
  let matchedPlaybook: OvRecipe | null = null;

  // 1. Overmind identity
  parts.push('## OVERMIND — You are the Sovereign Stack Orchestrator');
  parts.push('You are the Overmind brain. All user communication flows through you.');
  parts.push('You manage fleet workers, enforce policies, and coordinate tasks.');
  parts.push('Everything operates through this chat — playbook creation, skill management, task dispatch.');

  // 2. Playbook system
  parts.push('\n\n## PLAYBOOK SYSTEM');
  parts.push('Playbooks (stored as recipes) define HOW to execute a task: model, iterations, skills, fleet preference, and rules.');
  parts.push('When the user asks you to do something:');
  parts.push('1. Check if a matching playbook exists (see MATCHED PLAYBOOK below)');
  parts.push('2. If a playbook matches, present it: "I\'ll use the [name] playbook: model=[X], iterations=[Y], skills=[Z], fleet=[W]. Want me to proceed or adjust?"');
  parts.push('3. If NO playbook matches, say: "There\'s no playbook for this yet. I can create one for you, or just figure it out with best-guess settings. What do you prefer?"');
  parts.push('4. When the user confirms, execute the task. When they say "send it", "do it", or "go", dispatch immediately.');
  parts.push('5. You are always in planning mode until the user confirms execution.');

  try {
    const { match, allRecipes } = await matchPlaybookToIntent(message);
    matchedPlaybook = match;
    if (matchedPlaybook) {
      parts.push(`\n### MATCHED PLAYBOOK: "${matchedPlaybook.name}"`);
      parts.push(`- Model: ${matchedPlaybook.model}`);
      parts.push(`- Iterations: ${matchedPlaybook.iteration_config.min}-${matchedPlaybook.iteration_config.max}`);
      parts.push(`- Skills: ${matchedPlaybook.skills.length > 0 ? matchedPlaybook.skills.join(', ') : 'none'}`);
      parts.push(`- Fleet: ${matchedPlaybook.fleet_preference}`);
      parts.push(`- Tools: ${matchedPlaybook.tools.join(', ') || 'default'}`);
      parts.push('Present this playbook to the user and let them adjust before executing.');
    } else if (allRecipes.length > 0) {
      parts.push('\n### NO MATCHING PLAYBOOK FOUND');
      parts.push('Available playbooks for reference:');
      for (const pb of allRecipes.slice(0, 5)) {
        parts.push(`  - "${pb.name}" (${pb.target_type}) — ${pb.description || 'no description'}`);
      }
      parts.push('Suggest creating a new playbook or offer to proceed ad-hoc.');
    } else {
      parts.push('\n### NO PLAYBOOKS EXIST YET');
      parts.push('There are no playbooks configured. Offer to create one or proceed with defaults.');
    }
  } catch {
    parts.push('\n### PLAYBOOK MATCHING UNAVAILABLE');
  }

  // 3. manage_playbook tool
  parts.push('\n\n## TOOLS AVAILABLE');
  parts.push('You can manage playbooks through the recipes API:');
  parts.push('- **Create playbook**: POST /api/overmind/recipes with { name, description, target_type, model, iteration_config, skills, fleet_preference, tools, rule_overrides }');
  parts.push('- **Update playbook**: PATCH /api/overmind/recipes/:id with partial fields');
  parts.push('- **Delete playbook**: DELETE /api/overmind/recipes/:id');
  parts.push('- **List playbooks**: GET /api/overmind/recipes');
  parts.push('When the user wants to create or edit a playbook, walk them through the fields conversationally and call the appropriate API.');

  // 4. Skill detection
  parts.push('\n\n## SKILL DETECTION');
  parts.push('Skills are specialized capabilities that can be loaded into playbooks.');
  parts.push('When the user asks to do something and no matching skills exist:');
  parts.push('- Tell them: "I don\'t have a skill for [X] yet. Want me to create one, or should I just figure it out?"');
  parts.push('- If they want to create a skill, enter planning mode to define it collaboratively.');
  parts.push('- If they say just do it, proceed with best-effort defaults.');
  parts.push('When the user mentions "@skills" or asks about skills, present the available skills list.');
  parts.push('Skills API: GET /api/overmind/skills, POST /api/skills (install), DELETE /api/skills/:name (remove).');

  // 5. Rule Advisor capability
  parts.push('\n\n## RULE ADVISOR MODE');
  parts.push('When the user discusses rules, preferences, workflows, or how things should be done:');
  parts.push('1. Parse their intent into concrete rule key/value pairs');
  parts.push('2. Show a preview table of proposed changes (category, key, value)');
  parts.push('3. Explain WHY you recommend specific values');
  parts.push('4. Ask for confirmation before applying');
  parts.push('5. On confirmation, call the rules API and report the version number');

  // 6. Change classification
  parts.push('\n\n## CHANGE CLASSIFICATION');
  parts.push('**Track A (Config):** Rule/setting changes → instant, no rebuild.');
  parts.push('**Track B (Code):** Requires source code changes → rebuild + redeploy.');
  parts.push('When unsure, ask the user. For Track B, describe the change plan and ask for approval before executing.');

  // 7. Policy headers (dynamic rules from DB)
  try {
    const rules = await getActiveRules('global');
    parts.push('\n' + buildPolicyHeaders(rules));
  } catch {
    parts.push('\n' + buildPolicyHeaders());
  }

  // 8. Fleet status awareness
  try {
    const fleetStatus = await getFleetStatus();
    const workers = await listWorkers();
    const healthyWorkers = workers.filter(w => w.status === 'healthy');

    parts.push('\n\n## FLEET STATUS');
    parts.push(`Workers: ${workers.length} total (${healthyWorkers.length} healthy)`);
    if (fleetStatus) {
      parts.push(`Load: ${fleetStatus.total_load}/${fleetStatus.total_capacity}`);
      parts.push(`Avg context: ${Math.round(fleetStatus.avg_context_usage)}%`);
    }
    if (healthyWorkers.length > 0) {
      parts.push('Available fleet workers:');
      for (const w of healthyWorkers.slice(0, 5)) {
        parts.push(`  - ${w.name} [${w.capabilities.join(', ')}] load: ${w.current_load}/${w.max_load}`);
      }
      parts.push('You can delegate work to fleet workers.');
    }
  } catch {
    parts.push('\n\n## FLEET STATUS\nFleet status unavailable.');
  }

  // 9. Orchestrator status
  try {
    const orchStatus = getOrchestratorStatus();
    parts.push('\n\n## ORCHESTRATOR');
    parts.push(`Status: ${orchStatus.running ? 'Running' : 'Stopped'}`);
    parts.push(`Tick: #${orchStatus.tick_count} (every ${orchStatus.tick_interval_ms / 1000}s)`);
  } catch {
    // Non-critical
  }

  return { prompt: parts.join('\n'), matchedPlaybook };
}

// ── POST /chat — Overmind chat gateway ─────────────────────

chatRouter.post('/chat', async (req: Request, res: Response) => {
  const { message, conversation_id, history, model }: ChatRequest = req.body || {};

  if (!message || typeof message !== 'string') {
    return badRequest(res, 'message is required');
  }

  logActivity('overmind', 'info', `Chat: "${message.slice(0, 80)}..."`);

  // Set up SSE streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendSSE = (data: unknown) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === 'function') {
      (res as any).flush();
    }
  };

  // Heartbeat during context-building phase (before agent proxy starts)
  const HEARTBEAT_MS = 15_000;
  const contextStartTime = Date.now();
  const contextHeartbeat = setInterval(() => {
    sendSSE({ type: 'heartbeat', ts: Date.now(), elapsed_ms: Date.now() - contextStartTime });
  }, HEARTBEAT_MS);

  try {
    // Build the enriched context (includes playbook matching)
    sendSSE({ type: 'status', stage: 'loading_context' });
    const { prompt: overmindContext, matchedPlaybook } = await buildOvermindContext(message);

    // Load active rules for decision header
    let activeRulesList: Array<{ category: string; key: string; value: unknown }> = [];
    let iterationConfig = matchedPlaybook?.iteration_config || { min: 2, max: 5 };
    try {
      const rules = await getActiveRules('global');
      activeRulesList = rules.map(r => ({ category: r.category, key: r.key, value: r.value }));
      if (!matchedPlaybook) {
        const minIter = rules.find(r => r.key === 'min_iterations');
        const maxIter = rules.find(r => r.key === 'max_iterations');
        if (minIter) iterationConfig.min = Number(minIter.value) || 2;
        if (maxIter) iterationConfig.max = Number(maxIter.value) || 5;
      }
    } catch {
      // Non-critical — use defaults
    }

    // Classify the change type (Track A config vs Track B code)
    const classification = classifyChange(message);

    // Emit decision header with playbook match info
    sendSSE({
      type: 'decision',
      agent: 'Overmind',
      model: matchedPlaybook?.model || model || 'coder',
      rules_applied: activeRulesList.map(r => `${r.category}.${r.key}`),
      rules_count: activeRulesList.length,
      iteration_config: iterationConfig,
      skills_loaded: matchedPlaybook?.skills || [],
      change_track: classification.track,
      change_confidence: classification.confidence,
      change_risk: classification.risk_level,
      matched_playbook: matchedPlaybook ? {
        id: matchedPlaybook.id,
        name: matchedPlaybook.name,
        model: matchedPlaybook.model,
        iteration_config: matchedPlaybook.iteration_config,
        skills: matchedPlaybook.skills,
        fleet_preference: matchedPlaybook.fleet_preference,
      } : null,
      timestamp: new Date().toISOString(),
    });

    // Retrieve relevant memory for this conversation
    let memoryContext = '';
    try {
      const memory = await retrieveJobContext(message);
      if (memory) {
        memoryContext = `\n\n## RELEVANT MEMORY\n${memory}`;
      }
    } catch {
      // Memory retrieval is non-critical
    }

    // Log the message in Overmind's conversation system
    let conversationId = conversation_id || null;
    try {
      if (!conversationId) {
        conversationId = await createChatConversation();
      }
      await logChatMessage(conversationId, 'user', message);
    } catch {
      // Conversation logging is non-critical
    }

    // Push event for real-time dashboard
    pushEvent('chat_message', {
      direction: 'inbound',
      message: message.slice(0, 200),
      conversation_id: conversationId,
    });

    // Stop context-phase heartbeat — agent sends its own once connected
    clearInterval(contextHeartbeat);

    // Proxy to the agent engine with enriched context
    sendSSE({ type: 'status', stage: 'connecting_agent' });

    const agentUrl = `http://127.0.0.1:${process.env.PORT || 3100}/api/agent`;
    const agentBody = {
      message,
      conversation_id: conversationId,
      history: history || [],
      model: model || 'coder',
      // Inject the Overmind context as a system prompt wrapper
      system_prompt_prefix: overmindContext + memoryContext,
    };

    // Abort the agent fetch if the client disconnects
    const abortController = new AbortController();
    res.on('close', () => abortController.abort());

    const agentResponse = await fetch(agentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agentBody),
      signal: abortController.signal,
    });

    if (!agentResponse.ok) {
      const errText = await agentResponse.text().catch(() => 'Agent unavailable');
      sendSSE({ type: 'error', content: `Agent error: ${errText}` });
      sendSSE({ type: 'done', iterations: 0, duration_ms: 0 });
      res.end();
      return;
    }

    // Stream agent SSE events through to the client
    const reader = agentResponse.body?.getReader();
    if (!reader) {
      sendSSE({ type: 'error', content: 'No response body from agent' });
      sendSSE({ type: 'done', iterations: 0, duration_ms: 0 });
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let lastContent = '';
    let sseBuffer = ''; // Buffer for incomplete SSE lines across chunks

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
        if (typeof (res as any).flush === 'function') {
          (res as any).flush();
        }

        // Track the last message content for conversation logging
        // Use a buffer to handle lines split across chunks
        sseBuffer += chunk;
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || ''; // Keep incomplete last line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'message' && event.content) {
                lastContent = event.content;
              }
            } catch {
              // Skip malformed
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Log the agent's final response
    if (conversationId && lastContent) {
      try {
        await logChatMessage(conversationId, 'overmind', lastContent);
      } catch {
        // Non-critical
      }
    }

    // Push event for real-time dashboard
    pushEvent('chat_message', {
      direction: 'outbound',
      message: lastContent.slice(0, 200),
      conversation_id: conversationId,
    });
  } catch (err) {
    clearInterval(contextHeartbeat);
    const errMsg = (err as Error).message;
    logActivity('overmind', 'error', `Chat failed: ${errMsg}`);
    sendSSE({ type: 'error', content: `Overmind error: ${errMsg}` });
    sendSSE({ type: 'done', iterations: 0, duration_ms: 0 });
  }

  res.end();
});

// ── POST /chat/classify — Classify a change request ─────────

chatRouter.post('/chat/classify', async (req: Request, res: Response) => {
  const { message } = req.body || {};
  if (!message) return badRequest(res, 'message is required');

  const result = classifyChange(message);
  res.json({
    ...result,
    explanation: explainClassification(result),
  });
});

// ── GET /chat/conversations — List recent conversations ────

chatRouter.get('/chat/conversations', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

  try {
    const conversations = await listRecentConversations(limit);
    res.json({ conversations, total: conversations.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to list conversations: ${err}` });
  }
});

// ── GET /chat/conversations/:id/messages — Get messages ────

chatRouter.get(
  '/chat/conversations/:id/messages',
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    try {
      const messages = await getConversationMessages(id, limit);
      res.json({ messages, total: messages.length });
    } catch (err) {
      res.status(500).json({ error: `Failed to get messages: ${err}` });
    }
  }
);
