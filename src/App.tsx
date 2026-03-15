import { useState, useEffect } from "react";
import { localGet } from "@/lib/tauri";
import { Toaster } from "react-hot-toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ChatInterface } from "./components/ChatInterface";
import { UnifiedDashboard } from "./components/UnifiedDashboard";
import { OnboardingPopup } from "./components/OnboardingPopup";
import { Overmind } from "./components/Overmind";
import { Canvas } from "./components/Canvas";
import Settings from "./pages/Settings";
import "./App.css";

type Tab = "chat" | "overmind" | "canvas" | "dashboard" | "settings";

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

  // Listen for cross-tab navigation (e.g., "Create via Chat" from Overmind)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail === 'string') {
        setActiveTab(detail as Tab);
      }
    };
    window.addEventListener("switch-tab", handler);
    return () => window.removeEventListener("switch-tab", handler);
  }, []);

  const tabIcons: Record<Tab, React.ReactNode> = {
    chat: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    overmind: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M12 2a9 9 0 0 1 9 9c0 3.9-3.1 7.1-5.5 9.3L12 23l-3.5-2.7C6.1 18.1 3 14.9 3 11a9 9 0 0 1 9-9z"/><circle cx="12" cy="11" r="3"/></svg>,
    canvas: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>,
    dashboard: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
    settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "chat", label: "Chat" },
    { id: "overmind", label: "Overmind" },
    { id: "canvas", label: "Canvas" },
    { id: "dashboard", label: "Dashboard" },
    { id: "settings", label: "Settings" },
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

      {/* Top navigation bar — fully draggable except buttons */}
      <div
        data-tauri-drag-region
        className="titlebar flex items-center pl-[80px] pr-3 h-12 border-b border-white/[0.06] bg-slate-950/70 backdrop-blur-xl flex-shrink-0 z-30"
        style={{ borderTop: "1px solid rgba(99, 102, 241, 0.15)" }}
      >
        {/* Left: Logo + drag spacer */}
        <div data-tauri-drag-region className="flex items-center gap-2.5 mr-auto">
          <span data-tauri-drag-region className="text-sm font-bold tracking-widest text-white/80 uppercase select-none">
            Sovereign
          </span>
          <span data-tauri-drag-region className="text-[9px] text-indigo-400/60 font-mono font-medium select-none">v0.4</span>
        </div>

        {/* Center: Tabs */}
        <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-xl p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-250 ${
                activeTab === tab.id
                  ? "bg-white/[0.08] text-white shadow-[0_0_12px_rgba(99,102,241,0.15)]"
                  : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]"
              }`}
            >
              <span className={activeTab === tab.id ? "text-indigo-400" : ""}>{tabIcons[tab.id]}</span>
              <span className="hidden sm:inline">{tab.label}</span>
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-[2px] bg-indigo-500 rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Right: Status ring + drag spacer */}
        <div data-tauri-drag-region className="flex items-center gap-2 ml-auto">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <span data-tauri-drag-region className="text-[10px] text-slate-500 font-medium select-none">Live</span>
        </div>
      </div>

      {/* Main content — ChatInterface stays mounted to preserve state */}
      <main className="flex-1 overflow-hidden relative">
        <div className={activeTab === "chat" ? "h-full" : "hidden"}>
          <ChatInterface />
        </div>
        {activeTab === "overmind" && <Overmind />}
        {activeTab === "canvas" && <Canvas />}
        {activeTab === "dashboard" && <UnifiedDashboard />}
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
