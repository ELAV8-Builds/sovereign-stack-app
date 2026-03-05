import { useState, useEffect, useCallback } from "react";
import { safeInvoke, localSet } from "@/lib/tauri";
import { WhatsAppConnect } from "./WhatsAppConnect";
import { SlackWizard } from "./SlackWizard";
import { SetupProgress } from "./SetupProgress";

// ── Types ────────────────────────────────────────────────────────────

type OnboardingStep =
  | "welcome"        // 0 — Welcome + Docker check
  | "docker_install" // 1 — Docker not found — show install instructions
  | "api_key"        // 2 — Enter API key
  | "launching"      // 3 — Downloading stack + starting services + progress
  | "channels"       // 4 — Optional channel connections
  | "whatsapp"       // 4a — WhatsApp QR
  | "slack"          // 4b — Slack wizard
  | "done";          // 5 — All set!

interface DockerStatus {
  docker_installed: boolean;
  docker_running: boolean;
  compose_available: boolean;
  stack_cloned: boolean;
  stack_path: string;
  env_configured: boolean;
}

interface SetupStepResult {
  step: string;
  success: boolean;
  message: string;
  detail: string | null;
}

interface OnboardingPopupProps {
  onComplete: () => void;
}

// ── Step index for progress dots ────────────────────────────────────

const STEP_ORDER: OnboardingStep[] = [
  "welcome",
  "api_key",
  "launching",
  "channels",
  "done",
];

function getStepIndex(step: OnboardingStep): number {
  if (step === "docker_install") return 0;
  if (step === "whatsapp" || step === "slack") return 3;
  return STEP_ORDER.indexOf(step);
}

// ── Main Onboarding Component ───────────────────────────────────────

export function OnboardingPopup({ onComplete }: OnboardingPopupProps) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [dockerStatus, setDockerStatus] = useState<DockerStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [showExtraKeys, setShowExtraKeys] = useState(false);
  const [launchLog, setLaunchLog] = useState<string[]>([]);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [servicesStarted, setServicesStarted] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<"whatsapp" | "slack" | null>(null);

  // ── Check Docker on mount ───────────────────────────────────────

  useEffect(() => {
    checkDocker();
  }, []);

  const checkDocker = async () => {
    try {
      const status = await safeInvoke<DockerStatus>("check_docker_status");
      setDockerStatus(status);

      // If Docker is ready and stack is already running, skip to channels
      if (status.docker_running && status.stack_cloned && status.env_configured) {
        // Stack might already be running — check health
        try {
          const resp = await fetch("http://127.0.0.1:3100/health", {
            signal: AbortSignal.timeout(3000),
          });
          if (resp.ok) {
            setStep("channels");
            return;
          }
        } catch {
          // Not running yet, continue with normal flow
        }
      }
    } catch {
      // Browser mode or Tauri not available — fallback
      setDockerStatus({
        docker_installed: false,
        docker_running: false,
        compose_available: false,
        stack_cloned: false,
        stack_path: "",
        env_configured: false,
      });
    }
  };

  // ── Launch sequence ─────────────────────────────────────────────

  const addLog = useCallback((msg: string) => {
    setLaunchLog((prev) => [...prev, msg]);
  }, []);

  const runLaunchSequence = async () => {
    setIsLaunching(true);
    setLaunchError(null);
    setLaunchLog([]);
    setStep("launching");

    try {
      // Step 1: Clone/update stack
      addLog("Downloading Sovereign Stack...");
      const cloneResult = await safeInvoke<SetupStepResult>("clone_docker_stack");
      if (!cloneResult.success) {
        throw new Error(cloneResult.message + (cloneResult.detail ? `: ${cloneResult.detail}` : ""));
      }
      addLog(`Done: ${cloneResult.message}`);

      // Step 2: Write .env with API keys
      addLog("Configuring environment...");
      const envResult = await safeInvoke<SetupStepResult>("configure_docker_env", {
        anthropicKey: apiKey,
        openaiKey: openaiKey || null,
        geminiKey: geminiKey || null,
        workspacePath: null, // Uses default ~/projects
      });
      if (!envResult.success) {
        throw new Error(envResult.message);
      }
      addLog("Done: API keys and settings saved");

      // Step 3: Build Docker images
      addLog("Building Docker images (this may take a few minutes on first run)...");
      const buildResult = await safeInvoke<SetupStepResult>("docker_compose_build");
      if (!buildResult.success) {
        // Build failures are common on first run for non-critical images — continue
        addLog("Warning: Some images may need to pull — continuing...");
      } else {
        addLog("Done: Docker images ready");
      }

      // Step 4: Start services
      addLog("Starting services...");
      const upResult = await safeInvoke<SetupStepResult>("docker_compose_up");
      if (!upResult.success) {
        throw new Error(upResult.message + (upResult.detail ? `: ${upResult.detail}` : ""));
      }
      addLog("Done: Services starting up");

      // Step 5: Pull Ollama model (non-blocking)
      addLog("Downloading embedding model...");
      safeInvoke<SetupStepResult>("pull_ollama_model")
        .then((r) => addLog(r.success ? "Done: Embedding model ready" : "Note: Embedding model will download on first use"))
        .catch(() => addLog("Note: Embedding model will download on first use"));

      // Mark services as started — SetupProgress takes over health polling
      setServicesStarted(true);
      addLog("Waiting for all services to become healthy...");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // Check if it's a Tauri-not-available error (browser mode)
      if (msg.includes("[tauri:")) {
        addLog("Running in browser mode — simulating setup...");
        setServicesStarted(true);
        addLog("Check that Docker stack is running: docker compose up -d");
        return;
      }

      setLaunchError(msg);
      addLog(`Error: ${msg}`);
    } finally {
      setIsLaunching(false);
    }
  };

  // ── Handlers ────────────────────────────────────────────────────

  const handleWelcomeNext = () => {
    if (!dockerStatus?.docker_installed || !dockerStatus?.docker_running) {
      setStep("docker_install");
    } else {
      setStep("api_key");
    }
  };

  const handleDockerRetry = async () => {
    await checkDocker();
    if (dockerStatus?.docker_running) {
      setStep("api_key");
    }
  };

  const handleApiKeyNext = () => {
    if (!apiKey.trim()) return;
    // Save key to localStorage as well
    localSet("anthropic_key", apiKey);
    runLaunchSequence();
  };

  const handleAllServicesReady = () => {
    setStep("channels");
  };

  const handleChannelSelect = (channel: "whatsapp" | "slack") => {
    setSelectedChannel(channel);
    setStep(channel);
  };

  const handleFinish = () => {
    localSet("onboarding_complete", true);
    localSet("stack_configured", true);
    onComplete();
  };

  // ── Render ──────────────────────────────────────────────────────

  const currentStepIdx = getStepIndex(step);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden animate-fadeIn max-h-[90vh] overflow-y-auto scrollbar-thin">
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 pt-5 sticky top-0 bg-slate-900 z-10 pb-2">
          {STEP_ORDER.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === currentStepIdx
                  ? "w-6 bg-blue-500"
                  : i < currentStepIdx
                  ? "w-1.5 bg-blue-400"
                  : "w-1.5 bg-slate-700"
              }`}
            />
          ))}
        </div>

        <div className="p-8">
          {/* ── STEP: Welcome ──────────────────────────────────── */}
          {step === "welcome" && (
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
                    {dockerStatus.docker_running
                      ? "Docker is running — ready to set up"
                      : dockerStatus.docker_installed
                      ? "Docker is installed but not running"
                      : "Docker Desktop required"}
                  </span>
                </div>
              )}

              <button
                onClick={handleWelcomeNext}
                className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-xl text-white font-semibold transition-all duration-200 shadow-lg shadow-blue-600/20 active:scale-[0.98]"
              >
                Get Started
              </button>
            </div>
          )}

          {/* ── STEP: Docker Install ──────────────────────────── */}
          {step === "docker_install" && (
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
                  onClick={handleDockerRetry}
                  className="flex-1 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-semibold transition-all active:scale-[0.98] text-sm"
                >
                  Check Again
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: API Key ─────────────────────────────────── */}
          {step === "api_key" && (
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
                <button
                  onClick={handleApiKeyNext}
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
          )}

          {/* ── STEP: Launching ───────────────────────────────── */}
          {step === "launching" && (
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

                  {launchError && (
                    <div className="flex gap-3">
                      <button
                        onClick={() => setStep("api_key")}
                        className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
                      >
                        &larr; Back
                      </button>
                      <button
                        onClick={runLaunchSequence}
                        className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-semibold text-sm transition-all active:scale-[0.98]"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* Service health monitoring + fun game */}
              {servicesStarted && (
                <SetupProgress
                  isActive={true}
                  onAllReady={handleAllServicesReady}
                />
              )}
            </div>
          )}

          {/* ── STEP: Channels ────────────────────────────────── */}
          {step === "channels" && (
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
                    Scan QR &bull; 30 seconds
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
                    Paste token &bull; 2 minutes
                  </div>
                </button>
              </div>

              <button
                onClick={handleFinish}
                className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-xl text-white font-semibold transition-all duration-200 shadow-lg shadow-blue-600/20 active:scale-[0.98]"
              >
                Start Chatting &rarr;
              </button>

              <button
                onClick={handleFinish}
                className="w-full text-center text-xs text-slate-500 hover:text-slate-400 py-1 transition-colors"
              >
                Skip channels &mdash; I'll set up later
              </button>
            </div>
          )}

          {/* ── STEP: WhatsApp QR ─────────────────────────────── */}
          {step === "whatsapp" && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex items-center gap-3 mb-2">
                <button
                  onClick={() => setStep("channels")}
                  className="text-slate-500 hover:text-slate-300 transition-colors text-sm"
                >
                  &larr; Back
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

          {/* ── STEP: Slack ───────────────────────────────────── */}
          {step === "slack" && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex items-center gap-3 mb-2">
                <button
                  onClick={() => setStep("channels")}
                  className="text-slate-500 hover:text-slate-300 transition-colors text-sm"
                >
                  &larr; Back
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

          {/* ── STEP: Done ────────────────────────────────────── */}
          {step === "done" && (
            <div className="text-center space-y-6 animate-fadeIn py-4">
              <div className="text-5xl animate-scaleIn">✨</div>
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">
                  You're all set!
                </h2>
                <p className="text-slate-400 text-sm">
                  Your agent is ready to chat. Ask it anything.
                </p>
              </div>

              <button
                onClick={handleFinish}
                className="px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-xl text-white font-semibold transition-all duration-200 shadow-lg shadow-blue-600/20 active:scale-[0.98]"
              >
                Start Chatting &rarr;
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
