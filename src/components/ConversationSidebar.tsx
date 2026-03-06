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
  deleteFleetAgent,
  getAgentTasks,
  type FleetAgent,
  type AgentJob,
} from "@/lib/fleet";
import {
  markConversationRead,
  getUnreadConversationIds,
} from "@/lib/unread";
import { playTaskCompleteChime, playNotificationDing } from "@/lib/notifications";

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

// ─── Persist collapsed agents to localStorage ───────────────────────────

const COLLAPSED_KEY = "sovereign_collapsed_agents";

function loadCollapsedAgents(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveCollapsedAgents(set: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]));
  } catch {
    // localStorage not available
  }
}

// ─── Agent accent colors ────────────────────────────────────────────────

const AGENT_COLORS = [
  { border: "border-l-blue-500", dot: "bg-blue-400", text: "text-blue-400", activeBg: "bg-blue-900/25", activeBorder: "border-blue-800/40" },
  { border: "border-l-purple-500", dot: "bg-purple-400", text: "text-purple-400", activeBg: "bg-purple-900/25", activeBorder: "border-purple-800/40" },
  { border: "border-l-emerald-500", dot: "bg-emerald-400", text: "text-emerald-400", activeBg: "bg-emerald-900/25", activeBorder: "border-emerald-800/40" },
  { border: "border-l-amber-500", dot: "bg-amber-400", text: "text-amber-400", activeBg: "bg-amber-900/25", activeBorder: "border-amber-800/40" },
  { border: "border-l-rose-500", dot: "bg-rose-400", text: "text-rose-400", activeBg: "bg-rose-900/25", activeBorder: "border-rose-800/40" },
  { border: "border-l-cyan-500", dot: "bg-cyan-400", text: "text-cyan-400", activeBg: "bg-cyan-900/25", activeBorder: "border-cyan-800/40" },
  { border: "border-l-orange-500", dot: "bg-orange-400", text: "text-orange-400", activeBg: "bg-orange-900/25", activeBorder: "border-orange-800/40" },
  { border: "border-l-indigo-500", dot: "bg-indigo-400", text: "text-indigo-400", activeBg: "bg-indigo-900/25", activeBorder: "border-indigo-800/40" },
];

function getAgentColor(index: number) {
  return AGENT_COLORS[index % AGENT_COLORS.length];
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
  const [agentContextMenu, setAgentContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(loadCollapsedAgents);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
  const [agentJobs, setAgentJobs] = useState<Map<string, AgentJob>>(new Map());
  const [completedAgents, setCompletedAgents] = useState<Set<string>>(new Set()); // NEW: Track recently completed agents
  const prevAgentStatusRef = useRef<Map<string, string>>(new Map());
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

      // Update unread state
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

  // ── Poll fleet agent jobs for live status ──────────────────────────────

  useEffect(() => {
    if (fleetAgents.length === 0) return;

    const pollJobs = async () => {
      const runningAgents = fleetAgents.filter(a => a.status === "running");
      if (runningAgents.length === 0) {
        setAgentJobs(new Map());
        return;
      }

      const jobMap = new Map<string, AgentJob>();
      const prevStatuses = prevAgentStatusRef.current;

      for (const agent of runningAgents) {
        try {
          const jobs = await getAgentTasks(agent.id);
          const activeJob = jobs.find(j => j.status === "running") || jobs[0];
          if (activeJob) {
            jobMap.set(agent.id, activeJob);

            // Check for completion transition → play chime + show checkmark
            const prevStatus = prevStatuses.get(activeJob.id);
            if (prevStatus === "running" && activeJob.status === "completed") {
              if (activeFleetAgentId !== agent.id) {
                playTaskCompleteChime();
                toast.success(`${agent.icon} ${agent.name} finished its task`, { duration: 4000 });
              }
              
              // NEW: Show checkmark for 5 seconds
              setCompletedAgents(prev => new Set(prev).add(agent.id));
              setTimeout(() => {
                setCompletedAgents(prev => {
                  const next = new Set(prev);
                  next.delete(agent.id);
                  return next;
                });
              }, 5000);
            }
            prevStatuses.set(activeJob.id, activeJob.status);
          }
        } catch {
          // Silent fail for individual agent polling
        }
      }

      prevAgentStatusRef.current = prevStatuses;
      setAgentJobs(jobMap);
    };

    pollJobs();
    const interval = setInterval(pollJobs, 5000);
    return () => clearInterval(interval);
  }, [fleetAgents, activeFleetAgentId]);

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

  // ── Close context menus on click outside ──────────────────────────────

  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [contextMenu]);

  useEffect(() => {
    if (!agentContextMenu) return;
    const handler = () => setAgentContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [agentContextMenu]);

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

  const handleDeleteAgent = async (agentId: string) => {
    try {
      await deleteFleetAgent(agentId);
      toast.success("Agent deleted");
      if (activeFleetAgentId === agentId) {
        onSelectFleetAgent(null);
      }
      await loadData();
    } catch {
      toast.error("Failed to delete agent");
    }
  };

  const toggleAgentCollapsed = (agentId: string) => {
    setCollapsedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      saveCollapsedAgents(next);
      return next;
    });
  };

  const handleSelectConv = (convId: string, agentId?: string | null) => {
    // Mark as read when selecting
    markConversationRead(convId);
    setUnreadIds(prev => {
      const next = new Set(prev);
      next.delete(convId);
      return next;
    });
    onSelectConversation(convId, agentId);
  };

  // ── Collapsed mode ────────────────────────────────────────────────────

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
          onClick={() => onNewConversation(null)}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-blue-400 hover:text-blue-300 hover:bg-blue-900/30 transition-all"
          title="New conversation"
        >
          +
        </button>
        {/* Fleet agent icons */}
        {fleetAgents.length > 0 && (
          <div className="border-t border-slate-800 pt-2 mt-1 flex flex-col gap-1">
            {fleetAgents.map((agent, idx) => {
              const color = getAgentColor(idx);
              const agentConvs = conversations.filter(c => c.agent_id === agent.id);
              const hasUnread = agentConvs.some(c => unreadIds.has(c.id));
              const isRunning = agent.status === "running";
              const isCompleted = completedAgents.has(agent.id);

              return (
                <button
                  key={agent.id}
                  onClick={() => {
                    onSelectFleetAgent(agent);
                    if (agent.conversation_id) {
                      handleSelectConv(agent.conversation_id, agent.id);
                    }
                  }}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all relative ${
                    activeFleetAgentId === agent.id
                      ? "bg-blue-900/40 ring-1 ring-blue-700"
                      : "hover:bg-slate-800"
                  }`}
                  title={agent.name}
                >
                  {agent.icon}
                  {hasUnread && (
                    <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${color.dot}`} />
                  )}
                  {isRunning && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  )}
                  {isCompleted && (
                    <span className="absolute -bottom-0.5 -left-0.5 text-[10px] animate-bounce">✓</span>
                  )}
                </button>
              );
            })}
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

  // ── Helper: count unread for an agent ──────────────────────────────────

  const countAgentUnread = (agentId: string): number => {
    const convs = agentConversationMap.get(agentId) || [];
    return convs.filter(c => unreadIds.has(c.id)).length;
  };

  const mainUnreadCount = mainConversations.filter(c => unreadIds.has(c.id)).length;

  // ── Render a single conversation item ──────────────────────────────────

  const ConvItem = ({ conv, agentId }: { conv: Conversation; agentId?: string | null }) => {
    const isUnread = unreadIds.has(conv.id);
    const isActive = activeConversationId === conv.id;

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
        onClick={() => handleSelectConv(conv.id, agentId)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ id: conv.id, x: e.clientX, y: e.clientY });
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
          <>
            {/* ─── Main Agent Section ─────────────────────────── */}
            <div className="mb-1">
              <div
                className="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-slate-800/30 transition-colors rounded-md mx-1"
                onClick={() => toggleAgentCollapsed("__main__")}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-slate-600 w-3 flex-shrink-0">
                    {collapsedAgents.has("__main__") ? "▸" : "▾"}
                  </span>
                  <span className="text-sm">🤖</span>
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    Main Agent
                  </span>
                  {mainUnreadCount > 0 && (
                    <span className="ml-1 px-1.5 py-0 rounded-full bg-blue-500/20 text-blue-400 text-[9px] font-bold">
                      {mainUnreadCount}
                    </span>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectFleetAgent(null);
                    onNewConversation(null);
                  }}
                  className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                  title="New main conversation"
                >
                  + New
                </button>
              </div>

              {!collapsedAgents.has("__main__") && (
                <>
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
                </>
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

                {fleetAgents.map((agent, agentIndex) => {
                  const agentConvs = agentConversationMap.get(agent.id) || [];
                  const isActive = activeFleetAgentId === agent.id;
                  const isCollapsed = collapsedAgents.has(agent.id);
                  const isRunning = agent.status === 'running';
                  const isCompleted = completedAgents.has(agent.id);
                  const agentUnread = countAgentUnread(agent.id);
                  const color = getAgentColor(agentIndex);
                  const activeJob = agentJobs.get(agent.id);

                  return (
                    <div
                      key={agent.id}
                      className={`mb-1 mx-1 rounded-lg border-l-2 ${color.border} ${
                        agentUnread > 0 && !isActive ? "bg-blue-950/20" : ""
                      } transition-all duration-200`}
                    >
                      {/* Agent header row */}
                      <div
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setAgentContextMenu({ id: agent.id, x: e.clientX, y: e.clientY });
                        }}
                        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-r-lg cursor-pointer transition-all ${
                          isActive
                            ? `${color.activeBg} border border-l-0 ${color.activeBorder}`
                            : "hover:bg-slate-800/50"
                        }`}
                      >
                        <button
                          onClick={() => toggleAgentCollapsed(agent.id)}
                          className="text-[9px] text-slate-600 w-3 flex-shrink-0 hover:text-slate-400 transition-colors"
                        >
                          {isCollapsed ? "▸" : "▾"}
                        </button>
                        <button
                          onClick={() => {
                            onSelectFleetAgent(agent);
                            if (agent.conversation_id) {
                              handleSelectConv(agent.conversation_id, agent.id);
                            }
                          }}
                          className="flex-1 min-w-0 flex items-center gap-1.5"
                        >
                          <span className="text-sm flex-shrink-0">{agent.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[11px] font-medium truncate ${
                                agentUnread > 0 ? "text-white font-semibold" : "text-slate-300"
                              }`}>
                                {agent.name}
                              </span>
                              {agentUnread > 0 && (
                                <span className={`px-1 py-0 rounded-full text-[8px] font-bold ${color.text} bg-slate-800/80`}>
                                  {agentUnread}
                                </span>
                              )}
                            </div>
                            <div className="text-[9px] text-slate-600">
                              {agent.model} · {agent.message_count || 0} msgs
                            </div>
                          </div>
                        </button>
                        {/* Status indicators */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {isCompleted && (
                            <span className="text-green-400 text-[11px] animate-pulse" title="Task completed">
                              ✓
                            </span>
                          )}
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isRunning ? "bg-green-400 animate-pulse" : "bg-slate-600"
                            }`}
                            title={isRunning ? "Running" : "Stopped"}
                          />
                        </div>
                      </div>

                      {/* Live activity status line - NEW: Enhanced with step info */}
                      {isRunning && activeJob && activeJob.status === "running" && (
                        <div className="px-3 py-1 flex items-center gap-1.5 border-t border-slate-800/50">
                          <span className="animate-spin w-2 h-2 border border-emerald-400 border-t-transparent rounded-full flex-shrink-0" />
                          <span className="text-[9px] text-emerald-400/80 truncate">
                            {activeJob.progress?.currentTool
                              ? `Step ${activeJob.progress.iteration} · ${activeJob.progress.currentTool}`
                              : activeJob.progress?.lastThinking
                                ? `Step ${activeJob.progress.iteration} · ${activeJob.progress.lastThinking.slice(0, 40)}...`
                                : `Step ${activeJob.progress?.iteration || 1} · Working...`
                            }
                          </span>
                        </div>
                      )}

                      {/* Agent conversations (collapsible) */}
                      {!isCollapsed && (
                        <div className="pl-6 pr-2 mt-0.5 pb-1">
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

                      {/* Collapsed summary */}
                      {isCollapsed && agentConvs.length > 0 && (
                        <div className="px-3 pb-1">
                          <span className="text-[9px] text-slate-600">
                            {agentConvs.length} conversation{agentConvs.length !== 1 ? "s" : ""}
                            {agentUnread > 0 && (
                              <span className={`ml-1 ${color.text}`}>
                                · {agentUnread} unread
                              </span>
                            )}
                          </span>
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
                    markConversationRead(conv.id);
                    setUnreadIds(prev => {
                      const next = new Set(prev);
                      next.delete(conv.id);
                      return next;
                    });
                    setContextMenu(null);
                    toast.success("Marked as read");
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  ✓ Mark as read
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

      {/* Agent context menu */}
      {agentContextMenu && (
        <div
          className="fixed z-50 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 min-w-[140px]"
          style={{ left: agentContextMenu.x, top: agentContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const agent = fleetAgents.find((a) => a.id === agentContextMenu.id);
            if (!agent) return null;
            return (
              <>
                <button
                  onClick={() => {
                    onSelectFleetAgent(agent);
                    onNewConversation(agent.id);
                    setAgentContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  💬 New Conversation
                </button>
                <div className="border-t border-slate-700 my-1" />
                <button
                  onClick={() => {
                    handleDeleteAgent(agent.id);
                    setAgentContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30 transition-colors"
                >
                  🗑 Delete Agent
                </button>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
