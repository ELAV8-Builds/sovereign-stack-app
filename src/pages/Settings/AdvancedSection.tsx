import toast from "react-hot-toast";
import { localSet } from "@/lib/tauri";
import { CostTracker } from "../../components/CostTracker";
import { BackupExport } from "../../components/BackupExport";
import { Section } from "./Section";

export function AdvancedSection() {
  return (
    <div className="space-y-6 animate-fadeIn">
      <Section title="Cost & Usage" icon="\u{1F4B0}" description="Track spending across model tiers">
        <CostTracker />
      </Section>

      <Section title="Backup & Export" icon="\u{1F4BE}" description="Export configuration and data">
        <BackupExport />
      </Section>

      {/* Restart Onboarding */}
      <Section title="Setup Wizard" icon="\u{1F9D9}" description="Re-run the initial setup experience">
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
      <Section title="About" icon="\u2139\u{FE0F}" description="Application details">
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

      {/* LiteLLM Tier Reference */}
      <Section title="LiteLLM 9-Tier System" icon="\u{1F4CA}" description="Model routing tiers across 3 providers">
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

      {/* Agent Lane Reference */}
      <Section title="Agent Lanes" icon="\u{1F4DA}" description="7 specialized lanes for different task types">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {[
            { icon: '\u{1F3D7}\u{FE0F}', name: 'Architect', desc: 'System design, architecture decisions, critical planning' },
            { icon: '\u{1F468}\u200D\u{1F4BB}', name: 'Engineer', desc: 'Feature implementation, bug fixes, code generation' },
            { icon: '\u26A1', name: 'Copilot', desc: 'Quick iterations, formatting, simple edits, autocomplete' },
            { icon: '\u{1F3AF}', name: 'Planning', desc: 'Strategy, product decisions, project planning' },
            { icon: '\u{1F3A8}', name: 'Visual', desc: 'UI/UX design, screenshot analysis, motion graphics' },
            { icon: '\u{1F6E1}\u{FE0F}', name: 'Safety', desc: 'Security review, red-teaming, quality assurance' },
          ].map((lane) => (
            <div key={lane.name}>
              <div className="font-medium text-slate-200 mb-1">{lane.icon} {lane.name}</div>
              <p className="text-xs text-slate-400">{lane.desc}</p>
            </div>
          ))}
          <div className="md:col-span-2">
            <div className="font-medium text-slate-200 mb-1 flex items-center space-x-2">
              <span>{"\u{1F9E0}"} Compound</span>
              <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full">NEW</span>
            </div>
            <p className="text-xs text-slate-400">Post-task knowledge capture, learning from mistakes, preventing repeated failures. Runs 5 sub-agents to analyze problems, find root causes, document solutions, and build institutional knowledge.</p>
          </div>
        </div>
      </Section>
    </div>
  );
}
