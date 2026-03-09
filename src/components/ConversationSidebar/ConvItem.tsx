import type { Conversation } from "@/lib/conversations";
import { formatRelativeTime } from "./types";

interface ConvItemProps {
  conv: Conversation;
  agentId?: string | null;
  isUnread: boolean;
  isActive: boolean;
  isEditing: boolean;
  editTitle: string;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  onEditTitleChange: (title: string) => void;
  onRename: (id: string) => void;
  onCancelEdit: () => void;
  onSelect: (convId: string, agentId?: string | null) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
}

export function ConvItem({
  conv,
  agentId,
  isUnread,
  isActive,
  isEditing,
  editTitle,
  editInputRef,
  onEditTitleChange,
  onRename,
  onCancelEdit,
  onSelect,
  onContextMenu,
}: ConvItemProps) {
  if (isEditing) {
    return (
      <div className="px-2.5 py-1.5">
        <input
          ref={editInputRef}
          type="text"
          value={editTitle}
          onChange={(e) => onEditTitleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onRename(conv.id);
            if (e.key === "Escape") onCancelEdit();
          }}
          onBlur={() => onRename(conv.id)}
          className="w-full bg-slate-800 border border-blue-500/50 rounded px-2 py-1 text-[11px] text-white focus:outline-none"
        />
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(conv.id, agentId)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(conv.id, e.clientX, e.clientY);
      }}
      className={`w-full text-left px-2.5 py-2 rounded-lg transition-all duration-150 group relative ${
        isActive
          ? "bg-slate-800 border border-slate-700/50"
          : isUnread
            ? "bg-blue-950/30 border border-blue-800/30 hover:bg-blue-950/40"
            : "hover:bg-slate-800/50"
      }`}
    >
      {/* Unread dot indicator */}
      {isUnread && !isActive && (
        <span className="absolute left-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-blue-400" />
      )}
      <div className="flex items-center justify-between">
        <span
          className={`text-[11px] font-medium truncate flex-1 ${
            isActive
              ? "text-white"
              : isUnread
                ? "text-blue-200 font-semibold"
                : "text-slate-300"
          }`}
        >
          {conv.pinned && "📌 "}
          {conv.title}
        </span>
        <span className="text-[9px] text-slate-600 ml-2 flex-shrink-0">
          {formatRelativeTime(conv.updated_at)}
        </span>
      </div>
      {conv.last_message && (
        <p className={`text-[10px] mt-0.5 truncate ${isUnread ? "text-blue-300/70" : "text-slate-500"}`}>
          {conv.last_message.slice(0, 60)}
        </p>
      )}
      <span className="text-[9px] text-slate-600">
        {conv.message_count} messages
      </span>
    </button>
  );
}
