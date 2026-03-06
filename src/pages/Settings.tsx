import { useState, useEffect, useCallback } from "react";
import { safeInvoke, localSet } from "@/lib/tauri";
import { AgentNaming } from "../components/AgentNaming";
import { CapacityIndicator } from "../components/CapacityIndicator";
import { NetworkIsolationSelector } from "../components/NetworkIsolationSelector";
import { AutonomySettings } from "../components/AutonomySettings";
import { CostTracker } from "../components/CostTracker";
import { SlackWizard } from "../components/SlackWizard";
import { WhatsAppConnect } from "../components/WhatsAppConnect";
import { HealthCheck } from "../components/HealthCheck";
import { BackupExport } from "../components/BackupExport";
import { ModelConfiguration } from "../components/ModelConfiguration";
import { CompoundCapture } from "../components/CompoundCapture";
import { KnowledgeBase } from "../components/KnowledgeBase";
import toast from "react-hot-toast";

const API_BASE = "/api/sovereign";

interface SystemInfo {
  macos_version: string;
  architecture: string;
  hostname: string;
  current_user: string;
}

interface VaultKey {
  id: string;
  name: string;
  envVar: string;
  category: string;
  placeholder: string;
  description: string;
  configured: boolean;
  updatedAt: string | null;
}

type SettingsSection =
  | "communication"
  | "agent"
  | "knowledge"
  | "system"
  | "security"
  | "advanced";

export default function Settings() {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>("communication");
  // Key Vault state
  const [vaultKeys, setVaultKeys] = useState<VaultKey[]>([]);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [customKeyName, setCustomKeyName] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);

  useEffect(() => {
    loadSystemInfo();
  }, []);

  const loadSystemInfo = async () => {
    try {
      const info = await safeInvoke<SystemInfo>("get_system_info");
      setSystemInfo(info);
    } catch {
      // System info not available outside Tauri runtime
    }
  };

  // ── Key Vault Functions ──────────────────────────────────

  const loadVaultKeys = useCallback(async () => {
    setVaultLoading(true);
    try {
      const res = await fetch(`${API_BASE}/settings/vault/registry`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        setVaultKeys(data.keys || []);
      }
    } catch {
      // API not available
    } finally {
      setVaultLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSection === "security") {
      loadVaultKeys();
    }
  }, [activeSection, loadVaultKeys]);

  const handleSaveVaultKey = async (keyId: string) => {
    const value = keyInputs[keyId]?.trim();
    if (!value) return;

    setSavingKey(keyId);
    try {
      const res = await fetch(`${API_BASE}/settings/vault/${keyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error);
      }
      toast.success(`Key saved (encrypted)`);
      setSavedKeys((prev) => new Set([...prev, keyId]));
      setKeyInputs((prev) => ({ ...prev, [keyId]: "" }));
      setExpandedKey(null);
      setTimeout(() => setSavedKeys((prev) => { const n = new Set(prev); n.delete(keyId); return n; }), 3000);
      loadVaultKeys();
    } catch (err) {
      toast.error(`Failed to save: ${(err as Error).message}`);
    } finally {
      setSavingKey(null);
    }
  };

  const handleDeleteVaultKey = async (keyId: string) => {
    try {
      const res = await fetch(`${API_BASE}/settings/vault/${keyId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Key removed");
      loadVaultKeys();
    } catch {
      toast.error("Failed to remove key");
    }
  };

  const handleAddCustomKey = async () => {
    const id = customKeyName.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!id) return;
    setAddingCustom(false);
    setCustomKeyName("");
    setExpandedKey(id);
  };

  const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
    ai: { label: "AI Providers", icon: "🧠" },
    media: { label: "Media & Voice", icon: "🎬" },
    communication: { label: "Communication", icon: "💬" },
    search: { label: "Search & Data", icon: "🔍" },
    business: { label: "Business & Productivity", icon: "💼" },
    development: { label: "Development & DevOps", icon: "🛠️" },
    infrastructure: { label: "Infrastructure", icon: "⚙️" },
    custom: { label: "Custom Keys", icon: "🔧" },
  };

  const sections: { id: SettingsSection; label: string; icon: string }[] = [
    { id: "communication", label: "Communication", icon: "💬" },
    { id: "agent", label: "Agent", icon: "🤖" },
    { id: "knowledge", label: "Knowledge", icon: "📚" },
    { id: "system", label: "System", icon: "💻" },
    { id: "security", label: "Security", icon: "🔒" },
    { id: "advanced", label: "Advanced", icon: "⚡" },
  ];

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-5xl mx-auto p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-white">Settings</h1>
          <p className="text-sm text-slate-500">Configure your Sovereign Stack</p>
        </div>

        {/* Section tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-slate-800 pb-3 overflow-x-auto">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap ${
                activeSection === section.id
                  ? "bg-slate-800 text-white"
                  : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
              }`}
            >
              <span>{section.icon}</span>
              <span>{section.label}</span>
            </button>
          ))}
        </div>

        {/* Section content */}
        <div className="space-y-6">
          {/* COMMUNICATION */}
          {activeSection === "communication" && (
            <div className="space-y-6 animate-fadeIn">
              {/* WhatsApp */}
              <Section title="WhatsApp" icon="📱" description="Connect via QR code scan">
                <WhatsAppConnect />
              </Section>

              {/* Slack */}
              <Section title="Slack Integration" icon="💬" description="Connect your Slack workspace">
                <SlackWizard
                  onComplete={() => toast.success("Slack connected!")}
                  embedded={false}
                />
              </Section>
            </div>
          )}

          {/* AGENT */}
          {activeSection === "agent" && (
            <div className="space-y-6 animate-fadeIn">
              <Section title="Agent Personalization" icon="🤖" description="Name and avatar for your agent">
                <AgentNaming />
              </Section>

              <Section title="Model Configuration" icon="🧠" description="Choose AI models and budget tier">
                <ModelConfiguration />
              </Section>

              <Section title="Compound Learning" icon="📚" description="Knowledge capture and memory">
                <CompoundCapture />
              </Section>
            </div>
          )}

          {/* KNOWLEDGE */}
          {activeSection === "knowledge" && (
            <div className="space-y-6 animate-fadeIn">
              <Section title="Knowledge Base" icon="📚" description="RAG-powered document search via AnythingLLM">
                <KnowledgeBase />
              </Section>
            </div>
          )}

          {/* SYSTEM */}
          {activeSection === "system" && (
            <div className="space-y-6 animate-fadeIn">
              <Section title="System Capacity" icon="📊" description="Hardware profile and project limits">
                <CapacityIndicator />
              </Section>

              <Section title="System Health" icon="🏥" description="Service health checks">
                <HealthCheck autoRun={false} />
              </Section>

              {/* System Information */}
              <Section title="System Information" icon="💻" description="Host machine details">
                {systemInfo ? (
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: "macOS Version", value: systemInfo.macos_version },
                      { label: "Architecture", value: systemInfo.architecture },
                      { label: "Hostname", value: systemInfo.hostname },
                      { label: "Current User", value: systemInfo.current_user },
                    ].map((item) => (
                      <div key={item.label}>
                        <div className="text-xs text-slate-500">{item.label}</div>
                        <div className="text-sm font-semibold text-white">{item.value}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Loading...</p>
                )}
              </Section>

              {/* Service Ports */}
              <Section title="Service Ports" icon="🔌" description="Port assignments for each service">
                <div className="space-y-2">
                  {[
                    { name: "LiteLLM", port: 4000 },
                    { name: "Ollama", port: 11434 },
                    { name: "memU", port: 8090 },
                    { name: "PostgreSQL", port: 5432 },
                    { name: "Temporal", port: 7233, soon: true },
                    { name: "Redis", port: 6379 },
                    { name: "AnythingLLM", port: 3001 },
                  ].map((svc) => (
                    <div
                      key={svc.name}
                      className="flex justify-between items-center py-1.5 border-b border-slate-800 last:border-0"
                    >
                      <span className="text-sm text-slate-300 flex items-center gap-2">
                        {svc.name}
                        {"soon" in svc && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-900/30 text-amber-400 border border-amber-800/50">
                            Coming Soon
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-slate-500 font-mono">
                        :{svc.port}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          )}

          {/* SECURITY */}
          {activeSection === "security" && (
            <div className="space-y-6 animate-fadeIn">
              <Section title="Network Isolation" icon="🌐" description="Control network access for containers">
                <NetworkIsolationSelector />
              </Section>

              <Section title="Autonomy Settings" icon="🛡️" description="What the agent can do autonomously">
                <AutonomySettings />
              </Section>

              {/* Key Vault */}
              <Section title="Key Vault" icon="🔐" description="Encrypted API key storage — agents can access these at runtime">
                {vaultLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <span className="w-4 h-4 border-2 border-slate-600 border-t-blue-400 rounded-full animate-spin" />
                    Loading key vault...
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Summary bar */}
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-green-400" />
                        {vaultKeys.filter((k) => k.configured).length} configured
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-slate-600" />
                        {vaultKeys.filter((k) => !k.configured).length} empty
                      </span>
                      <span className="text-slate-700">|</span>
                      <span>AES-256-GCM encrypted at rest</span>
                    </div>

                    {/* Keys grouped by category */}
                    {Object.entries(CATEGORY_LABELS).map(([cat, meta]) => {
                      const keys = vaultKeys.filter((k) => k.category === cat);
                      if (keys.length === 0) return null;
                      return (
                        <div key={cat}>
                          <div className="text-xs uppercase tracking-wider text-slate-600 font-medium mb-2 flex items-center gap-1.5">
                            <span>{meta.icon}</span> {meta.label}
                          </div>
                          <div className="space-y-1">
                            {keys.map((k) => (
                              <div key={k.id} className="rounded-lg border border-slate-700/50 overflow-hidden">
                                <button
                                  onClick={() => setExpandedKey(expandedKey === k.id ? null : k.id)}
                                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-800/50 transition-colors"
                                >
                                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${k.configured ? "bg-green-400" : "bg-slate-700"}`} />
                                  <div className="flex-1 text-left min-w-0">
                                    <div className="text-sm text-slate-300 font-medium truncate">{k.name}</div>
                                    <div className="text-[10px] text-slate-600 truncate">{k.description}</div>
                                  </div>
                                  {k.configured && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-900/30 text-green-400 border border-green-800/50 flex-shrink-0">
                                      configured
                                    </span>
                                  )}
                                  <svg className={`w-3.5 h-3.5 text-slate-600 transition-transform ${expandedKey === k.id ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                                  </svg>
                                </button>

                                {expandedKey === k.id && (
                                  <div className="px-3 pb-3 pt-1 bg-slate-800/30 border-t border-slate-700/30">
                                    <div className="text-[10px] text-slate-600 mb-1.5 font-mono">{k.envVar}</div>
                                    <div className="flex gap-2">
                                      <input
                                        type="password"
                                        value={keyInputs[k.id] || ""}
                                        onChange={(e) => setKeyInputs((prev) => ({ ...prev, [k.id]: e.target.value }))}
                                        onKeyDown={(e) => { if (e.key === "Enter") handleSaveVaultKey(k.id); }}
                                        placeholder={k.configured ? "••••••••  (enter new value to replace)" : k.placeholder || "Enter key..."}
                                        className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-600 transition-colors"
                                      />
                                      <button
                                        onClick={() => handleSaveVaultKey(k.id)}
                                        disabled={!keyInputs[k.id]?.trim() || savingKey === k.id}
                                        className={`px-3 py-1.5 rounded text-sm font-medium transition-all ${
                                          keyInputs[k.id]?.trim() && savingKey !== k.id
                                            ? "bg-blue-600 hover:bg-blue-500 text-white"
                                            : "bg-slate-800 text-slate-600 cursor-not-allowed"
                                        }`}
                                      >
                                        {savingKey === k.id ? "..." : savedKeys.has(k.id) ? "✓" : "Save"}
                                      </button>
                                      {k.configured && (
                                        <button
                                          onClick={() => handleDeleteVaultKey(k.id)}
                                          className="px-2 py-1.5 rounded text-sm text-red-400 hover:bg-red-900/30 transition-colors"
                                          title="Remove key"
                                        >
                                          ✕
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}

                    {/* Add Custom Key */}
                    <div className="pt-2 border-t border-slate-800">
                      {addingCustom ? (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={customKeyName}
                            onChange={(e) => setCustomKeyName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleAddCustomKey(); if (e.key === "Escape") setAddingCustom(false); }}
                            placeholder="custom_service_name"
                            autoFocus
                            className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-600 font-mono"
                          />
                          <button
                            onClick={handleAddCustomKey}
                            disabled={!customKeyName.trim()}
                            className="px-3 py-1.5 rounded text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:bg-slate-800 disabled:text-slate-600 transition-all"
                          >
                            Add
                          </button>
                          <button
                            onClick={() => { setAddingCustom(false); setCustomKeyName(""); }}
                            className="px-2 py-1.5 rounded text-sm text-slate-500 hover:text-slate-300"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setAddingCustom(true)}
                          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          + Add custom key
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </Section>
            </div>
          )}

          {/* ADVANCED */}
          {activeSection === "advanced" && (
            <div className="space-y-6 animate-fadeIn">
              <Section title="Cost & Usage" icon="💰" description="Track spending across model tiers">
                <CostTracker />
              </Section>

              <Section title="Backup & Export" icon="💾" description="Export configuration and data">
                <BackupExport />
              </Section>

              {/* Restart Onboarding */}
              <Section title="Setup Wizard" icon="🧙" description="Re-run the initial setup experience">
                <div className="space-y-3">
                  <p className="text-sm text-slate-400">
                    Restart the onboarding wizard to reconfigure Docker, API keys, or messaging channels.
                  </p>
                  <button
                    onClick={() => {
                      localSet("onboarding_complete", false);
                      localSet("stack_configured", false);
                      toast.success("Opening setup wizard...");
                      window.dispatchEvent(new Event("restart-onboarding"));
                    }}
                    className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-semibold text-white transition-all duration-200 active:scale-95"
                  >
                    Restart Onboarding
                  </button>
                </div>
              </Section>

              {/* About */}
              <Section title="About" icon="ℹ️" description="Application details">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">App Version</span>
                    <span className="text-white font-medium">0.4.0</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tauri Version</span>
                    <span className="text-white font-medium">2.0</span>
                  </div>
                  <div className="pt-3 text-xs text-slate-600">
                    Sovereign Stack — Your personal AI infrastructure, on your machine.
                  </div>
                </div>
              </Section>

              {/* LiteLLM Tier Reference — moved from Model Configuration */}
              <Section title="LiteLLM 9-Tier System" icon="📊" description="Model routing tiers across 3 providers">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  {[
                    { name: 'heavy', model: 'Opus 4.6', desc: 'Architecture, strategy', color: 'text-purple-400' },
                    { name: 'coder', model: 'Sonnet 4.5', desc: 'Code generation', color: 'text-blue-400' },
                    { name: 'medium', model: 'Sonnet 4.5', desc: 'Research, review', color: 'text-blue-400' },
                    { name: 'light', model: 'Haiku 4.5', desc: 'Quick tasks', color: 'text-green-400' },
                    { name: 'trivial', model: 'Haiku', desc: 'Simple formatting', color: 'text-green-400' },
                    { name: 'codex', model: 'GPT-5.2', desc: 'Complex code', color: 'text-orange-400' },
                    { name: 'crosscheck', model: 'GPT-5.2', desc: 'Alt perspectives', color: 'text-orange-400' },
                    { name: 'critic', model: 'GPT-5.2', desc: 'Security review', color: 'text-red-400' },
                    { name: 'creative', model: 'Gemini 3.1', desc: 'Visual design', color: 'text-pink-400' },
                  ].map((tier) => (
                    <div key={tier.name} className="bg-slate-900 p-3 rounded">
                      <div className={`font-medium ${tier.color} mb-1`}>{tier.name}</div>
                      <p className="text-xs text-slate-400">{tier.model} — {tier.desc}</p>
                    </div>
                  ))}
                </div>
              </Section>

              {/* Agent Lane Reference — moved from Model Configuration */}
              <Section title="Agent Lanes" icon="📚" description="7 specialized lanes for different task types">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  {[
                    { icon: '🏗️', name: 'Architect', desc: 'System design, architecture decisions, critical planning' },
                    { icon: '👨‍💻', name: 'Engineer', desc: 'Feature implementation, bug fixes, code generation' },
                    { icon: '⚡', name: 'Copilot', desc: 'Quick iterations, formatting, simple edits, autocomplete' },
                    { icon: '🎯', name: 'Planning', desc: 'Strategy, product decisions, project planning' },
                    { icon: '🎨', name: 'Visual', desc: 'UI/UX design, screenshot analysis, motion graphics' },
                    { icon: '🛡️', name: 'Safety', desc: 'Security review, red-teaming, quality assurance' },
                  ].map((lane) => (
                    <div key={lane.name}>
                      <div className="font-medium text-slate-200 mb-1">{lane.icon} {lane.name}</div>
                      <p className="text-xs text-slate-400">{lane.desc}</p>
                    </div>
                  ))}
                  <div className="md:col-span-2">
                    <div className="font-medium text-slate-200 mb-1 flex items-center space-x-2">
                      <span>🧠 Compound</span>
                      <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full">NEW</span>
                    </div>
                    <p className="text-xs text-slate-400">Post-task knowledge capture, learning from mistakes, preventing repeated failures. Runs 5 sub-agents to analyze problems, find root causes, document solutions, and build institutional knowledge.</p>
                  </div>
                </div>
              </Section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Reusable section wrapper
function Section({
  title,
  icon,
  description,
  children,
}: {
  title: string;
  icon: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-6">
      <div className="mb-4">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span>{icon}</span>
          <span>{title}</span>
        </h2>
        {description && (
          <p className="text-xs text-slate-500 mt-1 ml-7">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}
