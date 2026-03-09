import toast from "react-hot-toast";
import type { Conversation } from "@/lib/conversations";
import { markConversationRead } from "@/lib/unread";
import type { FleetAgent } from "@/lib/fleet";

// ---- Conversation Context Menu -----------------------------------------------

interface ConversationContextMenuProps {
  contextMenu: { id: string; x: number; y: number };
  conversations: Conversation[];
  onClose: () => void;
  onStartEdit: (id: string, title: string) => void;
  onPin: (id: string, currentlyPinned: boolean) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onMarkRead: (id: string) => void;
}

export function ConversationContextMenu({
  contextMenu,
  conversations,
  onClose,
  onStartEdit,
  onPin,
  onArchive,
  onDelete,
  onMarkRead,
}: ConversationContextMenuProps) {
  const conv = conversations.find((c) => c.id === contextMenu.id);
  if (!conv) return null;

  return (
    <div
      className="fixed z-50 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 min-w-[140px]"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => {
          onStartEdit(conv.id, conv.title);
          onClose();
        }}
        className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
      >
        ✏️ Rename
      </button>
      <button
        onClick={() => {
          onPin(conv.id, conv.pinned);
          onClose();
        }}
        className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
      >
        {conv.pinned ? "📌 Unpin" : "📌 Pin"}
      </button>
      <button
        onClick={() => {
          markConversationRead(conv.id);
          onMarkRead(conv.id);
          onClose();
          toast.success("Marked as read");
        }}
        className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
      >
        ✓ Mark as read
      </button>
      <button
        onClick={() => {
          onArchive(conv.id);
          onClose();
        }}
        className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
      >
        📦 Archive
      </button>
      <div className="border-t border-slate-700 my-1" />
      <button
        onClick={() => {
          onDelete(conv.id);
          onClose();
        }}
        className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30 transition-colors"
      >
        🗑 Delete
      </button>
    </div>
  );
}

// ---- Agent Context Menu ------------------------------------------------------

interface AgentContextMenuProps {
  agentContextMenu: { id: string; x: number; y: number };
  fleetAgents: FleetAgent[];
  onClose: () => void;
  onSelectFleetAgent: (agent: FleetAgent | null) => void;
  onNewConversation: (agentId?: string | null) => void;
  onDeleteAgent: (agentId: string) => void;
}

export function AgentContextMenu({
  agentContextMenu,
  fleetAgents,
  onClose,
  onSelectFleetAgent,
  onNewConversation,
  onDeleteAgent,
}: AgentContextMenuProps) {
  const agent = fleetAgents.find((a) => a.id === agentContextMenu.id);
  if (!agent) return null;

  return (
    <div
      className="fixed z-50 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 min-w-[140px]"
      style={{ left: agentContextMenu.x, top: agentContextMenu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => {
          onSelectFleetAgent(agent);
          onNewConversation(agent.id);
          onClose();
        }}
        className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
      >
        💬 New Conversation
      </button>
      <div className="border-t border-slate-700 my-1" />
      <button
        onClick={() => {
          onDeleteAgent(agent.id);
          onClose();
        }}
        className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30 transition-colors"
      >
        🗑 Delete Agent
      </button>
    </div>
  );
}
