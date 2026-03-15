import type { AgentToolCall } from "@/lib/agent";
import type { Message } from "@/lib/conversations";

// ─── Queue Types ──────────────────────────────────────────────────────────

export interface QueuedMessage {
  id: string;
  content: string;
  timestamp: number;
}

export const QUEUE_STORAGE_KEY = "sovereign_chat_queue";
export const STALE_THRESHOLD_MS = 120_000;

export function loadPersistedQueue(): QueuedMessage[] {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* corrupted */ }
  return [];
}

export function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ─── Chat Message Types ───────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: Date;
  status?: "sending" | "sent" | "error";
  toolCalls?: AgentToolCall[];
  thinking?: string;
}

export interface ChannelStatus {
  whatsapp: boolean;
  slack: boolean;
}

// ─── Convert API message to local format ────────────────────────────────

export function apiToLocal(msg: Message): ChatMessage {
  return {
    id: msg.id,
    role: msg.role === "user" ? "user" : "agent",
    content: msg.content,
    timestamp: new Date(msg.created_at),
    status: msg.status as ChatMessage["status"],
  };
}
