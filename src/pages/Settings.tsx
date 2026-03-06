import { useState, useEffect } from "react";
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
import toast from "react-hot-toast";

interface SystemInfo {
  macos_version: string;
  architecture: string;
  hostname: string;
  current_user: string;
}

type SettingsSection =
  | "communication"
  | "agent"
  | "system"
  | "security"
  | "advanced";

export default function Settings() {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [anthropicKey, setAnthropicKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>("communication");

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

  const handleSaveApiKey = async () => {
    try {
      await safeInvoke("save_api_key", { key: anthropicKey });
    } catch (err) {
      toast.error("Failed to save API key — Tauri backend not available");
      return;
    }
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 3000);
  };

  const sections: { id: SettingsSection; label: string; icon: string }[] = [
    { id: "communication", label: "Communication", icon: "💬" },
    { id: "agent", label: "Agent", icon: "🤖" },
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

              {/* API Keys */}
              <Section title="API Keys" icon="🔑" description="Manage service credentials">
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-slate-300">
                    Anthropic API Key
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={anthropicKey}
                      onChange={(e) => setAnthropicKey(e.target.value)}
                      placeholder="sk-ant-..."
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all duration-200"
                    />
                    <button
                      onClick={handleSaveApiKey}
                      className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold text-white transition-all duration-200 active:scale-95"
                    >
                      {keySaved ? "✓ Saved" : "💾 Save"}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">
                    Stored locally in Keychain. Used by LiteLLM for Claude access.
                  </p>
                </div>
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
