/**
 * PhaseStepper — horizontal step indicator at the top of the wizard
 */
import { CheckIcon } from "./Icons";
import type { PhaseStepperProps } from "./types";

export function PhaseStepper({ phases, currentPhase, completedPhases, phaseIndex, setPhase }: PhaseStepperProps) {
  return (
    <div className="flex items-center justify-center gap-1 px-4 py-3 border-b border-white/[0.06] flex-shrink-0">
      {phases.map((p, i) => {
        const isDone = completedPhases.has(p.id);
        const isActive = p.id === currentPhase;
        const isPast = i < phaseIndex;

        return (
          <div key={p.id} className="flex items-center">
            {i > 0 && (
              <div className={`w-8 h-px mx-1 ${isPast || isDone ? "bg-indigo-500/60" : "bg-white/[0.06]"}`} />
            )}
            <button
              onClick={() => {
                // Only allow clicking completed or current phases
                if (isDone || isActive || isPast) setPhase(p.id);
              }}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? "bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30"
                  : isDone || isPast
                  ? "text-emerald-400/80 hover:bg-white/[0.04] cursor-pointer"
                  : "text-slate-600 cursor-default"
              }`}
            >
              <span
                className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                  isDone || isPast
                    ? "bg-emerald-500/20 text-emerald-400"
                    : isActive
                    ? "bg-indigo-500/30 text-indigo-300"
                    : "bg-white/[0.04] text-slate-600"
                }`}
              >
                {isDone || isPast ? <CheckIcon /> : p.num}
              </span>
              <span className="hidden md:inline">{p.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
