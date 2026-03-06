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
  type FleetAgent,
  type FleetTemplate,
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
  // ── Load agents (for launch dialog count) ──────────────────────

  const loadAgents = useCallback(async () => {
    const result = await getFleetAgents();
    setAgents(result);
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

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
                {agents.filter(a => a.status === 'running').length} agent{agents.filter(a => a.status === 'running').length !== 1 ? "s" : ""} currently running
                {agents.filter(a => a.status !== 'running').length > 0 && ` · ${agents.filter(a => a.status !== 'running').length} stopped`}
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
      <LaunchDialog />
    </>
  );
}
