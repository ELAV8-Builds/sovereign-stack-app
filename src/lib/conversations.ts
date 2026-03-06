/**
 * Conversations API Client
 *
 * Manages persistent chat threads through the Sovereign Stack API.
 * In dev, Vite proxy forwards /api/sovereign/* → API at :3100.
 */

// ─── Types ───────────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  agent_id: string | null;
  created_at: string;
  updated_at: string;
  pinned: boolean;
  archived: boolean;
  message_count: number;
  last_message: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  status: 'sending' | 'sent' | 'error';
  created_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
}

export interface SearchResult {
  message_id: string;
  conversation_id: string;
  role: string;
  content: string;
  message_date: string;
  conversation_title: string;
  conversation_updated: string;
  snippet?: string;
  rank?: number;
}

// ─── Config ──────────────────────────────────────────────────────────────

const API_BASE = '/api/sovereign';

// ─── API Functions ───────────────────────────────────────────────────────

/**
 * List all conversations (most recent first).
 */
export async function listConversations(options?: {
  limit?: number;
  offset?: number;
  archived?: boolean;
}): Promise<Conversation[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  if (options?.archived) params.set('archived', 'true');

  const url = `${API_BASE}/conversations${params.toString() ? '?' + params.toString() : ''}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Failed to list conversations: ${response.status}`);
  const data = await response.json();
  return data.conversations;
}

/**
 * Create a new conversation.
 */
export async function createConversation(title?: string, agent_id?: string): Promise<Conversation> {
  const response = await fetch(`${API_BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, agent_id }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Failed to create conversation: ${response.status}`);
  return response.json();
}

/**
 * Get a conversation with all its messages.
 */
export async function getConversation(id: string): Promise<ConversationDetail> {
  const response = await fetch(`${API_BASE}/conversations/${id}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Failed to fetch conversation: ${response.status}`);
  return response.json();
}

/**
 * Update conversation metadata (title, pin, archive).
 */
export async function updateConversation(
  id: string,
  updates: { title?: string; pinned?: boolean; archived?: boolean }
): Promise<Conversation> {
  const response = await fetch(`${API_BASE}/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Failed to update conversation: ${response.status}`);
  return response.json();
}

/**
 * Delete a conversation and all its messages.
 */
export async function deleteConversation(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/conversations/${id}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Failed to delete conversation: ${response.status}`);
}

/**
 * Add a message to a conversation.
 */
export async function addMessage(
  conversationId: string,
  role: 'user' | 'agent' | 'system',
  content: string,
  status: 'sending' | 'sent' | 'error' = 'sent'
): Promise<Message> {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, content, status }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Failed to add message: ${response.status}`);
  return response.json();
}

/**
 * Search across all conversations.
 */
export async function searchConversations(
  query: string,
  limit?: number
): Promise<{ query: string; results: SearchResult[]; count: number }> {
  const params = new URLSearchParams({ q: query });
  if (limit) params.set('limit', String(limit));

  const response = await fetch(`${API_BASE}/conversations/search/query?${params.toString()}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Search failed: ${response.status}`);
  return response.json();
}
