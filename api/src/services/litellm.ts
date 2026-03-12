import { logActivity } from './activity-broadcaster';

const LITELLM_URL = process.env.LITELLM_URL || 'http://localhost:4000';
const LITELLM_KEY = process.env.LITELLM_MASTER_KEY || 'sk-litellm-master';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | any[];  // string for text, array for tool_use/tool_result blocks
  tool_call_id?: string;    // for tool result messages
}

export interface ChatCompletionOptions {
  model?: string;       // LiteLLM tier name: trivial, light, coder, medium, heavy, creative, etc.
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

// ─── Tool Calling Types ──────────────────────────────────────────────────

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;  // JSON string
  };
}

export interface ChatCompletionWithToolsOptions {
  model?: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatCompletionWithToolsResult {
  content: string | null;         // text content (may be null if only tool calls)
  tool_calls: ToolCall[] | null;  // tool calls requested by the model
  finish_reason: string;          // 'stop' | 'tool_calls' | 'length'
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function chatCompletion(options: ChatCompletionOptions): Promise<string> {
  const model = options.model || 'coder';

  logActivity('litellm', 'thinking', `Routing to ${model} tier...`);

  const response = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LITELLM_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 4096,
      stream: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    logActivity('litellm', 'error', `${model} tier failed: ${response.status}`);
    throw new Error(`LiteLLM ${model} failed (${response.status}): ${text}`);
  }

  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content || '';

  logActivity('litellm', 'success', `${model} response received (${content.length} chars)`);
  return content;
}

export async function streamChatCompletion(
  options: ChatCompletionOptions,
  onChunk: (chunk: string) => void
): Promise<string> {
  const model = options.model || 'coder';

  logActivity('litellm', 'thinking', `Streaming from ${model} tier...`);

  const response = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LITELLM_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 4096,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`LiteLLM stream failed (${response.status})`);
  }

  let fullContent = '';
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) throw new Error('No response body');

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

    for (const line of lines) {
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content || '';
        if (delta) {
          fullContent += delta;
          onChunk(delta);
        }
      } catch {
        // Skip malformed SSE lines
      }
    }
  }

  logActivity('litellm', 'success', `Stream complete (${fullContent.length} chars)`);
  return fullContent;
}

// ─── Chat Completion with Tool Calling ──────────────────────────────────

export async function chatCompletionWithTools(
  options: ChatCompletionWithToolsOptions
): Promise<ChatCompletionWithToolsResult> {
  const model = options.model || 'coder';

  logActivity('litellm', 'thinking', `Agent loop: routing to ${model} tier (with tools)...`);

  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
    temperature: options.temperature ?? 0.5,
    max_tokens: options.max_tokens ?? 4096,
    stream: false,
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = 'auto';
  }

  const response = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LITELLM_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    logActivity('litellm', 'error', `Agent ${model} tier failed: ${response.status}`);
    throw new Error(`LiteLLM ${model} failed (${response.status}): ${text}`);
  }

  const data = await response.json() as any;
  const choice = data.choices?.[0];

  const result: ChatCompletionWithToolsResult = {
    content: choice?.message?.content || null,
    tool_calls: choice?.message?.tool_calls || null,
    finish_reason: choice?.finish_reason || 'stop',
    usage: data.usage,
  };

  if (result.tool_calls && result.tool_calls.length > 0) {
    logActivity('litellm', 'info', `Agent requested ${result.tool_calls.length} tool call(s)`);
  } else {
    const len = typeof result.content === 'string' ? result.content.length : 0;
    logActivity('litellm', 'success', `Agent response received (${len} chars)`);
  }

  return result;
}

// Image generation via Gemini through LiteLLM
export async function generateImage(prompt: string, options?: {
  size?: string;
  style?: string;
}): Promise<{ url: string; revisedPrompt: string }> {
  logActivity('litellm', 'thinking', 'Generating image via Gemini creative tier...');

  const response = await fetch(`${LITELLM_URL}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LITELLM_KEY}`,
    },
    body: JSON.stringify({
      model: 'creative',
      prompt,
      n: 1,
      size: options?.size || '1024x1024',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    logActivity('litellm', 'error', `Image generation failed: ${response.status}`);
    throw new Error(`Image generation failed: ${text}`);
  }

  const data = await response.json() as any;
  const result = {
    url: data.data?.[0]?.url || data.data?.[0]?.b64_json || '',
    revisedPrompt: data.data?.[0]?.revised_prompt || prompt,
  };

  logActivity('litellm', 'success', 'Image generated successfully');
  return result;
}

// Health check
export async function checkLiteLLMHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${LITELLM_URL}/health/liveliness`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
