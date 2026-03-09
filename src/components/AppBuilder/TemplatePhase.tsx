/**
 * TemplatePhase — Phase 2: pick a starter template + name the project
 */
import { SpinnerIcon } from "./Icons";
import type { TemplatePhaseProps } from "./types";

export function TemplatePhase({
  projectName,
  setProjectName,
  templates,
  selectedTemplate,
  setSelectedTemplate,
  loadingTemplates,
}: TemplatePhaseProps) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white mb-1">Choose a template</h2>
        <p className="text-sm text-slate-400">Pick a starter template and name your project.</p>
      </div>

      {/* Project name */}
      <div>
        <label className="block text-xs text-slate-400 mb-1.5">Project Name</label>
        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="my-awesome-app"
          className="w-full bg-slate-900/50 border border-white/[0.06] rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
        />
      </div>

      {/* Template grid */}
      {loadingTemplates ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <SpinnerIcon /> Loading templates...
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedTemplate(t.id)}
              className={`text-left p-4 rounded-xl border transition-all ${
                selectedTemplate === t.id
                  ? "bg-indigo-500/10 border-indigo-500/40 ring-1 ring-indigo-500/20"
                  : "bg-slate-900/50 border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.04]"
              }`}
            >
              <div className="text-lg mb-1">{t.icon}</div>
              <div className="text-sm font-medium text-white">{t.name}</div>
              <div className="text-xs text-slate-500 mt-0.5">{t.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
