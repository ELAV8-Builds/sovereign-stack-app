import type { Conversation } from "@/lib/conversations";
import type { FleetAgent, AgentJob } from "@/lib/fleet";
import { ConvItem } from "./ConvItem";
import { getAgentColor } from "./types";

interface FleetSectionProps {
  fleetAgents: FleetAgent[];
  agentConversationMap: Map<string, Conversation[]>;
  activeFleetAgentId: string | null;
  activeConversationId: string | null;
  collapsedAgents: Set<string>;
  completedAgents: Set<string>;
  unreadIds: Set<string>;
  agentJobs: Map<string, AgentJob>;
  editingId: string | null;
  editTitle: string;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  countAgentUnread: (agentId: string) => number;
  onEditTitleChange: (title: string) => void;
  onRename: (id: string) => void;
  onCancelEdit: () => void;
  onSelectConv: (convId: string, agentId?: string | null) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onAgentContextMenu: (id: string, x: number, y: number) => void;
  toggleAgentCollapsed: (agentId: string) => void;
  onSelectFleetAgent: (agent: FleetAgent | null) => void;
  onNewConversation: (agentId?: string | null) => void;
  onShowLaunchAgent: () => void;
}

export function FleetSection({
  fleetAgents,
  agentConversationMap,
  activeFleetAgentId,
  activeConversationId,
  collapsedAgents,
  completedAgents,
  unreadIds,
  agentJobs,
  editingId,
  editTitle,
  editInputRef,
  countAgentUnread,
  onEditTitleChange,
  onRename,
  onCancelEdit,
  onSelectConv,
  onContextMenu,
  onAgentContextMenu,
  toggleAgentCollapsed,
  onSelectFleetAgent,
  onNewConversation,
  onShowLaunchAgent,
}: FleetSectionProps) {
  if (fleetAgents.length === 0) {
    return (
      <div className="border-t border-slate-800 pt-2 mt-1 px-3">
        <button
          onClick={onShowLaunchAgent}
          className="w-full text-center py-2 rounded-lg border border-dashed border-slate-700 text-[10px] text-slate-500 hover:text-blue-400 hover:border-blue-700 transition-all"
        >
          🚀 Launch a Fleet Agent
        </button>
      </div>
    );
  }

  return (
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
                onAgentContextMenu(agent.id, e.clientX, e.clientY);
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
                    onSelectConv(agent.conversation_id, agent.id);
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

            {/* Live activity status line */}
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
                    <ConvItem
                      conv={conv}
                      agentId={agent.id}
                      isUnread={unreadIds.has(conv.id)}
                      isActive={activeConversationId === conv.id}
                      isEditing={editingId === conv.id}
                      editTitle={editTitle}
                      editInputRef={editInputRef}
                      onEditTitleChange={onEditTitleChange}
                      onRename={onRename}
                      onCancelEdit={onCancelEdit}
                      onSelect={onSelectConv}
                      onContextMenu={onContextMenu}
                    />
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
  );
}
