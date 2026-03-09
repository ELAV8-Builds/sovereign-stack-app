/**
 * BuildPhase — Phase 3: scaffold + install dependencies (terminal-style output)
 */
import { SpinnerIcon } from "./Icons";
import type { BuildPhaseProps } from "./types";

export function BuildPhase({
  projectName,
  selectedTemplate,
  buildLogs,
  building,
  buildLogRef,
  handleBuild,
}: BuildPhaseProps) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white mb-1">Scaffolding</h2>
        <p className="text-sm text-slate-400">
          Creating <span className="text-indigo-400 font-mono">{projectName || "project"}</span> from{" "}
          <span className="text-indigo-400">{selectedTemplate}</span> template.
        </p>
      </div>

      {/* Terminal output */}
      <div
        ref={buildLogRef}
        className="bg-black/50 border border-white/[0.06] rounded-xl p-4 h-64 overflow-y-auto font-mono text-xs"
      >
        {buildLogs.length === 0 ? (
          <span className="text-slate-600">Press "Start Build" to begin scaffolding...</span>
        ) : (
          buildLogs.map((line, i) => (
            <div
              key={i}
              className={`${
                line.startsWith("[error]")
                  ? "text-red-400"
                  : line.includes("\u2713")
                  ? "text-emerald-400"
                  : line.includes("\u2717")
                  ? "text-red-400"
                  : "text-slate-300"
              }`}
            >
              {line}
            </div>
          ))
        )}
        {building && (
          <div className="flex items-center gap-2 text-indigo-400 mt-1">
            <SpinnerIcon /> Working...
          </div>
        )}
      </div>

      {!building && buildLogs.length === 0 && (
        <button
          onClick={handleBuild}
          className="px-5 py-2.5 bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Start Build
        </button>
      )}
    </div>
  );
}
