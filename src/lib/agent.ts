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

export interface AgentEvent {
  type: 'status' | 'thinking' | 'tool_call' | 'tool_result' | 'message' | 'error' | 'done';
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
}

export interface AgentCallbacks {
  onStatus?: (iteration: number, maxIterations: number) => void;
  onThinking?: (text: string) => void;
  onToolCall?: (id: string, tool: string, input: Record<string, unknown>) => void;
  onToolResult?: (id: string, tool: string, output: Record<string, unknown>, durationMs: number) => void;
  onMessage?: (text: string) => void;
  onError?: (error: string) => void;
  onDone?: (iterations: number, durationMs: number) => void;
}

// ─── Agent Chat Function ─────────────────────────────────────────────────

/**
 * Send a message to the Overmind chat gateway and stream back results via SSE.
 * The Overmind enriches the request with policies, fleet status, and memory
 * before proxying to the agent engine.
 *
 * For fleet worker direct access, set overrides.fleet_agent_id to bypass Overmind.
 */
export interface AgentOverrides {
  /** Custom system prompt (Fleet Mode agents) */
  system_prompt?: string;
  /** Model tier override */
  model?: string;
  /** Fleet agent ID — when set, routes DIRECTLY to agent (bypasses Overmind) */
  fleet_agent_id?: string;
}

export async function chatWithAgent(
  message: string,
  conversationId: string | null,
  history: { role: 'user' | 'assistant'; content: string }[],
  callbacks: AgentCallbacks,
  abortSignal?: AbortSignal,
  overrides?: AgentOverrides
): Promise<string> {
  // Fleet workers bypass Overmind and go directly to the agent engine
  const isFleetDirect = !!overrides?.fleet_agent_id;

  let url: string;
  let body: Record<string, unknown>;

  if (isFleetDirect) {
    // Direct agent access for fleet workers
    const queryParams = `?fleet_agent_id=${encodeURIComponent(overrides!.fleet_agent_id!)}`;
    url = `${API_BASE}/agent${queryParams}`;
    body = {
      message,
      conversation_id: conversationId,
      history,
      ...(overrides?.system_prompt && { system_prompt: overrides.system_prompt }),
      ...(overrides?.model && { model: overrides.model }),
    };
  } else {
    // Route through Overmind — the default for all user conversations
    url = `${API_BASE}/overmind/chat`;
    body = {
      message,
      conversation_id: conversationId,
      history,
      ...(overrides?.model && { model: overrides.model }),
    };
  }

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

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        const jsonStr = line.slice(6);
        if (!jsonStr.trim()) continue;

        let event: AgentEvent;
        try {
          event = JSON.parse(jsonStr);
        } catch {
          continue; // Skip malformed events
        }

        switch (event.type) {
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

          case 'done':
            callbacks.onDone?.(event.iterations || 0, event.duration_ms || 0);
            break;
        }
      }
    }
  } finally {
    reader.releaseLock();
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
