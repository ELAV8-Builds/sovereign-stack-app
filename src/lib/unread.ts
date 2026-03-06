/**
 * Unread Conversation Tracking
 *
 * Tracks which conversations have new messages the user hasn't seen.
 * Uses localStorage to persist read state across sessions.
 *
 * Strategy:
 * - Store `{ conversationId: lastSeenTimestamp }` in localStorage
 * - A conversation is "unread" if its `updated_at` > lastSeenTimestamp
 * - Mark as read when the user clicks into the conversation
 */

const STORAGE_KEY = 'sovereign_conversation_read_state';

interface ReadState {
  [conversationId: string]: string; // ISO timestamp of last seen
}

// ─── Helpers ─────────────────────────────────────────────────────────

function getReadState(): ReadState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveReadState(state: ReadState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage not available
  }
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Check if a conversation has unread messages.
 * Compares the conversation's `updated_at` against the last time the user viewed it.
 */
export function isConversationUnread(
  conversationId: string,
  updatedAt: string
): boolean {
  const state = getReadState();
  const lastSeen = state[conversationId];

  if (!lastSeen) {
    // Never seen — it's unread if it has been updated at all
    return true;
  }

  return new Date(updatedAt).getTime() > new Date(lastSeen).getTime();
}

/**
 * Mark a conversation as read (user is currently viewing it).
 */
export function markConversationRead(conversationId: string): void {
  const state = getReadState();
  state[conversationId] = new Date().toISOString();
  saveReadState(state);
}

/**
 * Get the set of all unread conversation IDs from a list.
 */
export function getUnreadConversationIds(
  conversations: { id: string; updated_at: string }[]
): Set<string> {
  const state = getReadState();
  const unread = new Set<string>();

  for (const conv of conversations) {
    const lastSeen = state[conv.id];
    if (!lastSeen || new Date(conv.updated_at).getTime() > new Date(lastSeen).getTime()) {
      unread.add(conv.id);
    }
  }

  return unread;
}

/**
 * Clean up read state for conversations that no longer exist.
 */
export function pruneReadState(existingIds: Set<string>): void {
  const state = getReadState();
  let changed = false;

  for (const id of Object.keys(state)) {
    if (!existingIds.has(id)) {
      delete state[id];
      changed = true;
    }
  }

  if (changed) {
    saveReadState(state);
  }
}
