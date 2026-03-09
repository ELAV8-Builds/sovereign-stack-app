/**
 * NavigationFooter — bottom navigation bar with Back/Next/action buttons
 */
import type { NavigationFooterProps } from "./types";

export function NavigationFooter({
  phase,
  phaseIndex,
  totalPhases,
  canAdvance,
  building,
  validating,
  deploying,
  buildLogs,
  buildReport,
  deployResult,
  goBack,
  goNext,
  handleBuild,
  handleValidate,
  handleDeploy,
}: NavigationFooterProps) {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-white/[0.06] flex-shrink-0">
      <button
        onClick={goBack}
        disabled={phaseIndex === 0}
        className="px-4 py-2 text-sm text-slate-400 hover:text-white disabled:text-slate-700 disabled:cursor-not-allowed transition-colors"
      >
        &larr; Back
      </button>

      <span className="text-xs text-slate-600">
        Step {phaseIndex + 1} of {totalPhases}
      </span>

      {phase === "deploy" ? (
        !deployResult?.success && (
          <button
            onClick={handleDeploy}
            disabled={deploying}
            className="px-5 py-2 bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-500/50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {deploying ? "Deploying..." : "Deploy"}
          </button>
        )
      ) : phase === "build" && buildLogs.length === 0 ? (
        <button
          onClick={handleBuild}
          disabled={building}
          className="px-5 py-2 bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-500/50 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {building ? "Building..." : "Start Build"}
        </button>
      ) : phase === "validate" && !buildReport ? (
        <button
          onClick={handleValidate}
          disabled={validating}
          className="px-5 py-2 bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-500/50 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {validating ? "Validating..." : "Validate"}
        </button>
      ) : (
        <button
          onClick={goNext}
          disabled={!canAdvance}
          className="px-5 py-2 bg-indigo-500 hover:bg-indigo-400 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
        >
          Next &rarr;
        </button>
      )}
    </div>
  );
}
