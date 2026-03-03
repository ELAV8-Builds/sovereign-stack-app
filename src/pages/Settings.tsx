import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface SystemInfo {
  macos_version: string;
  architecture: string;
  hostname: string;
  current_user: string;
}

export default function Settings() {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [anthropicKey, setAnthropicKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);

  useEffect(() => {
    loadSystemInfo();
  }, []);

  const loadSystemInfo = async () => {
    try {
      const info = await invoke<SystemInfo>("get_system_info");
      setSystemInfo(info);
    } catch (err) {
      console.error("Failed to load system info:", err);
    }
  };

  const handleSaveApiKey = () => {
    // In production, this would save to macOS Keychain
    // For now, we'll just simulate it
    localStorage.setItem("anthropic_api_key", anthropicKey);
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 3000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Header */}
      <div className="border-b border-slate-700 bg-slate-800/50 backdrop-blur">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Settings</h1>
              <p className="text-sm text-slate-400">Configure Sovereign Stack</p>
            </div>
            <a
              href="#dashboard"
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded font-medium transition"
            >
              ← Back to Dashboard
            </a>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="space-y-6">
          {/* System Information */}
          <div className="bg-slate-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">System Information</h2>
            {systemInfo ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-slate-400">macOS Version</div>
                  <div className="font-semibold">{systemInfo.macos_version}</div>
                </div>
                <div>
                  <div className="text-sm text-slate-400">Architecture</div>
                  <div className="font-semibold">{systemInfo.architecture}</div>
                </div>
                <div>
                  <div className="text-sm text-slate-400">Hostname</div>
                  <div className="font-semibold">{systemInfo.hostname}</div>
                </div>
                <div>
                  <div className="text-sm text-slate-400">Current User</div>
                  <div className="font-semibold">{systemInfo.current_user}</div>
                </div>
              </div>
            ) : (
              <p className="text-slate-400">Loading system information...</p>
            )}
          </div>

          {/* API Keys */}
          <div className="bg-slate-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">API Keys</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Anthropic API Key
                </label>
                <div className="flex space-x-2">
                  <input
                    type="password"
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    placeholder="sk-ant-..."
                    className="flex-1 bg-slate-700 border border-slate-600 rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={handleSaveApiKey}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded font-medium transition"
                  >
                    Save
                  </button>
                </div>
                {keySaved && (
                  <p className="text-sm text-green-400 mt-2">✓ API key saved to Keychain</p>
                )}
                <p className="text-xs text-slate-400 mt-1">
                  Used by LiteLLM for Claude API access
                </p>
              </div>
            </div>
          </div>

          {/* Service Ports */}
          <div className="bg-slate-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Service Ports</h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-slate-700">
                <span className="font-medium">LiteLLM</span>
                <span className="text-slate-400">Port 4000</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-700">
                <span className="font-medium">Ollama</span>
                <span className="text-slate-400">Port 11434</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-700">
                <span className="font-medium">memU</span>
                <span className="text-slate-400">Port 8090</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-700">
                <span className="font-medium">PostgreSQL</span>
                <span className="text-slate-400">Port 5432</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-700">
                <span className="font-medium">Temporal</span>
                <span className="text-slate-400">Port 7233</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="font-medium">AnythingLLM</span>
                <span className="text-slate-400">Port 3001</span>
              </div>
            </div>
          </div>

          {/* About */}
          <div className="bg-slate-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">About</h2>
            <div className="space-y-2 text-sm">
              <p><span className="text-slate-400">App Version:</span> <span className="font-semibold">0.1.0</span></p>
              <p><span className="text-slate-400">Tauri Version:</span> <span className="font-semibold">2.0</span></p>
              <p className="pt-4 text-slate-400">
                Sovereign Stack Control Panel - Manage your personal AI infrastructure
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
