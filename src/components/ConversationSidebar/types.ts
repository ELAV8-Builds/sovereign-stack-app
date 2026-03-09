import type { Conversation } from "@/lib/conversations";
import type { FleetAgent, AgentJob } from "@/lib/fleet";

export interface ConversationSidebarProps {
  activeConversationId: string | null;
  onSelectConversation: (id: string, agentId?: string | null) => void;
  onNewConversation: (agentId?: string | null) => void;
  onSelectFleetAgent: (agent: FleetAgent | null) => void;
  activeFleetAgentId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onShowLaunchAgent: () => void;
}

// Shared prop type for sub-components that need access to sidebar state/actions
export interface SidebarContext {
  conversations: Conversation[];
  fleetAgents: FleetAgent[];
  activeConversationId: string | null;
  activeFleetAgentId: string | null;
  unreadIds: Set<string>;
  collapsedAgents: Set<string>;
  completedAgents: Set<string>;
  agentJobs: Map<string, AgentJob>;
  editingId: string | null;
  editTitle: string;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  setEditingId: (id: string | null) => void;
  setEditTitle: (title: string) => void;
  setContextMenu: (menu: { id: string; x: number; y: number } | null) => void;
  setAgentContextMenu: (menu: { id: string; x: number; y: number } | null) => void;
  handleSelectConv: (convId: string, agentId?: string | null) => void;
  handleRename: (id: string) => void;
  toggleAgentCollapsed: (agentId: string) => void;
  onSelectConversation: (id: string, agentId?: string | null) => void;
  onNewConversation: (agentId?: string | null) => void;
  onSelectFleetAgent: (agent: FleetAgent | null) => void;
  onShowLaunchAgent: () => void;
}

// ---- Time formatting --------------------------------------------------------

export function formatRelativeTime(dateStr: string): string {
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

// ---- Persist collapsed agents to localStorage --------------------------------

export const COLLAPSED_KEY = "sovereign_collapsed_agents";

export function loadCollapsedAgents(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function saveCollapsedAgents(set: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]));
  } catch {
    // localStorage not available
  }
}

// ---- Agent accent colors -----------------------------------------------------

export const AGENT_COLORS = [
  { border: "border-l-blue-500", dot: "bg-blue-400", text: "text-blue-400", activeBg: "bg-blue-900/25", activeBorder: "border-blue-800/40" },
  { border: "border-l-purple-500", dot: "bg-purple-400", text: "text-purple-400", activeBg: "bg-purple-900/25", activeBorder: "border-purple-800/40" },
  { border: "border-l-emerald-500", dot: "bg-emerald-400", text: "text-emerald-400", activeBg: "bg-emerald-900/25", activeBorder: "border-emerald-800/40" },
  { border: "border-l-amber-500", dot: "bg-amber-400", text: "text-amber-400", activeBg: "bg-amber-900/25", activeBorder: "border-amber-800/40" },
  { border: "border-l-rose-500", dot: "bg-rose-400", text: "text-rose-400", activeBg: "bg-rose-900/25", activeBorder: "border-rose-800/40" },
  { border: "border-l-cyan-500", dot: "bg-cyan-400", text: "text-cyan-400", activeBg: "bg-cyan-900/25", activeBorder: "border-cyan-800/40" },
  { border: "border-l-orange-500", dot: "bg-orange-400", text: "text-orange-400", activeBg: "bg-orange-900/25", activeBorder: "border-orange-800/40" },
  { border: "border-l-indigo-500", dot: "bg-indigo-400", text: "text-indigo-400", activeBg: "bg-indigo-900/25", activeBorder: "border-indigo-800/40" },
];

export function getAgentColor(index: number) {
  return AGENT_COLORS[index % AGENT_COLORS.length];
}
