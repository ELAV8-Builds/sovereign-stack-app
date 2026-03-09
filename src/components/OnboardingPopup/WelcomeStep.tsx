import type { DockerStatus, OnboardingStep } from "./types";

interface WelcomeStepProps {
  dockerStatus: DockerStatus | null;
  stackHealthy: boolean;
  onNext: () => void;
  setStep: (step: OnboardingStep) => void;
}

export function WelcomeStep({
  dockerStatus,
  stackHealthy,
  onNext,
  setStep,
}: WelcomeStepProps) {
  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="text-center space-y-2">
        <div className="text-4xl mb-3">👋</div>
        <h2 className="text-2xl font-bold text-white">
          Welcome to Sovereign Stack
        </h2>
        <p className="text-slate-400 text-sm">
          Your personal AI infrastructure. Let's get everything running.
        </p>
      </div>

      {/* What you're about to get */}
      <div className="space-y-2.5">
        {[
          { icon: "🧠", text: "9 AI model tiers (Haiku to Opus)" },
          { icon: "🔒", text: "You own the infrastructure — AI runs through your keys" },
          { icon: "📱", text: "WhatsApp & Slack integration" },
          { icon: "💻", text: "Code workspace with git" },
        ].map((item) => (
          <div
            key={item.text}
            className="flex items-center gap-3 bg-slate-800/50 rounded-lg px-4 py-2.5 border border-slate-700/50"
          >
            <span className="text-lg">{item.icon}</span>
            <span className="text-sm text-slate-300">{item.text}</span>
          </div>
        ))}
      </div>

      {/* Docker status indicator */}
      {dockerStatus && (
        <div
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm ${
            dockerStatus.docker_running
              ? "bg-green-900/20 border border-green-800/50 text-green-400"
              : "bg-amber-900/20 border border-amber-800/50 text-amber-400"
          }`}
        >
          <span>
            {dockerStatus.docker_running ? "✓" : "⚠"}
          </span>
          <span>
            {stackHealthy
              ? "Docker is running — stack is healthy ✓"
              : dockerStatus.docker_running
              ? "Docker is running — ready to set up"
              : dockerStatus.docker_installed
              ? "Docker is installed but not running"
              : "Docker Desktop required"}
          </span>
        </div>
      )}

      <div className="flex gap-3">
        {/* Skip ahead button when stack is already healthy */}
        {stackHealthy && (
          <button
            onClick={() => setStep("channels")}
            className="px-4 py-2.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            Skip to Channels &rarr;
          </button>
        )}
        <button
          onClick={onNext}
          className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-xl text-white font-semibold transition-all duration-200 shadow-lg shadow-blue-600/20 active:scale-[0.98]"
        >
          {stackHealthy ? "Reconfigure" : "Get Started"}
        </button>
      </div>
    </div>
  );
}
