import { useState, useEffect } from "react";
import { localGet } from "@/lib/tauri";
import { Toaster } from "react-hot-toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ChatInterface } from "./components/ChatInterface";
import { UnifiedDashboard } from "./components/UnifiedDashboard";
import { AgentActivityLog } from "./components/AgentActivityLog";
import { OnboardingPopup } from "./components/OnboardingPopup";
import Settings from "./pages/Settings";
import "./App.css";

type Tab = "chat" | "dashboard" | "activity" | "settings";

function AppContent() {
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [forceRestart, setForceRestart] = useState(false);

  // Check if first launch — use localStorage (works in both Tauri and browser)
  useEffect(() => {
    const isComplete = localGet<boolean>("onboarding_complete", false);
    setShowOnboarding(!isComplete);
    setOnboardingChecked(true);
  }, []);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    setForceRestart(false);
    localStorage.setItem("sovereign_onboarding_complete", "true");
  };

  const handleRestartOnboarding = () => {
    setForceRestart(true);
    setShowOnboarding(true);
  };

  // Listen for restart-onboarding event from Settings
  useEffect(() => {
    const handler = () => handleRestartOnboarding();
    window.addEventListener("restart-onboarding", handler);
    return () => window.removeEventListener("restart-onboarding", handler);
  }, []);

  // Tab config
  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "chat", label: "Chat", icon: "💬" },
    { id: "dashboard", label: "Dashboard", icon: "📊" },
    { id: "activity", label: "Activity", icon: "📡" },
    { id: "settings", label: "Settings", icon: "⚙️" },
  ];

  if (!onboardingChecked) {
    return (
      <div className="h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-white overflow-hidden">
      {/* Onboarding popup */}
      {showOnboarding && (
        <OnboardingPopup onComplete={handleOnboardingComplete} forceRestart={forceRestart} />
      )}

      {/* Top navigation bar */}
      <nav className="flex items-center justify-between px-2 h-12 border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm flex-shrink-0 z-30">
        {/* Left: Logo */}
        <div className="flex items-center gap-2 px-2">
          <span className="text-sm font-bold tracking-tight text-slate-300">
            SOVEREIGN
          </span>
          <span className="text-[10px] text-slate-600 font-mono">v0.4</span>
        </div>

        {/* Center: Tabs */}
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                activeTab === tab.id
                  ? "bg-slate-800 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
              }`}
            >
              <span className="text-sm">{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Right: Status indicators */}
        <div className="flex items-center gap-2 px-2">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[10px] text-slate-600">Online</span>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {activeTab === "chat" && <ChatInterface />}
        {activeTab === "dashboard" && <UnifiedDashboard />}
        {activeTab === "activity" && <AgentActivityLog />}
        {activeTab === "settings" && <Settings />}
      </main>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AppContent />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#1e293b',
            color: '#e2e8f0',
            border: '1px solid #334155',
            fontSize: '13px',
          },
        }}
      />
    </ErrorBoundary>
  );
}

export default App;
