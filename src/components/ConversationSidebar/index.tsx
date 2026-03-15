import { useState, useEffect, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import {
  listConversations,
  updateConversation,
  deleteConversation,
  searchConversations,
  type Conversation,
  type SearchResult,
} from "@/lib/conversations";
import {
  markConversationRead,
  getUnreadConversationIds,
} from "@/lib/unread";

import type { ConversationSidebarProps } from "./types";
import { formatRelativeTime } from "./types";
import { ConvItem } from "./ConvItem";
import { ConversationContextMenu } from "./ContextMenu";

// ---- Component ---------------------------------------------------------------

export function ConversationSidebar({
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  collapsed,
  onToggleCollapse,
}: ConversationSidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const editInputRef = useRef<HTMLInputElement>(null);

  // ---- Load conversations ----------------------------------------------------

  const loadData = useCallback(async () => {
    try {
      const convs = await listConversations({ limit: 100 });
      setConversations(convs);
      const unread = getUnreadConversationIds(convs);
      setUnreadIds(unread);
    } catch {
      // API not available — silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  // ---- Search with debounce -------------------------------------------------

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    searchTimeoutRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const result = await searchConversations(searchQuery);
        setSearchResults(result.results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery]);

  // ---- Focus edit input -----------------------------------------------------

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // ---- Close context menus on click outside ---------------------------------

  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [contextMenu]);

  // ---- Actions --------------------------------------------------------------

  const handleRename = async (id: string) => {
    if (!editTitle.trim()) {
      setEditingId(null);
      return;
    }
    try {
      await updateConversation(id, { title: editTitle.trim() });
      setEditingId(null);
      await loadData();
    } catch {
      toast.error("Failed to rename");
    }
  };

  const handlePin = async (id: string, currentlyPinned: boolean) => {
    try {
      await updateConversation(id, { pinned: !currentlyPinned });
      await loadData();
    } catch {
      toast.error("Failed to update");
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await updateConversation(id, { archived: true });
      toast.success("Conversation archived");
      await loadData();
    } catch {
      toast.error("Failed to archive");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteConversation(id);
      toast.success("Conversation deleted");
      await loadData();
    } catch {
      toast.error("Failed to delete");
    }
  };

  const handleSelectConv = (convId: string) => {
    markConversationRead(convId);
    setUnreadIds(prev => {
      const next = new Set(prev);
      next.delete(convId);
      return next;
    });
    onSelectConversation(convId);
  };

  const handleMarkRead = (convId: string) => {
    setUnreadIds(prev => {
      const next = new Set(prev);
      next.delete(convId);
      return next;
    });
  };

  // ---- Collapsed mode -------------------------------------------------------

  if (collapsed) {
    const totalUnread = unreadIds.size;

    return (
      <div className="w-12 flex-shrink-0 border-r border-slate-800 bg-slate-900/50 flex flex-col items-center pt-3 gap-2">
        <button
          onClick={onToggleCollapse}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-all relative"
          title="Expand sidebar"
        >
          ▸
          {totalUnread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-blue-500 text-[8px] text-white flex items-center justify-center font-bold">
              {totalUnread > 9 ? "9+" : totalUnread}
            </span>
          )}
        </button>
        <button
          onClick={() => onNewConversation()}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-blue-400 hover:text-blue-300 hover:bg-blue-900/30 transition-all"
          title="New conversation"
        >
          +
        </button>
      </div>
    );
  }

  // ---- Render ---------------------------------------------------------------

  return (
    <div className="w-64 flex-shrink-0 border-r border-slate-800 bg-slate-900/50 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800">
        <button
          onClick={onToggleCollapse}
          className="w-7 h-7 rounded flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-all text-xs"
          title="Collapse sidebar"
        >
          ◂
        </button>
        <span className="text-xs font-medium text-slate-400">Conversations</span>
        <button
          onClick={() => onNewConversation()}
          className="w-7 h-7 rounded flex items-center justify-center text-blue-400 hover:text-blue-300 hover:bg-blue-900/30 transition-all text-sm"
          title="New conversation"
        >
          +
        </button>
      </div>

      {/* Search */}
      <div className="px-2 py-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search conversations..."
          className="w-full bg-slate-800/70 border border-slate-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50 transition-all"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {/* Search results */}
        {searchResults !== null ? (
          <div className="px-2 py-1">
            {searchLoading && (
              <div className="flex items-center gap-2 px-2 py-3 justify-center">
                <span className="animate-spin w-3 h-3 border border-blue-400 border-t-transparent rounded-full" />
                <span className="text-[10px] text-slate-500">Searching...</span>
              </div>
            )}
            {!searchLoading && searchResults.length === 0 && (
              <p className="text-[10px] text-slate-600 text-center py-4">No results</p>
            )}
            {searchResults.map((result) => (
              <button
                key={result.message_id}
                onClick={() => {
                  handleSelectConv(result.conversation_id);
                  setSearchQuery("");
                  setSearchResults(null);
                }}
                className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-800/70 transition-all mb-1 group"
              >
                <div className="text-[11px] font-medium text-slate-300 truncate">
                  {result.conversation_title}
                </div>
                <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">
                  {result.snippet || result.content.slice(0, 80)}
                </p>
                <span className="text-[9px] text-slate-600 mt-0.5 block">
                  {formatRelativeTime(result.message_date)}
                </span>
              </button>
            ))}
          </div>
        ) : loading ? (
          <div className="flex items-center gap-2 px-3 py-6 justify-center">
            <span className="animate-spin w-3 h-3 border border-slate-500 border-t-transparent rounded-full" />
            <span className="text-[10px] text-slate-500">Loading...</span>
          </div>
        ) : (
          <div className="px-2">
            {conversations.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <p className="text-[10px] text-slate-600">No conversations yet</p>
                <button
                  onClick={() => onNewConversation()}
                  className="mt-1 text-[10px] text-blue-400 hover:text-blue-300"
                >
                  Start a conversation
                </button>
              </div>
            ) : (
              conversations.slice(0, 50).map((conv) => (
                <div key={conv.id} className="mb-0.5">
                  <ConvItem
                    conv={conv}
                    agentId={null}
                    isUnread={unreadIds.has(conv.id)}
                    isActive={activeConversationId === conv.id}
                    isEditing={editingId === conv.id}
                    editTitle={editTitle}
                    editInputRef={editInputRef}
                    onEditTitleChange={setEditTitle}
                    onRename={handleRename}
                    onCancelEdit={() => setEditingId(null)}
                    onSelect={handleSelectConv}
                    onContextMenu={(id, x, y) => setContextMenu({ id, x, y })}
                  />
                </div>
              ))
            )}
            {conversations.length > 50 && (
              <div className="text-[9px] text-slate-600 text-center py-1">
                +{conversations.length - 50} more
              </div>
            )}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ConversationContextMenu
          contextMenu={contextMenu}
          conversations={conversations}
          onClose={() => setContextMenu(null)}
          onStartEdit={(id, title) => { setEditingId(id); setEditTitle(title); }}
          onPin={handlePin}
          onArchive={handleArchive}
          onDelete={handleDelete}
          onMarkRead={handleMarkRead}
        />
      )}
    </div>
  );
}
