import { SetupProgress } from "../SetupProgress";
import type { OnboardingStep } from "./types";

interface LaunchingStepProps {
  launchLog: string[];
  launchError: string | null;
  isLaunching: boolean;
  servicesStarted: boolean;
  onRetry: () => void;
  onAllServicesReady: () => void;
  setStep: (step: OnboardingStep) => void;
}

export function LaunchingStep({
  launchLog,
  launchError,
  isLaunching,
  servicesStarted,
  onRetry,
  onAllServicesReady,
  setStep,
}: LaunchingStepProps) {
  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Terminal-style log */}
      {!servicesStarted && (
        <>
          <div className="text-center space-y-1 mb-2">
            <div className="text-4xl mb-2">
              <span className="inline-block animate-bounce">
                {launchError ? "😅" : "🚀"}
              </span>
            </div>
            <h2 className="text-xl font-bold text-white">
              {launchError
                ? "Oops — something went wrong"
                : "Setting Up Your Stack"}
            </h2>
          </div>

          <div className="bg-slate-950 rounded-lg p-4 border border-slate-800 font-mono text-xs max-h-48 overflow-y-auto scrollbar-thin">
            {launchLog.map((line, i) => (
              <div
                key={i}
                className={`py-0.5 animate-terminalFadeIn ${
                  line.startsWith("Error:")
                    ? "text-red-400"
                    : line.startsWith("Warning:")
                    ? "text-amber-400"
                    : line.startsWith("Done:")
                    ? "text-green-400"
                    : line.startsWith("Note:")
                    ? "text-slate-500"
                    : "text-slate-400"
                }`}
              >
                <span className="text-blue-500 mr-2">$</span>
                {line}
              </div>
            ))}
            {isLaunching && (
              <div className="py-0.5 text-slate-500">
                <span className="text-blue-500 mr-2">$</span>
                <span className="animate-pulse">|</span>
              </div>
            )}
          </div>

          {/* Always show back button (and retry on error) */}
          <div className="flex gap-3">
            <button
              onClick={() => setStep("api_key")}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
            >
              &larr; Back
            </button>
            {launchError && (
              <button
                onClick={onRetry}
                className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-semibold text-sm transition-all active:scale-[0.98]"
              >
                Retry
              </button>
            )}
          </div>
        </>
      )}

      {/* Service health monitoring */}
      {servicesStarted && (
        <>
          <SetupProgress
            isActive={true}
            onAllReady={onAllServicesReady}
          />
          <button
            onClick={() => setStep("api_key")}
            className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
          >
            &larr; Back to API Keys
          </button>
        </>
      )}
    </div>
  );
}
