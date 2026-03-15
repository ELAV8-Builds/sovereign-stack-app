/**
 * Agent Engine Client — Routed Through Overmind
 *
 * SSE client for the Overmind chat gateway. All messages flow through
 * the Overmind brain which enriches context, enforces policies, and
 * manages fleet awareness before proxying to the agent engine.
 *
 * Primary path: /api/sovereign/overmind/chat → Overmind Gateway → Agent Engine
 * Direct path:  /api/sovereign/agent (used by fleet workers only)
 */

const API_BASE = '/api/sovereign';

// ─── Types ───────────────────────────────────────────────────────────────

export interface AgentToolCall {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: 'running' | 'completed' | 'error';
  duration_ms?: number;
}

export interface MatchedPlaybook {
  id: string;
  name: string;
  model: string;
  iteration_config: { min: number; max: number };
  skills: string[];
  fleet_preference: string;
}

export interface AgentDecision {
  agent: string;
  model: string;
  rules_applied: string[];
  rules_count: number;
  iteration_config: { min: number; max: number };
  skills_loaded: string[];
  matched_playbook?: MatchedPlaybook | null;
  change_track?: 'A' | 'B';
  change_confidence?: number;
  change_risk?: string;
  timestamp: string;
}

export interface JobHandoff {
  job_id: string;
  title: string;
  conversation_id?: string;
}

export interface AgentEvent {
  type: 'status' | 'thinking' | 'tool_call' | 'tool_result' | 'message' | 'error' | 'done' | 'decision' | 'job_handoff' | 'playbook_chain_suggestion' | 'heartbeat';
  // status
  iteration?: number;
  max_iterations?: number;
  stage?: string;
  // thinking / message / error
  content?: string;
  // tool_call / tool_result
  id?: string;
  tool?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  duration_ms?: number;
  // done
  iterations?: number;
  // decision
  agent?: string;
  model?: string;
  rules_applied?: string[];
  rules_count?: number;
  iteration_config?: { min: number; max: number };
  skills_loaded?: string[];
  matched_playbook?: MatchedPlaybook | null;
  change_track?: 'A' | 'B';
  change_confidence?: number;
  change_risk?: string;
  timestamp?: string;
  // job_handoff
  job_id?: string;
  title?: string;
  conversation_id?: string;
  matched_recipes?: Array<{ id: string; name: string }>;
  phases?: Array<{ recipe_id: string; recipe_name: string; sequence: number; status: string }>;
  // playbook_chain_suggestion
  chain?: Array<{ id: string; name: string; reason: string; sequence: number; target_type?: string; model?: string; iteration_config?: { min: number; max: number }; steps?: string[]; skills?: string[] }>;
  reasoning?: string;
  auto_approved?: boolean;
  // heartbeat
  ts?: number;
  elapsed_ms?: number;
}

export interface PlaybookChainSuggestion {
  chain: Array<{
    id: string;
    name: string;
    reason: string;
    sequence: number;
    target_type?: string;
    model?: string;
    iteration_config?: { min: number; max: number };
    steps?: string[];
    skills?: string[];
  }>;
  reasoning: string;
  auto_approved: boolean;
}

export interface AgentCallbacks {
  onDecision?: (decision: AgentDecision) => void;
  onStatus?: (iteration: number, maxIterations: number) => void;
  onThinking?: (text: string) => void;
  onToolCall?: (id: string, tool: string, input: Record<string, unknown>) => void;
  onToolResult?: (id: string, tool: string, output: Record<string, unknown>, durationMs: number) => void;
  onMessage?: (text: string) => void;
  onError?: (error: string) => void;
  onDone?: (iterations: number, durationMs: number) => void;
  onJobHandoff?: (handoff: JobHandoff) => void;
  onPlaybookChain?: (suggestion: PlaybookChainSuggestion) => void;
  onHeartbeat?: (elapsedMs: number) => void;
}

// ─── Agent Chat Function ─────────────────────────────────────────────────

/**
 * Send a message to the Overmind chat gateway and stream back results via SSE.
 * The Overmind enriches the request with policies, fleet status, and memory
 * before proxying to the agent engine. All chat routes through Overmind.
 */
export interface AgentOverrides {
  /** Model tier override */
  model?: string;
}

export async function chatWithAgent(
  message: string,
  conversationId: string | null,
  history: { role: 'user' | 'assistant'; content: string }[],
  callbacks: AgentCallbacks,
  abortSignal?: AbortSignal,
  overrides?: AgentOverrides,
  imageUrls?: string[]
): Promise<string> {
  const url = `${API_BASE}/overmind/chat`;
  const body: Record<string, unknown> = {
    message,
    conversation_id: conversationId,
    history,
    ...(overrides?.model && { model: overrides.model }),
    ...(imageUrls && imageUrls.length > 0 && { image_urls: imageUrls }),
  };

  const MAX_RETRIES = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      callbacks.onStatus?.(0, 20);
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }

    try {
      const finalMessage = await _streamAgent(url, body, callbacks, abortSignal);
      return finalMessage;
    } catch (err) {
      lastError = err as Error;
      if ((err as Error).name === 'AbortError') throw err;
      // Don't retry on HTTP errors (4xx/5xx) — only retry on stream/network failures
      const msg = (err as Error).message || '';
      if (msg.includes('request failed (4') || msg.includes('request failed (5')) throw err;
      if (attempt < MAX_RETRIES) {
        callbacks.onError?.(`Connection interrupted, retrying (${attempt + 1}/${MAX_RETRIES})...`);
      }
    }
  }

  throw lastError || new Error('Agent request failed after retries');
}

async function _streamAgent(
  url: string,
  body: Record<string, unknown>,
  callbacks: AgentCallbacks,
  abortSignal?: AbortSignal
): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: abortSignal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Agent request failed (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body from agent');

  const decoder = new TextDecoder();
  let buffer = '';
  let finalMessage = '';
  let receivedDone = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        // Skip keepalive comments
        if (line.startsWith(':')) continue;
        if (!line.startsWith('data: ')) continue;

        const jsonStr = line.slice(6);
        if (!jsonStr.trim()) continue;

        let event: AgentEvent;
        try {
          event = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        switch (event.type) {
          case 'decision':
            callbacks.onDecision?.({
              agent: event.agent || 'Overmind',
              model: event.model || 'coder',
              rules_applied: event.rules_applied || [],
              rules_count: event.rules_count || 0,
              iteration_config: event.iteration_config || { min: 2, max: 5 },
              skills_loaded: event.skills_loaded || [],
              matched_playbook: event.matched_playbook || null,
              change_track: event.change_track,
              change_confidence: event.change_confidence,
              change_risk: event.change_risk,
              timestamp: event.timestamp || new Date().toISOString(),
            });
            break;

          case 'status':
            callbacks.onStatus?.(event.iteration || 0, event.max_iterations || 20);
            break;

          case 'thinking':
            callbacks.onThinking?.(event.content || '');
            break;

          case 'tool_call':
            callbacks.onToolCall?.(
              event.id || '',
              event.tool || '',
              (event.input || {}) as Record<string, unknown>
            );
            break;

          case 'tool_result':
            callbacks.onToolResult?.(
              event.id || '',
              event.tool || '',
              (event.output || {}) as Record<string, unknown>,
              event.duration_ms || 0
            );
            break;

          case 'message':
            finalMessage = event.content || '';
            callbacks.onMessage?.(finalMessage);
            break;

          case 'error':
            callbacks.onError?.(event.content || 'Unknown agent error');
            break;

          case 'job_handoff':
            callbacks.onJobHandoff?.({
              job_id: event.job_id || '',
              title: event.title || '',
              conversation_id: event.conversation_id,
            });
            break;

          case 'playbook_chain_suggestion':
            callbacks.onPlaybookChain?.({
              chain: event.chain || [],
              reasoning: event.reasoning || '',
              auto_approved: event.auto_approved ?? true,
            });
            break;

          case 'heartbeat':
            callbacks.onHeartbeat?.(event.elapsed_ms || 0);
            break;

          case 'done':
            receivedDone = true;
            callbacks.onDone?.(event.iterations || 0, event.duration_ms || 0);
            break;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // If stream ended without a done event and no message, the connection dropped
  if (!receivedDone && !finalMessage) {
    throw new Error('Stream ended unexpectedly');
  }

  // If we got content but no done event, still deliver the message
  if (!receivedDone && finalMessage) {
    callbacks.onDone?.(0, 0);
  }

  return finalMessage;
}

// ─── Agent Info ──────────────────────────────────────────────────────────

/**
 * Get list of available agent tools.
 */
export async function getAgentTools(): Promise<{ name: string; description: string }[]> {
  try {
    const response = await fetch(`${API_BASE}/agent/tools`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.tools || [];
  } catch {
    return [];
  }
}
