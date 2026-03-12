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
 * This is injected before every chat message so the agent
 * operates within the Overmind's policies and has fleet awareness.
 */
async function buildOvermindContext(): Promise<string> {
  const parts: string[] = [];

  // 1. Overmind identity
  parts.push('## OVERMIND — You are the Sovereign Stack Orchestrator');
  parts.push('You are the Overmind brain. All user communication flows through you.');
  parts.push('You manage fleet workers, enforce policies, and coordinate tasks.');

  // 2. Policy headers (dynamic rules from DB)
  try {
    const rules = await getActiveRules('global');
    parts.push('\n' + buildPolicyHeaders(rules));
  } catch {
    parts.push('\n' + buildPolicyHeaders());
  }

  // 3. Fleet status awareness
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
      parts.push('You can use the delegate_to_fleet tool to assign work to fleet workers.');
    }
  } catch {
    parts.push('\n\n## FLEET STATUS\nFleet status unavailable.');
  }

  // 4. Orchestrator status
  try {
    const orchStatus = getOrchestratorStatus();
    parts.push('\n\n## ORCHESTRATOR');
    parts.push(`Status: ${orchStatus.running ? 'Running' : 'Stopped'}`);
    parts.push(`Tick: #${orchStatus.tick_count} (every ${orchStatus.tick_interval_ms / 1000}s)`);
  } catch {
    // Non-critical
  }

  return parts.join('\n');
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
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === 'function') {
      (res as any).flush();
    }
  };

  try {
    // Build the enriched context
    sendSSE({ type: 'status', stage: 'loading_context' });
    const overmindContext = await buildOvermindContext();

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
    const errMsg = (err as Error).message;
    logActivity('overmind', 'error', `Chat failed: ${errMsg}`);
    sendSSE({ type: 'error', content: `Overmind error: ${errMsg}` });
    sendSSE({ type: 'done', iterations: 0, duration_ms: 0 });
  }

  res.end();
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
