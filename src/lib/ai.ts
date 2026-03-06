/**
 * AI Chat Service
 *
 * Routes chat requests through the Vite proxy → LiteLLM → model provider.
 * Works in both browser and Tauri mode since it uses standard fetch.
 *
 * Proxy path: /api/llm → http://127.0.0.1:4000
 * LiteLLM exposes OpenAI-compatible endpoints.
 */

import { localGet } from './tauri';

// ─── Types ───────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  id: string;
  choices: {
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ─── Config ──────────────────────────────────────────────────────────────

// In dev, Vite proxy forwards /api/llm → LiteLLM at :4000
// In production (Tauri), use localhost directly
const LLM_BASE = '/api/llm';

// Default model tier for chat — uses "medium" (Sonnet) for conversational use
const DEFAULT_MODEL = 'medium';

// ─── System Prompt ───────────────────────────────────────────────────────

function getSystemPrompt(): string {
  const agentName = localGet('agent_name', 'Sovereign Agent');
  return `You are ${agentName}, a helpful AI assistant running inside the Sovereign Stack desktop app. You help the user manage their local AI infrastructure, services, and development tasks.

You have access to these services (when running):
- LiteLLM (port 4000) — Model routing across 9 tiers and 3 providers
- Ollama (port 11434) — Local LLM inference
- memU (port 8090) — Semantic memory
- AnythingLLM (port 3001) — RAG / document search
- PostgreSQL (port 5432) — Database
- NanoClaw — WhatsApp/messaging agent
- Temporal (port 7233) — Workflow orchestration

Keep responses concise and helpful. Use bullet points for lists. When the user asks about services, give specific details (ports, status). Format code with backtick blocks.`;
}

// ─── Chat Function ───────────────────────────────────────────────────────

/**
 * Send a chat message to the AI via LiteLLM.
 * Maintains conversation history for context.
 */
export async function chatWithAI(
  userMessage: string,
  conversationHistory: ChatMessage[] = []
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: getSystemPrompt() },
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  const apiKey = localGet('litellm_master_key', 'sk-litellm-master');

  const response = await fetch(`${LLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages,
      max_tokens: 1024,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`AI request failed (${response.status}): ${errorText}`);
  }

  const data: ChatResponse = await response.json();

  if (!data.choices?.length || !data.choices[0].message?.content) {
    throw new Error('AI returned empty response');
  }

  return data.choices[0].message.content;
}

// ─── Health Check ────────────────────────────────────────────────────────

/**
 * Check if LiteLLM is reachable via the proxy.
 */
export async function checkLLMHealth(): Promise<boolean> {
  try {
    const apiKey = localGet('litellm_master_key', 'sk-litellm-master');
    const response = await fetch(`${LLM_BASE}/health/liveliness`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get available models from LiteLLM.
 */
export async function getAvailableModels(): Promise<string[]> {
  try {
    const apiKey = localGet('litellm_master_key', 'sk-litellm-master');
    const response = await fetch(`${LLM_BASE}/models`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.data || []).map((m: { id: string }) => m.id);
  } catch {
    return [];
  }
}
