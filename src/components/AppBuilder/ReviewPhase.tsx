/**
 * ReviewPhase — Phase 5: summary card with project metadata
 */
import type { ReviewPhaseProps } from "./types";

export function ReviewPhase({ workspace, buildReport, description }: ReviewPhaseProps) {
  if (!workspace) return null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white mb-1">Project Summary</h2>
        <p className="text-sm text-slate-400">Review your project before deployment.</p>
      </div>

      <div className="bg-slate-900/50 border border-white/[0.06] rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Name</span>
            <div className="text-sm text-white font-medium mt-0.5">{workspace.name}</div>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Template</span>
            <div className="text-sm text-white font-medium mt-0.5">{workspace.template}</div>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Status</span>
            <div className="text-sm mt-0.5">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                workspace.status === "ready"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : workspace.status === "deployed"
                  ? "bg-blue-500/15 text-blue-400"
                  : "bg-slate-700/50 text-slate-400"
              }`}>
                {workspace.status}
              </span>
            </div>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Validation</span>
            <div className="text-sm mt-0.5">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                buildReport?.status === "passing"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : buildReport?.status === "warning"
                  ? "bg-amber-500/15 text-amber-400"
                  : "bg-slate-700/50 text-slate-400"
              }`}>
                {buildReport?.status || "not run"}
              </span>
            </div>
          </div>
        </div>
        {description && (
          <div>
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Description</span>
            <div className="text-sm text-slate-300 mt-0.5">{description}</div>
          </div>
        )}
        <div>
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Path</span>
          <div className="text-xs text-slate-500 font-mono mt-0.5">{workspace.path}</div>
        </div>
      </div>
    </div>
  );
}
