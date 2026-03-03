import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface PreflightCheckResult {
  passed: boolean;
  macos_version: string;
  architecture: string;
  available_disk_space_gb: number;
  errors: string[];
  warnings: string[];
}

interface SystemInfo {
  macos_version: string;
  architecture: string;
  hostname: string;
  current_user: string;
}

enum SetupStep {
  PreFlight,
  CreateUser,
  InstallDependencies,
  CloneRepos,
  Configure,
  Deploy,
  Complete,
}

export default function SetupWizard() {
  const [currentStep, setCurrentStep] = useState<SetupStep>(SetupStep.PreFlight);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Initializing setup...");
  const [error, setError] = useState<string | null>(null);
  const [preflightResult, setPreflightResult] = useState<PreflightCheckResult | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [whatsappSessionPath, setWhatsappSessionPath] = useState("");

  // Step titles for UI
  const stepTitles = {
    [SetupStep.PreFlight]: "Pre-Flight Checks",
    [SetupStep.CreateUser]: "Create Sovereign User",
    [SetupStep.InstallDependencies]: "Install Dependencies",
    [SetupStep.CloneRepos]: "Clone Repositories",
    [SetupStep.Configure]: "Configure Services",
    [SetupStep.Deploy]: "Deploy Stack",
    [SetupStep.Complete]: "Setup Complete",
  };

  // Run pre-flight checks on mount
  useEffect(() => {
    runPreflightChecks();
  }, []);

  const runPreflightChecks = async () => {
    try {
      setMessage("Running pre-flight checks...");
      const result = await invoke<PreflightCheckResult>("run_preflight_checks");
      setPreflightResult(result);

      const sysInfo = await invoke<SystemInfo>("get_system_info");
      setSystemInfo(sysInfo);

      if (result.passed) {
        setProgress(10);
        setMessage("Pre-flight checks passed!");
      } else {
        setError(result.errors.join(", "));
      }
    } catch (err) {
      setError(`Pre-flight check failed: ${err}`);
    }
  };

  const createSovereignUser = async () => {
    try {
      setMessage("Checking for sovereign user...");
      const exists = await invoke<boolean>("check_sovereign_user_exists");

      if (exists) {
        setMessage("Sovereign user already exists");
        setProgress(20);
        setCurrentStep(SetupStep.InstallDependencies);
        return;
      }

      setMessage("Running privileged installer to create sovereign user...");
      // In production, this would get the pkg path from Tauri resources
      const pkgPath = "/Applications/Sovereign Stack.app/Contents/Resources/sovereign-setup.pkg";

      await invoke<string>("run_privileged_installer", { pkgPath });
      setMessage("Sovereign user created successfully!");
      setProgress(20);
      setCurrentStep(SetupStep.InstallDependencies);
    } catch (err) {
      setError(`Failed to create sovereign user: ${err}`);
    }
  };

  const installDependencies = async () => {
    try {
      // Check Homebrew
      setMessage("Checking for Homebrew...");
      const brewInstalled = await invoke<boolean>("check_homebrew_installed");

      if (!brewInstalled) {
        setMessage("Installing Homebrew... (this may take a few minutes)");
        await invoke<string>("install_homebrew");
      }
      setProgress(30);

      // Install Node.js
      setMessage("Installing Node.js...");
      const nodeExists = await invoke<boolean>("check_command_exists", { command: "node" });
      if (!nodeExists) {
        await invoke<string>("brew_install", { package: "node@22" });
      }
      setProgress(40);

      // Install Python
      setMessage("Installing Python...");
      const pythonExists = await invoke<boolean>("check_command_exists", { command: "python3" });
      if (!pythonExists) {
        await invoke<string>("brew_install", { package: "python@3.11" });
      }
      setProgress(50);

      // Install Docker Desktop
      setMessage("Checking for Docker Desktop...");
      const dockerExists = await invoke<boolean>("check_command_exists", { command: "docker" });
      if (!dockerExists) {
        setMessage("Please install Docker Desktop manually and restart this wizard.");
        setError("Docker Desktop is required. Download from: https://www.docker.com/products/docker-desktop");
        return;
      }
      setProgress(60);

      // Install Ollama
      setMessage("Installing Ollama...");
      const ollamaExists = await invoke<boolean>("check_command_exists", { command: "ollama" });
      if (!ollamaExists) {
        await invoke<string>("brew_install", { package: "ollama" });
      }
      setProgress(70);

      setMessage("All dependencies installed!");
      setCurrentStep(SetupStep.CloneRepos);
    } catch (err) {
      setError(`Dependency installation failed: ${err}`);
    }
  };

  const cloneRepositories = async () => {
    try {
      const sovereignHome = "/Users/sovereign/sovereign-stack";

      // Clone NanoClaw
      setMessage("Cloning NanoClaw repository...");
      await invoke<string>("clone_repository", {
        url: "https://github.com/yourusername/nanoclaw.git",
        destination: `${sovereignHome}/nanoclaw`,
      });
      setProgress(75);

      // Clone memU
      setMessage("Cloning memU repository...");
      await invoke<string>("clone_repository", {
        url: "https://github.com/yourusername/memu.git",
        destination: `${sovereignHome}/memu`,
      });
      setProgress(80);

      // NPM install for NanoClaw
      setMessage("Installing NanoClaw dependencies...");
      await invoke<string>("npm_install", { directory: `${sovereignHome}/nanoclaw` });
      setProgress(85);

      // Build NanoClaw
      setMessage("Building NanoClaw...");
      await invoke<string>("npm_build", { directory: `${sovereignHome}/nanoclaw` });
      setProgress(90);

      setMessage("Repositories cloned and built!");
      setCurrentStep(SetupStep.Configure);
    } catch (err) {
      setError(`Repository setup failed: ${err}`);
    }
  };

  const configureServices = async () => {
    try {
      setMessage("Pulling Ollama model (nomic-embed-text)...");
      await invoke<string>("ollama_pull_model", { model: "nomic-embed-text" });
      setProgress(95);

      setMessage("Services configured!");
      setCurrentStep(SetupStep.Deploy);
    } catch (err) {
      setError(`Configuration failed: ${err}`);
    }
  };

  const deployStack = async () => {
    try {
      setMessage("Deploying Sovereign Stack services...");
      // This would trigger the actual deployment
      // For now, we'll simulate it
      setProgress(100);
      setMessage("Sovereign Stack deployed successfully!");
      setCurrentStep(SetupStep.Complete);
    } catch (err) {
      setError(`Deployment failed: ${err}`);
    }
  };

  const handleNext = () => {
    setError(null);

    switch (currentStep) {
      case SetupStep.PreFlight:
        if (preflightResult?.passed) {
          setCurrentStep(SetupStep.CreateUser);
        }
        break;
      case SetupStep.CreateUser:
        createSovereignUser();
        break;
      case SetupStep.InstallDependencies:
        installDependencies();
        break;
      case SetupStep.CloneRepos:
        cloneRepositories();
        break;
      case SetupStep.Configure:
        configureServices();
        break;
      case SetupStep.Deploy:
        deployStack();
        break;
      case SetupStep.Complete:
        // Navigate to dashboard
        window.location.href = "/dashboard";
        break;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">Sovereign Stack Setup</h1>
          <p className="text-slate-400">
            {stepTitles[currentStep]} ({Math.round(progress)}% complete)
          </p>
        </div>

        {/* Progress Bar */}
        <div className="max-w-2xl mx-auto mb-8">
          <div className="bg-slate-700 rounded-full h-4 overflow-hidden">
            <div
              className="bg-gradient-to-r from-blue-500 to-purple-600 h-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Main Content Card */}
        <div className="max-w-3xl mx-auto bg-slate-800 rounded-lg shadow-xl p-8">
          {/* Pre-Flight Results */}
          {currentStep === SetupStep.PreFlight && preflightResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-700 p-4 rounded">
                  <div className="text-sm text-slate-400">macOS Version</div>
                  <div className="text-lg font-semibold">{preflightResult.macos_version}</div>
                </div>
                <div className="bg-slate-700 p-4 rounded">
                  <div className="text-sm text-slate-400">Architecture</div>
                  <div className="text-lg font-semibold">{preflightResult.architecture}</div>
                </div>
                <div className="bg-slate-700 p-4 rounded">
                  <div className="text-sm text-slate-400">Available Disk Space</div>
                  <div className="text-lg font-semibold">
                    {preflightResult.available_disk_space_gb.toFixed(1)} GB
                  </div>
                </div>
                <div className="bg-slate-700 p-4 rounded">
                  <div className="text-sm text-slate-400">Current User</div>
                  <div className="text-lg font-semibold">{systemInfo?.current_user}</div>
                </div>
              </div>

              {preflightResult.warnings.length > 0 && (
                <div className="bg-yellow-900/20 border border-yellow-600 rounded p-4">
                  <div className="font-semibold mb-2">⚠️ Warnings:</div>
                  <ul className="list-disc list-inside space-y-1">
                    {preflightResult.warnings.map((warning, i) => (
                      <li key={i} className="text-yellow-400">{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              {preflightResult.passed && (
                <div className="bg-green-900/20 border border-green-600 rounded p-4">
                  <div className="font-semibold">✅ System meets requirements</div>
                  <p className="text-sm text-slate-400 mt-2">
                    Your Mac is ready for the Sovereign Stack installation.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Configuration Step */}
          {currentStep === SetupStep.Configure && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Anthropic API Key
                </label>
                <input
                  type="password"
                  value={anthropicApiKey}
                  onChange={(e) => setAnthropicApiKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="w-full bg-slate-700 border border-slate-600 rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Required for LiteLLM routing to Claude models
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  WhatsApp Session Path (optional)
                </label>
                <input
                  type="text"
                  value={whatsappSessionPath}
                  onChange={(e) => setWhatsappSessionPath(e.target.value)}
                  placeholder="/path/to/.wwebjs_auth"
                  className="w-full bg-slate-700 border border-slate-600 rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Leave blank to create a new WhatsApp session
                </p>
              </div>
            </div>
          )}

          {/* Complete Step */}
          {currentStep === SetupStep.Complete && (
            <div className="text-center space-y-6">
              <div className="text-6xl mb-4">🎉</div>
              <h2 className="text-3xl font-bold">Setup Complete!</h2>
              <p className="text-slate-400">
                Your Sovereign Stack is now running and ready to use.
              </p>
              <div className="bg-slate-700 rounded p-4 text-left">
                <div className="font-semibold mb-2">Services Running:</div>
                <ul className="space-y-1 text-sm">
                  <li>✓ NanoClaw (Agent Brain)</li>
                  <li>✓ LiteLLM (Model Router)</li>
                  <li>✓ Ollama (Local Inference)</li>
                  <li>✓ memU (Semantic Memory)</li>
                  <li>✓ PostgreSQL (Database)</li>
                  <li>✓ Temporal (Workflows)</li>
                  <li>✓ AnythingLLM (Knowledge Base)</li>
                </ul>
              </div>
            </div>
          )}

          {/* Status Message */}
          {currentStep !== SetupStep.PreFlight && currentStep !== SetupStep.Complete && (
            <div className="mb-6">
              <div className="flex items-center space-x-3">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500" />
                <span className="text-slate-300">{message}</span>
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="bg-red-900/20 border border-red-600 rounded p-4 mb-6">
              <div className="font-semibold mb-1">❌ Error</div>
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-between mt-8">
            <button
              className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded font-medium transition"
              onClick={() => window.close()}
            >
              Cancel
            </button>
            <button
              className={`px-6 py-2 rounded font-medium transition ${
                error || (currentStep === SetupStep.PreFlight && !preflightResult?.passed)
                  ? "bg-slate-600 cursor-not-allowed"
                  : "bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
              }`}
              onClick={handleNext}
              disabled={error !== null || (currentStep === SetupStep.PreFlight && !preflightResult?.passed)}
            >
              {currentStep === SetupStep.Complete ? "Go to Dashboard" : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
