import type { OnboardingStep } from "./types";

interface ApiKeyStepProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  openaiKey: string;
  setOpenaiKey: (key: string) => void;
  geminiKey: string;
  setGeminiKey: (key: string) => void;
  showExtraKeys: boolean;
  setShowExtraKeys: (show: boolean) => void;
  stackHealthy: boolean;
  onNext: () => void;
  setStep: (step: OnboardingStep) => void;
}

export function ApiKeyStep({
  apiKey,
  setApiKey,
  openaiKey,
  setOpenaiKey,
  geminiKey,
  setGeminiKey,
  showExtraKeys,
  setShowExtraKeys,
  stackHealthy,
  onNext,
  setStep,
}: ApiKeyStepProps) {
  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="text-center space-y-2">
        <div className="text-4xl mb-3">🔑</div>
        <h2 className="text-xl font-bold text-white">
          Connect Your AI
        </h2>
        <p className="text-slate-400 text-sm">
          Enter your API key to power the AI models.
        </p>
      </div>

      {/* Anthropic key (required) */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-300">
          Anthropic API Key <span className="text-red-400">*</span>
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-ant-..."
          autoFocus
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all duration-200"
        />
        <p className="text-xs text-slate-500">
          Get one at{" "}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300"
          >
            console.anthropic.com
          </a>
          . Stored locally in .env — used to authenticate with AI providers.
        </p>
      </div>

      {/* Optional extra keys */}
      <button
        onClick={() => setShowExtraKeys(!showExtraKeys)}
        className="text-xs text-slate-500 hover:text-slate-400 transition-colors flex items-center gap-1"
      >
        <span
          className={`transform transition-transform ${
            showExtraKeys ? "rotate-90" : ""
          }`}
        >
          &rsaquo;
        </span>
        Optional: Add OpenAI or Google keys
      </button>

      {showExtraKeys && (
        <div className="space-y-3 animate-fadeIn">
          <div className="space-y-1.5">
            <label className="block text-xs text-slate-400">
              OpenAI API Key (optional)
            </label>
            <input
              type="password"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs text-slate-400">
              Google Gemini API Key (optional)
            </label>
            <input
              type="password"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder="AI..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
            />
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => setStep("welcome")}
          className="px-4 py-2.5 text-sm text-slate-400 hover:text-white transition-colors"
        >
          &larr; Back
        </button>
        {/* Skip to channels if stack is already healthy (restart scenario) */}
        {stackHealthy && (
          <button
            onClick={() => setStep("channels")}
            className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-300 transition-colors"
          >
            Skip &rarr;
          </button>
        )}
        <button
          onClick={onNext}
          disabled={!apiKey.trim()}
          className={`flex-1 px-6 py-3 rounded-xl font-semibold transition-all active:scale-[0.98] text-sm ${
            apiKey.trim()
              ? "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white shadow-lg shadow-blue-600/20"
              : "bg-slate-800 text-slate-600 cursor-not-allowed"
          }`}
        >
          Launch Sovereign Stack &rarr;
        </button>
      </div>
    </div>
  );
}
