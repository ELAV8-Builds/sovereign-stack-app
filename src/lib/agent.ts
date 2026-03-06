/**
 * Agent Engine Client
 *
 * SSE client for the agent endpoint that streams tool execution events.
 * Replaces the simple chatWithAI() call for agentic interactions.
 *
 * Proxy path: /api/sovereign/agent → http://127.0.0.1:3100/api/agent
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
 * Send a message to the agent engine and stream back results via SSE.
 * Returns the final text message content.
 */
export interface AgentOverrides {
  /** Custom system prompt (Fleet Mode agents) */
  system_prompt?: string;
  /** Model tier override */
  model?: string;
  /** Fleet agent ID for routing */
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
  const queryParams = overrides?.fleet_agent_id
    ? `?fleet_agent_id=${encodeURIComponent(overrides.fleet_agent_id)}`
    : '';

  const response = await fetch(`${API_BASE}/agent${queryParams}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      conversation_id: conversationId,
      history,
      ...(overrides?.system_prompt && { system_prompt: overrides.system_prompt }),
      ...(overrides?.model && { model: overrides.model }),
    }),
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
