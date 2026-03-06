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
  getFleetAgents,
  type FleetAgent,
} from "@/lib/fleet";

interface ConversationSidebarProps {
  activeConversationId: string | null;
  onSelectConversation: (id: string, agentId?: string | null) => void;
  onNewConversation: (agentId?: string | null) => void;
  onSelectFleetAgent: (agent: FleetAgent | null) => void;
  activeFleetAgentId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onShowLaunchAgent: () => void;
}

// ─── Time formatting ────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ─── Component ──────────────────────────────────────────────────────────

export function ConversationSidebar({
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onSelectFleetAgent,
  activeFleetAgentId,
  collapsed,
  onToggleCollapse,
  onShowLaunchAgent,
}: ConversationSidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [fleetAgents, setFleetAgents] = useState<FleetAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(new Set());
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const editInputRef = useRef<HTMLInputElement>(null);

  // ── Load conversations + fleet agents ──────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [convs, agents] = await Promise.all([
        listConversations({ limit: 100 }),
        getFleetAgents(),
      ]);
      setConversations(convs);
      setFleetAgents(agents);
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

  // ── Search with debounce ──────────────────────────────────────────────

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

  // ── Focus edit input ──────────────────────────────────────────────────

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // ── Close context menu on click outside ───────────────────────────────

  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [contextMenu]);

  // ── Actions ───────────────────────────────────────────────────────────

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

  const toggleAgentCollapsed = (agentId: string) => {
    setCollapsedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  // ── Collapsed mode ────────────────────────────────────────────────────

  if (collapsed) {
    return (
      <div className="w-12 flex-shrink-0 border-r border-slate-800 bg-slate-900/50 flex flex-col items-center pt-3 gap-2">
        <button
          onClick={onToggleCollapse}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-all"
          title="Expand sidebar"
        >
          ▸
        </button>
        <button
          onClick={() => onNewConversation(null)}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-blue-400 hover:text-blue-300 hover:bg-blue-900/30 transition-all"
          title="New conversation"
        >
          +
        </button>
        {/* Fleet agent icons */}
        {fleetAgents.length > 0 && (
          <div className="border-t border-slate-800 pt-2 mt-1 flex flex-col gap-1">
            {fleetAgents.map(agent => (
              <button
                key={agent.id}
                onClick={() => {
                  onSelectFleetAgent(agent);
                  if (agent.conversation_id) {
                    onSelectConversation(agent.conversation_id, agent.id);
                  }
                }}
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all ${
                  activeFleetAgentId === agent.id
                    ? "bg-blue-900/40 ring-1 ring-blue-700"
                    : "hover:bg-slate-800"
                }`}
                title={agent.name}
              >
                {agent.icon}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Group conversations by agent ───────────────────────────────────────

  const mainConversations = conversations.filter(c => !c.agent_id);
  const agentConversationMap = new Map<string, Conversation[]>();
  for (const conv of conversations) {
    if (conv.agent_id) {
      const existing = agentConversationMap.get(conv.agent_id) || [];
      existing.push(conv);
      agentConversationMap.set(conv.agent_id, existing);
    }
  }

  // ── Render a single conversation item ──────────────────────────────────

  const ConvItem = ({ conv, agentId }: { conv: Conversation; agentId?: string | null }) => {
    if (editingId === conv.id) {
      return (
        <div className="px-2.5 py-1.5">
          <input
            ref={editInputRef}
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename(conv.id);
              if (e.key === "Escape") setEditingId(null);
            }}
            onBlur={() => handleRename(conv.id)}
            className="w-full bg-slate-800 border border-blue-500/50 rounded px-2 py-1 text-[11px] text-white focus:outline-none"
          />
        </div>
      );
    }

    return (
      <button
        onClick={() => onSelectConversation(conv.id, agentId)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ id: conv.id, x: e.clientX, y: e.clientY });
        }}
        className={`w-full text-left px-2.5 py-2 rounded-lg transition-all duration-150 group ${
          activeConversationId === conv.id
            ? "bg-slate-800 border border-slate-700/50"
            : "hover:bg-slate-800/50"
        }`}
      >
        <div className="flex items-center justify-between">
          <span
            className={`text-[11px] font-medium truncate flex-1 ${
              activeConversationId === conv.id
                ? "text-white"
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
          <p className="text-[10px] text-slate-500 mt-0.5 truncate">
            {conv.last_message.slice(0, 60)}
          </p>
        )}
        <span className="text-[9px] text-slate-600">
          {conv.message_count} messages
        </span>
      </button>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────

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
          onClick={() => onNewConversation(activeFleetAgentId)}
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
                  onSelectConversation(result.conversation_id);
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
          <>
            {/* ─── Main Agent Section ─────────────────────────── */}
            <div className="mb-1">
              <div className="flex items-center justify-between px-3 py-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">🤖</span>
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    Main Agent
                  </span>
                </div>
                <button
                  onClick={() => {
                    onSelectFleetAgent(null);
                    onNewConversation(null);
                  }}
                  className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                  title="New main conversation"
                >
                  + New
                </button>
              </div>

              {mainConversations.length === 0 ? (
                <div className="px-3 py-2 text-center">
                  <p className="text-[10px] text-slate-600">No conversations yet</p>
                  <button
                    onClick={() => onNewConversation(null)}
                    className="mt-1 text-[10px] text-blue-400 hover:text-blue-300"
                  >
                    Start a conversation →
                  </button>
                </div>
              ) : (
                <div className="px-2">
                  {mainConversations.slice(0, 10).map((conv) => (
                    <div key={conv.id} className="mb-0.5">
                      <ConvItem conv={conv} agentId={null} />
                    </div>
                  ))}
                  {mainConversations.length > 10 && (
                    <div className="text-[9px] text-slate-600 text-center py-1">
                      +{mainConversations.length - 10} more
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ─── Fleet Agent Sections ────────────────────────── */}
            {fleetAgents.length > 0 && (
              <div className="border-t border-slate-800 pt-1 mt-1">
                <div className="flex items-center justify-between px-3 py-1.5">
                  <span className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">
                    Fleet Agents
                  </span>
                  <button
                    onClick={onShowLaunchAgent}
                    className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5 transition-colors"
                    title="Launch new agent"
                  >
                    + Agent
                  </button>
                </div>

                {fleetAgents.map((agent) => {
                  const agentConvs = agentConversationMap.get(agent.id) || [];
                  const isActive = activeFleetAgentId === agent.id;
                  const isCollapsed = collapsedAgents.has(agent.id);
                  const isRunning = agent.status === 'running';

                  return (
                    <div key={agent.id} className="mb-0.5">
                      {/* Agent header row */}
                      <div
                        className={`flex items-center gap-1.5 px-2 py-1.5 mx-1 rounded-lg cursor-pointer transition-all ${
                          isActive
                            ? "bg-blue-900/25 border border-blue-800/40"
                            : "hover:bg-slate-800/50"
                        }`}
                      >
                        <button
                          onClick={() => toggleAgentCollapsed(agent.id)}
                          className="text-[9px] text-slate-600 w-3 flex-shrink-0"
                        >
                          {isCollapsed ? "▸" : "▾"}
                        </button>
                        <button
                          onClick={() => {
                            onSelectFleetAgent(agent);
                            if (agent.conversation_id) {
                              onSelectConversation(agent.conversation_id, agent.id);
                            }
                          }}
                          className="flex-1 min-w-0 flex items-center gap-1.5"
                        >
                          <span className="text-sm flex-shrink-0">{agent.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-medium text-slate-300 truncate">
                              {agent.name}
                            </div>
                            <div className="text-[9px] text-slate-600">
                              {agent.model} · {agent.message_count || 0} msgs
                            </div>
                          </div>
                        </button>
                        <span
                          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            isRunning ? "bg-green-400" : "bg-slate-600"
                          }`}
                          title={isRunning ? "Running" : "Stopped"}
                        />
                      </div>

                      {/* Agent conversations (collapsible) */}
                      {!isCollapsed && (
                        <div className="pl-6 pr-2 mt-0.5">
                          {agentConvs.map((conv) => (
                            <div key={conv.id} className="mb-0.5">
                              <ConvItem conv={conv} agentId={agent.id} />
                            </div>
                          ))}
                          <button
                            onClick={() => {
                              onSelectFleetAgent(agent);
                              onNewConversation(agent.id);
                            }}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg text-[10px] text-blue-400/70 hover:text-blue-300 hover:bg-slate-800/50 transition-all"
                          >
                            + New conversation
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Launch first agent prompt */}
            {fleetAgents.length === 0 && (
              <div className="border-t border-slate-800 pt-2 mt-1 px-3">
                <button
                  onClick={onShowLaunchAgent}
                  className="w-full text-center py-2 rounded-lg border border-dashed border-slate-700 text-[10px] text-slate-500 hover:text-blue-400 hover:border-blue-700 transition-all"
                >
                  🚀 Launch a Fleet Agent
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const conv = conversations.find((c) => c.id === contextMenu.id);
            if (!conv) return null;
            return (
              <>
                <button
                  onClick={() => {
                    setEditingId(conv.id);
                    setEditTitle(conv.title);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  ✏️ Rename
                </button>
                <button
                  onClick={() => {
                    handlePin(conv.id, conv.pinned);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  {conv.pinned ? "📌 Unpin" : "📌 Pin"}
                </button>
                <button
                  onClick={() => {
                    handleArchive(conv.id);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  📦 Archive
                </button>
                <div className="border-t border-slate-700 my-1" />
                <button
                  onClick={() => {
                    handleDelete(conv.id);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30 transition-colors"
                >
                  🗑 Delete
                </button>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
