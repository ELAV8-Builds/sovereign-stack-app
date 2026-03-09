import type { OnboardingStep } from "./types";

interface ChannelsStepProps {
  selectedChannel: "whatsapp" | "slack" | null;
  onChannelSelect: (channel: "whatsapp" | "slack") => void;
  onFinish: () => void;
  setStep: (step: OnboardingStep) => void;
}

export function ChannelsStep({
  selectedChannel,
  onChannelSelect,
  onFinish,
  setStep,
}: ChannelsStepProps) {
  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="text-center space-y-2">
        <div className="text-4xl mb-3">🎉</div>
        <h2 className="text-xl font-bold text-white">
          Your AI is Running!
        </h2>
        <p className="text-slate-400 text-sm">
          Want to connect a messaging channel? (Optional)
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* WhatsApp */}
        <button
          onClick={() => onChannelSelect("whatsapp")}
          className={`p-4 rounded-xl border transition-all duration-200 text-left ${
            selectedChannel === "whatsapp"
              ? "border-green-600 bg-green-900/20"
              : "border-slate-700 bg-slate-800/50 hover:border-slate-600 hover:bg-slate-800"
          }`}
        >
          <div className="text-2xl mb-2">📱</div>
          <div className="font-semibold text-sm text-white">
            WhatsApp
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Scan QR &bull; 30 seconds
          </div>
        </button>

        {/* Slack */}
        <button
          onClick={() => onChannelSelect("slack")}
          className={`p-4 rounded-xl border transition-all duration-200 text-left ${
            selectedChannel === "slack"
              ? "border-purple-600 bg-purple-900/20"
              : "border-slate-700 bg-slate-800/50 hover:border-slate-600 hover:bg-slate-800"
          }`}
        >
          <div className="text-2xl mb-2">💬</div>
          <div className="font-semibold text-sm text-white">
            Slack
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Paste token &bull; 2 minutes
          </div>
        </button>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => setStep("welcome")}
          className="px-4 py-2.5 text-sm text-slate-400 hover:text-white transition-colors"
        >
          &larr; Back
        </button>
        <button
          onClick={onFinish}
          className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-xl text-white font-semibold transition-all duration-200 shadow-lg shadow-blue-600/20 active:scale-[0.98]"
        >
          Start Chatting &rarr;
        </button>
      </div>

      <button
        onClick={onFinish}
        className="w-full text-center text-xs text-slate-500 hover:text-slate-400 py-1 transition-colors"
      >
        Skip channels &mdash; I'll set up later
      </button>
    </div>
  );
}
