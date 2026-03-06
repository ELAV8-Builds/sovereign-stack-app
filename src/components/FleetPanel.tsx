/**
 * Fleet Panel — Agent Management UI
 *
 * Shows fleet agent list, launch dialog, and agent status.
 * Designed to sit alongside the conversation sidebar in ChatInterface.
 */
import { useState, useEffect, useCallback } from "react";
import {
  getFleetAgents,
  getFleetTemplates,
  createFleetAgent,
  stopFleetAgent,
  startFleetAgent,
  deleteFleetAgent,
  submitAgentTask,
  getQueueInfo,
  type FleetAgent,
  type FleetTemplate,
  type QueueInfo,
} from "@/lib/fleet";
import toast from "react-hot-toast";

// ─── Props ───────────────────────────────────────────────────────────

interface FleetPanelProps {
  /** Currently selected fleet agent (null = main agent) */
  activeAgentId: string | null;
  /** Callback when user selects an agent to chat with */
  onSelectAgent: (agent: FleetAgent | null) => void;
  /** Whether the launch dialog is open */
  showLaunchDialog: boolean;
  /** Close the launch dialog */
  onCloseLaunchDialog: () => void;
}

// ─── Component ───────────────────────────────────────────────────────

export function FleetPanel({
  activeAgentId,
  onSelectAgent,
  showLaunchDialog,
  onCloseLaunchDialog,
}: FleetPanelProps) {
  const [agents, setAgents] = useState<FleetAgent[]>([]);
  const [templates, setTemplates] = useState<FleetTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [customName, setCustomName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [queueInfo, setQueueInfo] = useState<QueueInfo | null>(null);
  const [taskInput, setTaskInput] = useState<Record<string, string>>({});
  const [submittingTask, setSubmittingTask] = useState<string | null>(null);

  // ── Load agents, templates, and queue info ──────────────────────

  const loadAgents = useCallback(async () => {
    const result = await getFleetAgents();
    setAgents(result);
  }, []);

  const loadQueueInfo = useCallback(async () => {
    const info = await getQueueInfo();
    setQueueInfo(info);
  }, []);

  useEffect(() => {
    loadAgents();
    loadQueueInfo();
    // Poll every 5 seconds for status changes
    const interval = setInterval(() => {
      loadAgents();
      loadQueueInfo();
    }, 5_000);
    return () => clearInterval(interval);
  }, [loadAgents, loadQueueInfo]);

  useEffect(() => {
    if (showLaunchDialog && templates.length === 0) {
      setLoading(true);
      getFleetTemplates().then((t) => {
        setTemplates(t);
        setLoading(false);
      });
    }
  }, [showLaunchDialog, templates.length]);

  // ── Launch agent ─────────────────────────────────────────────────

  const handleLaunch = async () => {
    if (!selectedTemplate) {
      toast.error("Select a template first");
      return;
    }

    const tmpl = templates.find((t) => t.id === selectedTemplate);
    const name =
      customName.trim() ||
      `${tmpl?.name || "Agent"} ${agents.length + 1}`;

    setLaunching(true);
    try {
      const agent = await createFleetAgent({
        name,
        template: selectedTemplate,
      });
      toast.success(`${agent.icon} ${agent.name} launched!`);
      setCustomName("");
      setSelectedTemplate(null);
      onCloseLaunchDialog();
      await loadAgents();
      onSelectAgent(agent);
    } catch (err) {
      toast.error(`Failed to launch: ${(err as Error).message}`);
    } finally {
      setLaunching(false);
    }
  };

  // ── Stop / Start / Delete ────────────────────────────────────────

  const handleStop = async (agent: FleetAgent, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await stopFleetAgent(agent.id);
      toast.success(`${agent.icon} ${agent.name} stopped`);
      await loadAgents();
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    }
  };

  const handleStart = async (agent: FleetAgent, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await startFleetAgent(agent.id);
      toast.success(`${agent.icon} ${agent.name} started`);
      await loadAgents();
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    }
  };

  const handleDelete = async (agent: FleetAgent, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete !== agent.id) {
      setConfirmDelete(agent.id);
      setTimeout(() => setConfirmDelete(null), 3000);
      return;
    }
    try {
      await deleteFleetAgent(agent.id);
      toast.success(`${agent.icon} ${agent.name} destroyed`);
      if (activeAgentId === agent.id) {
        onSelectAgent(null);
      }
      await loadAgents();
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    }
    setConfirmDelete(null);
  };

  // ── Submit background task ───────────────────────────────────────

  const handleSubmitTask = async (agent: FleetAgent) => {
    const message = taskInput[agent.id]?.trim();
    if (!message) return;

    setSubmittingTask(agent.id);
    try {
      const job = await submitAgentTask(agent.id, message);
      toast.success(`${agent.icon} Task queued: ${job.id.slice(0, 12)}...`);
      setTaskInput((prev) => ({ ...prev, [agent.id]: "" }));
      loadQueueInfo();
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    } finally {
      setSubmittingTask(null);
    }
  };

  // ── Agents List (shown below sidebar) ────────────────────────────

  const runningAgents = agents.filter((a) => a.status === "running");
  const stoppedAgents = agents.filter((a) => a.status !== "running");

  const AgentList = () => {
    if (agents.length === 0 && !queueInfo) return null;

    return (
      <div className="border-t border-slate-800 pt-2 mt-2">
        {/* Queue Status Bar */}
        {queueInfo && (queueInfo.running > 0 || queueInfo.queued > 0) && (
          <div className="mx-2 mb-2 px-2 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/50">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                {queueInfo.running} working · {queueInfo.queued} queued
              </span>
              <span className={`${queueInfo.backoffActive ? 'text-amber-400' : 'text-slate-600'}`}>
                CPU {queueInfo.systemLoad}%
                {queueInfo.backoffActive && ' ⚠️'}
              </span>
            </div>
            {queueInfo.backoffActive && (
              <div className="text-[9px] text-amber-400/70 mt-0.5">
                System load high — new tasks paused
              </div>
            )}
          </div>
        )}

        {agents.length === 0 ? null : (
        <>
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-600 font-medium">
            Fleet Agents
          </span>
          <span className="text-[10px] text-slate-600">
            {runningAgents.length} running
          </span>
        </div>

        {runningAgents.map((agent) => (
          <div key={agent.id} className="mb-1">
            <button
              onClick={() => onSelectAgent(agent)}
              className={`w-full text-left px-2 py-1.5 rounded-lg text-sm flex items-center gap-2 group transition-all ${
                activeAgentId === agent.id
                  ? "bg-blue-900/30 text-blue-300 border border-blue-800/50"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
              }`}
            >
              <span className="text-base">{agent.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="truncate text-xs font-medium">{agent.name}</div>
                <div className="text-[10px] text-slate-600">
                  {agent.message_count || 0} msgs · {agent.model}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => handleStop(agent, e)}
                  className="p-0.5 rounded hover:bg-red-900/30 text-slate-600 hover:text-red-400 transition-colors"
                  title="Stop agent"
                >
                  <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                    <rect x="3" y="3" width="10" height="10" rx="1" />
                  </svg>
                </button>
                <button
                  onClick={(e) => handleDelete(agent, e)}
                  className={`p-0.5 rounded transition-colors ${
                    confirmDelete === agent.id
                      ? "bg-red-900/50 text-red-400"
                      : "hover:bg-red-900/30 text-slate-600 hover:text-red-400"
                  }`}
                  title={confirmDelete === agent.id ? "Click again to confirm" : "Delete agent"}
                >
                  <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
            </button>

            {/* Background task input */}
            <div className="flex gap-1 px-2 mt-0.5">
              <input
                type="text"
                value={taskInput[agent.id] || ""}
                onChange={(e) =>
                  setTaskInput((prev) => ({ ...prev, [agent.id]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmitTask(agent);
                  }
                }}
                placeholder="Background task..."
                className="flex-1 min-w-0 bg-slate-800/50 border border-slate-700/50 rounded px-1.5 py-0.5 text-[10px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-700"
              />
              <button
                onClick={() => handleSubmitTask(agent)}
                disabled={!taskInput[agent.id]?.trim() || submittingTask === agent.id}
                className={`px-1.5 py-0.5 rounded text-[10px] transition-all ${
                  taskInput[agent.id]?.trim() && submittingTask !== agent.id
                    ? "bg-blue-900/40 text-blue-400 hover:bg-blue-900/60 border border-blue-800/50"
                    : "bg-slate-800/30 text-slate-700 cursor-not-allowed"
                }`}
                title="Send task to run in background"
              >
                {submittingTask === agent.id ? "..." : "▶"}
              </button>
            </div>
          </div>
        ))}

        {stoppedAgents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => onSelectAgent(agent)}
            className={`w-full text-left px-2 py-1.5 rounded-lg text-sm flex items-center gap-2 group transition-all ${
              activeAgentId === agent.id
                ? "bg-slate-800/50 text-slate-300 border border-slate-700"
                : "text-slate-600 hover:bg-slate-800/30 hover:text-slate-400"
            }`}
          >
            <span className="text-base opacity-50">{agent.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="truncate text-xs font-medium">{agent.name}</div>
              <div className="text-[10px] text-slate-700">stopped</div>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => handleStart(agent, e)}
                className="p-0.5 rounded hover:bg-green-900/30 text-slate-600 hover:text-green-400 transition-colors"
                title="Start agent"
              >
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                  <polygon points="4,2 14,8 4,14" />
                </svg>
              </button>
              <button
                onClick={(e) => handleDelete(agent, e)}
                className={`p-0.5 rounded transition-colors ${
                  confirmDelete === agent.id
                    ? "bg-red-900/50 text-red-400"
                    : "hover:bg-red-900/30 text-slate-600 hover:text-red-400"
                }`}
                title={confirmDelete === agent.id ? "Click again to confirm" : "Delete agent"}
              >
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
            <span className="w-1.5 h-1.5 rounded-full bg-slate-700 flex-shrink-0" />
          </button>
        ))}
        </>
        )}
      </div>
    );
  };

  // ── Launch Dialog Modal ──────────────────────────────────────────

  const LaunchDialog = () => {
    if (!showLaunchDialog) return null;

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onCloseLaunchDialog}
      >
        <div
          className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full mx-4 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-slate-800">
            <div>
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                🚀 Launch New Agent
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Fleet Mode — spawn specialized agents
              </p>
            </div>
            <button
              onClick={onCloseLaunchDialog}
              className="p-1 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
          </div>

          {/* Agent Name */}
          <div className="px-5 pt-4">
            <label className="text-xs text-slate-400 font-medium block mb-1.5">
              Agent Name (optional)
            </label>
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="e.g., Frontend Builder, API Tester..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-600 transition-colors"
              autoFocus
            />
          </div>

          {/* Template Selection */}
          <div className="px-5 pt-4 pb-2">
            <label className="text-xs text-slate-400 font-medium block mb-2">
              Choose a Template
            </label>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <span className="animate-spin w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {templates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    onClick={() => setSelectedTemplate(tmpl.id)}
                    className={`text-left p-3 rounded-xl border transition-all ${
                      selectedTemplate === tmpl.id
                        ? "bg-blue-900/30 border-blue-700 ring-1 ring-blue-600"
                        : "bg-slate-800/50 border-slate-700 hover:border-slate-600 hover:bg-slate-800"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{tmpl.icon}</span>
                      <span className="text-sm font-medium text-white">
                        {tmpl.name}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-snug">
                      {tmpl.description}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                        {tmpl.model}
                      </span>
                      <span className="text-[10px] text-slate-600">
                        {tmpl.toolCount} tools
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Fleet Info */}
          {agents.length > 0 && (
            <div className="px-5 py-2">
              <div className="text-[11px] text-slate-600 bg-slate-800/50 rounded-lg px-3 py-2 flex items-center gap-2">
                <span className="text-blue-400">ℹ</span>
                {runningAgents.length} agent{runningAgents.length !== 1 ? "s" : ""} currently running
                {stoppedAgents.length > 0 && ` · ${stoppedAgents.length} stopped`}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-800">
            <button
              onClick={onCloseLaunchDialog}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleLaunch}
              disabled={!selectedTemplate || launching}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                selectedTemplate && !launching
                  ? "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/30"
                  : "bg-slate-800 text-slate-600 cursor-not-allowed"
              }`}
            >
              {launching ? (
                <>
                  <span className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
                  Launching...
                </>
              ) : (
                <>🚀 Launch Agent</>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <AgentList />
      <LaunchDialog />
    </>
  );
}
