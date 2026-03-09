import { useState, useEffect, useCallback } from "react";
import { safeInvoke, localSet } from "@/lib/tauri";
import type { OnboardingStep, DockerStatus, SetupStepResult, OnboardingPopupProps } from "./types";
import { STEP_ORDER, getStepIndex } from "./types";
import { WelcomeStep } from "./WelcomeStep";
import { DockerStep } from "./DockerStep";
import { ApiKeyStep } from "./ApiKeyStep";
import { LaunchingStep } from "./LaunchingStep";
import { ChannelsStep } from "./ChannelsStep";
import { WhatsAppStep } from "./WhatsAppStep";
import { SlackStep } from "./SlackStep";
import { DoneStep } from "./DoneStep";

// ── Main Onboarding Component ───────────────────────────────────────

export function OnboardingPopup({ onComplete, forceRestart }: OnboardingPopupProps) {
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
  // Track the furthest step the user has reached (for clickable dots)
  const [furthestStep, setFurthestStep] = useState(0);
  // Whether stack health was confirmed (Docker + API running)
  const [stackHealthy, setStackHealthy] = useState(false);

  // ── Update furthest step tracker ─────────────────────────────────

  useEffect(() => {
    const idx = getStepIndex(step);
    if (idx > furthestStep) {
      setFurthestStep(idx);
    }
  }, [step, furthestStep]);

  // ── Check Docker on mount ───────────────────────────────────────

  useEffect(() => {
    checkDocker();
  }, []);

  const checkDocker = async () => {
    try {
      const status = await safeInvoke<DockerStatus>("check_docker_status");
      setDockerStatus(status);

      // Check if stack is already running
      if (status.docker_running && status.stack_cloned && status.env_configured) {
        try {
          const resp = await fetch("http://127.0.0.1:3100/health", {
            signal: AbortSignal.timeout(3000),
          });
          if (resp.ok) {
            setStackHealthy(true);
            // If NOT a restart, auto-advance to channels
            // If restart, stay on welcome so user can navigate manually
            if (!forceRestart) {
              setFurthestStep(3); // Mark up through channels as reachable
              setStep("channels");
              return;
            }
            // For restart: mark all steps as reachable but stay on welcome
            setFurthestStep(3);
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

  // ── Navigation helpers ────────────────────────────────────────────

  const goToStep = (target: OnboardingStep) => {
    // For launching step: only go there if we're actively launching or stack is healthy
    if (target === "launching" && !isLaunching && !servicesStarted && !stackHealthy) {
      return;
    }
    setStep(target);
  };

  const handleProgressDotClick = (index: number) => {
    // Can only click dots for steps we've reached (or earlier)
    if (index <= furthestStep) {
      const target = STEP_ORDER[index];
      goToStep(target);
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

  const handleAllServicesReady = async () => {
    setStackHealthy(true);

    // Save entered keys to the encrypted vault so all services can use them
    const keysToSave: Array<{ id: string; value: string }> = [];
    if (apiKey.trim()) keysToSave.push({ id: "anthropic", value: apiKey.trim() });
    if (openaiKey.trim()) keysToSave.push({ id: "openai", value: openaiKey.trim() });
    if (geminiKey.trim()) keysToSave.push({ id: "gemini", value: geminiKey.trim() });

    for (const key of keysToSave) {
      try {
        await fetch(`http://127.0.0.1:3100/api/settings/vault/${key.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: key.value }),
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // Vault save failed — non-critical, keys are still in .env
      }
    }

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
        {/* Progress dots — clickable for navigation */}
        <div className="flex items-center justify-center gap-2 pt-5 sticky top-0 bg-slate-900 z-10 pb-2">
          {STEP_ORDER.map((stepName, i) => (
            <button
              key={i}
              onClick={() => handleProgressDotClick(i)}
              disabled={i > furthestStep}
              title={i <= furthestStep ? `Go to: ${stepName.charAt(0).toUpperCase() + stepName.slice(1)}` : undefined}
              className={`rounded-full transition-all duration-300 ${
                i === currentStepIdx
                  ? "w-6 h-1.5 bg-blue-500"
                  : i < currentStepIdx
                  ? "w-1.5 h-1.5 bg-blue-400 hover:bg-blue-300 cursor-pointer"
                  : i <= furthestStep
                  ? "w-1.5 h-1.5 bg-slate-500 hover:bg-slate-400 cursor-pointer"
                  : "w-1.5 h-1.5 bg-slate-700 cursor-default"
              }`}
            />
          ))}
        </div>

        <div className="p-8">
          {/* ── STEP: Welcome ──────────────────────────────────── */}
          {step === "welcome" && (
            <WelcomeStep
              dockerStatus={dockerStatus}
              stackHealthy={stackHealthy}
              onNext={handleWelcomeNext}
              setStep={setStep}
            />
          )}

          {/* ── STEP: Docker Install ──────────────────────────── */}
          {step === "docker_install" && (
            <DockerStep
              onRetry={handleDockerRetry}
              setStep={setStep}
            />
          )}

          {/* ── STEP: API Key ─────────────────────────────────── */}
          {step === "api_key" && (
            <ApiKeyStep
              apiKey={apiKey}
              setApiKey={setApiKey}
              openaiKey={openaiKey}
              setOpenaiKey={setOpenaiKey}
              geminiKey={geminiKey}
              setGeminiKey={setGeminiKey}
              showExtraKeys={showExtraKeys}
              setShowExtraKeys={setShowExtraKeys}
              stackHealthy={stackHealthy}
              onNext={handleApiKeyNext}
              setStep={setStep}
            />
          )}

          {/* ── STEP: Launching ───────────────────────────────── */}
          {step === "launching" && (
            <LaunchingStep
              launchLog={launchLog}
              launchError={launchError}
              isLaunching={isLaunching}
              servicesStarted={servicesStarted}
              onRetry={runLaunchSequence}
              onAllServicesReady={handleAllServicesReady}
              setStep={setStep}
            />
          )}

          {/* ── STEP: Channels ────────────────────────────────── */}
          {step === "channels" && (
            <ChannelsStep
              selectedChannel={selectedChannel}
              onChannelSelect={handleChannelSelect}
              onFinish={handleFinish}
              setStep={setStep}
            />
          )}

          {/* ── STEP: WhatsApp QR ─────────────────────────────── */}
          {step === "whatsapp" && (
            <WhatsAppStep setStep={setStep} />
          )}

          {/* ── STEP: Slack ───────────────────────────────────── */}
          {step === "slack" && (
            <SlackStep setStep={setStep} />
          )}

          {/* ── STEP: Done ────────────────────────────────────── */}
          {step === "done" && (
            <DoneStep onFinish={handleFinish} />
          )}
        </div>
      </div>
    </div>
  );
}
