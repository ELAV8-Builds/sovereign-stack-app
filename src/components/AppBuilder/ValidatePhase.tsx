/**
 * ValidatePhase — Phase 4: run build-validator, show step-by-step pass/fail
 */
import { CheckIcon, XIcon, SpinnerIcon } from "./Icons";
import type { ValidatePhaseProps } from "./types";

export function ValidatePhase({ buildReport, validating, handleValidate }: ValidatePhaseProps) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white mb-1">Build Validation</h2>
        <p className="text-sm text-slate-400">Running quality checks on your project.</p>
      </div>

      {!buildReport && !validating && (
        <button
          onClick={handleValidate}
          className="px-5 py-2.5 bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Run Validation
        </button>
      )}

      {validating && (
        <div className="flex items-center gap-3 text-sm text-indigo-300">
          <SpinnerIcon /> Running validation checks...
        </div>
      )}

      {buildReport && (
        <div className="space-y-3">
          {/* Overall status */}
          <div
            className={`flex items-center gap-2 px-4 py-3 rounded-xl border ${
              buildReport.status === "passing"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : buildReport.status === "warning"
                ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                : "bg-red-500/10 border-red-500/30 text-red-300"
            }`}
          >
            {buildReport.status === "passing" ? <CheckIcon /> : buildReport.status === "warning" ? "\u26A0\uFE0F" : <XIcon />}
            <span className="text-sm font-medium capitalize">{buildReport.status}</span>
            <span className="text-xs opacity-60 ml-auto">Tier: {buildReport.tier}</span>
          </div>

          {/* Step-by-step results */}
          <div className="space-y-2">
            {buildReport.steps.map((step, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 px-4 py-2.5 rounded-lg border ${
                  step.status === "pass"
                    ? "bg-emerald-500/5 border-emerald-500/20"
                    : step.status === "fail"
                    ? "bg-red-500/5 border-red-500/20"
                    : "bg-white/[0.02] border-white/[0.06]"
                }`}
              >
                <span className="mt-0.5">
                  {step.status === "pass" ? (
                    <span className="text-emerald-400"><CheckIcon /></span>
                  ) : step.status === "fail" ? (
                    <span className="text-red-400"><XIcon /></span>
                  ) : step.status === "running" ? (
                    <span className="text-indigo-400"><SpinnerIcon /></span>
                  ) : (
                    <span className="text-slate-600">&mdash;</span>
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white font-medium">{step.name}</div>
                  {step.output && (
                    <pre className="text-xs text-slate-400 mt-1 whitespace-pre-wrap break-words max-h-20 overflow-y-auto">
                      {step.output}
                    </pre>
                  )}
                </div>
                <span className="text-[10px] text-slate-600 font-mono whitespace-nowrap">
                  {step.duration_ms}ms
                </span>
              </div>
            ))}
          </div>

          {/* Re-run button */}
          {buildReport.status === "failing" && (
            <button
              onClick={handleValidate}
              className="px-4 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 rounded-lg text-xs font-medium transition-colors"
            >
              Re-run Validation
            </button>
          )}
        </div>
      )}
    </div>
  );
}
