import type { OnboardingStep } from "./types";

interface DockerStepProps {
  onRetry: () => void;
  setStep: (step: OnboardingStep) => void;
}

export function DockerStep({ onRetry, setStep }: DockerStepProps) {
  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="text-center space-y-2">
        <div className="text-4xl mb-3">🐳</div>
        <h2 className="text-xl font-bold text-white">
          Docker Desktop Required
        </h2>
        <p className="text-slate-400 text-sm">
          Sovereign Stack runs in Docker containers for security and portability.
        </p>
      </div>

      <div className="space-y-3">
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
          <h3 className="text-sm font-semibold text-white mb-3">
            Quick Setup (2 minutes):
          </h3>
          <ol className="space-y-2.5 text-sm text-slate-300">
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 bg-blue-600 rounded-full text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                1
              </span>
              <span>
                Download{" "}
                <a
                  href="https://www.docker.com/products/docker-desktop"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
                >
                  Docker Desktop
                </a>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 bg-blue-600 rounded-full text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                2
              </span>
              <span>Install and open Docker Desktop</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 bg-blue-600 rounded-full text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                3
              </span>
              <span>Wait for the whale icon to stop animating</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 bg-blue-600 rounded-full text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                4
              </span>
              <span>Come back here and click "Check Again"</span>
            </li>
          </ol>
        </div>

        {/* System requirements */}
        <div className="bg-slate-800/30 rounded-lg px-4 py-3 border border-slate-700/30">
          <p className="text-xs text-slate-500">
            Requirements: macOS 13+, 8GB RAM, 10GB free disk space
          </p>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => setStep("welcome")}
          className="px-4 py-2.5 text-sm text-slate-400 hover:text-white transition-colors"
        >
          &larr; Back
        </button>
        <button
          onClick={onRetry}
          className="flex-1 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-semibold transition-all active:scale-[0.98] text-sm"
        >
          Check Again
        </button>
      </div>
    </div>
  );
}
