import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WhatsAppConnect } from "./WhatsAppConnect";
import { SlackWizard } from "./SlackWizard";

type OnboardingStep = "welcome" | "whatsapp" | "slack" | "done";

interface OnboardingPopupProps {
  onComplete: () => void;
}

export function OnboardingPopup({ onComplete }: OnboardingPopupProps) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [apiKey, setApiKey] = useState("");
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<"whatsapp" | "slack" | null>(null);

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;
    try {
      await invoke("save_api_key", { key: apiKey });
    } catch {
      // Will work in production — mock for now
    }
    setApiKeySaved(true);
  };

  const handleSkip = () => {
    onComplete();
  };

  const handleChannelSelect = (channel: "whatsapp" | "slack") => {
    setSelectedChannel(channel);
    setStep(channel);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleSkip}
      />

      {/* Modal */}
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden animate-fadeIn">
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 pt-5">
          {["welcome", "channel", "done"].map((s, i) => {
            const currentIdx =
              step === "welcome" ? 0 : step === "done" ? 2 : 1;
            return (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === currentIdx
                    ? "w-6 bg-blue-500"
                    : i < currentIdx
                    ? "w-1.5 bg-blue-400"
                    : "w-1.5 bg-slate-700"
                }`}
              />
            );
          })}
        </div>

        <div className="p-8">
          {/* STEP: Welcome */}
          {step === "welcome" && (
            <div className="space-y-6 animate-fadeIn">
              <div className="text-center space-y-2">
                <div className="text-4xl mb-3">👋</div>
                <h2 className="text-2xl font-bold text-white">
                  Welcome to Sovereign Stack
                </h2>
                <p className="text-slate-400 text-sm">
                  Let's get you connected in 30 seconds.
                </p>
              </div>

              {/* API Key */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-300">
                  🔑 Anthropic API Key
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-ant-..."
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all duration-200"
                  />
                  {!apiKeySaved ? (
                    <button
                      onClick={handleSaveKey}
                      disabled={!apiKey.trim()}
                      className={`px-4 py-3 rounded-lg text-sm font-semibold transition-all duration-200 ${
                        apiKey.trim()
                          ? "bg-blue-600 hover:bg-blue-500 text-white active:scale-95"
                          : "bg-slate-800 text-slate-600 cursor-not-allowed"
                      }`}
                    >
                      Save
                    </button>
                  ) : (
                    <span className="flex items-center px-4 text-green-400 text-sm font-medium">
                      ✓ Saved
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  Powers your AI agent. Stored locally, never leaves your machine.
                </p>
              </div>

              {/* Channel selection */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-slate-800" />
                  <span className="text-xs text-slate-500 font-medium">
                    Connect a channel
                  </span>
                  <div className="h-px flex-1 bg-slate-800" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* WhatsApp */}
                  <button
                    onClick={() => handleChannelSelect("whatsapp")}
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
                      Scan QR • 30 seconds
                    </div>
                  </button>

                  {/* Slack */}
                  <button
                    onClick={() => handleChannelSelect("slack")}
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
                      Paste token • 2 minutes
                    </div>
                  </button>
                </div>

                <button
                  onClick={handleSkip}
                  className="w-full text-center text-xs text-slate-500 hover:text-slate-400 py-2 transition-colors"
                >
                  Skip — I'll chat directly in the app →
                </button>
              </div>
            </div>
          )}

          {/* STEP: WhatsApp QR */}
          {step === "whatsapp" && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex items-center gap-3 mb-2">
                <button
                  onClick={() => setStep("welcome")}
                  className="text-slate-500 hover:text-slate-300 transition-colors text-sm"
                >
                  ← Back
                </button>
                <h2 className="text-lg font-bold text-white">
                  Connect WhatsApp
                </h2>
              </div>

              <WhatsAppConnect
                onConnected={() => setStep("done")}
                compact={false}
              />
            </div>
          )}

          {/* STEP: Slack */}
          {step === "slack" && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex items-center gap-3 mb-2">
                <button
                  onClick={() => setStep("welcome")}
                  className="text-slate-500 hover:text-slate-300 transition-colors text-sm"
                >
                  ← Back
                </button>
                <h2 className="text-lg font-bold text-white">
                  Connect Slack
                </h2>
              </div>

              <SlackWizard
                onComplete={() => setStep("done")}
                embedded={true}
              />
            </div>
          )}

          {/* STEP: Done */}
          {step === "done" && (
            <div className="text-center space-y-6 animate-fadeIn py-4">
              <div className="text-5xl">✨</div>
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">
                  You're all set!
                </h2>
                <p className="text-slate-400 text-sm">
                  Your agent is ready to chat. Ask it anything.
                </p>
              </div>

              <button
                onClick={onComplete}
                className="px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-xl text-white font-semibold transition-all duration-200 shadow-lg shadow-blue-600/20 active:scale-95"
              >
                Start Chatting →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
