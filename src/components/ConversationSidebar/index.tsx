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
import { playTaskCompleteChime } from "@/lib/notifications";

import type { ConversationSidebarProps } from "./types";
import { formatRelativeTime, loadCollapsedAgents, saveCollapsedAgents, getAgentColor } from "./types";
import { ConvItem } from "./ConvItem";
import { ConversationContextMenu, AgentContextMenu } from "./ContextMenu";
import { FleetSection } from "./FleetSection";

// ---- Component ---------------------------------------------------------------

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
  const [completedAgents, setCompletedAgents] = useState<Set<string>>(new Set());
  const prevAgentStatusRef = useRef<Map<string, string>>(new Map());
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const editInputRef = useRef<HTMLInputElement>(null);

  // ---- Load conversations + fleet agents ------------------------------------

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

  // ---- Poll fleet agent jobs for live status --------------------------------

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

            // Check for completion transition -> play chime + show checkmark
            const prevStatus = prevStatuses.get(activeJob.id);
            if (prevStatus === "running" && activeJob.status === "completed") {
              if (activeFleetAgentId !== agent.id) {
                playTaskCompleteChime();
                toast.success(`${agent.icon} ${agent.name} finished its task`, { duration: 4000 });
              }

              // Show checkmark for 5 seconds
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

  useEffect(() => {
    if (!agentContextMenu) return;
    const handler = () => setAgentContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [agentContextMenu]);

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

  // ---- Group conversations by agent -----------------------------------------

  const mainConversations = conversations.filter(c => !c.agent_id);
  const agentConversationMap = new Map<string, Conversation[]>();
  for (const conv of conversations) {
    if (conv.agent_id) {
      const existing = agentConversationMap.get(conv.agent_id) || [];
      existing.push(conv);
      agentConversationMap.set(conv.agent_id, existing);
    }
  }

  // ---- Helper: count unread for an agent ------------------------------------

  const countAgentUnread = (agentId: string): number => {
    const convs = agentConversationMap.get(agentId) || [];
    return convs.filter(c => unreadIds.has(c.id)).length;
  };

  const mainUnreadCount = mainConversations.filter(c => unreadIds.has(c.id)).length;

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
            {/* ---- Main Agent Section ---------------------------------------- */}
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

            {/* ---- Fleet Agent Sections -------------------------------------- */}
            <FleetSection
              fleetAgents={fleetAgents}
              agentConversationMap={agentConversationMap}
              activeFleetAgentId={activeFleetAgentId}
              activeConversationId={activeConversationId}
              collapsedAgents={collapsedAgents}
              completedAgents={completedAgents}
              unreadIds={unreadIds}
              agentJobs={agentJobs}
              editingId={editingId}
              editTitle={editTitle}
              editInputRef={editInputRef}
              countAgentUnread={countAgentUnread}
              onEditTitleChange={setEditTitle}
              onRename={handleRename}
              onCancelEdit={() => setEditingId(null)}
              onSelectConv={handleSelectConv}
              onContextMenu={(id, x, y) => setContextMenu({ id, x, y })}
              onAgentContextMenu={(id, x, y) => setAgentContextMenu({ id, x, y })}
              toggleAgentCollapsed={toggleAgentCollapsed}
              onSelectFleetAgent={onSelectFleetAgent}
              onNewConversation={onNewConversation}
              onShowLaunchAgent={onShowLaunchAgent}
            />
          </>
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

      {/* Agent context menu */}
      {agentContextMenu && (
        <AgentContextMenu
          agentContextMenu={agentContextMenu}
          fleetAgents={fleetAgents}
          onClose={() => setAgentContextMenu(null)}
          onSelectFleetAgent={onSelectFleetAgent}
          onNewConversation={onNewConversation}
          onDeleteAgent={handleDeleteAgent}
        />
      )}
    </div>
  );
}
