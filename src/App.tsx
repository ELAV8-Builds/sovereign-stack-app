import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ErrorBoundary } from "./components/ErrorBoundary";
import SetupWizard from "./pages/SetupWizard";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import "./App.css";

type AppView = "setup" | "dashboard" | "settings";

function App() {
  const [view, setView] = useState<AppView>("setup");

  // Check if setup has been completed on mount
  useEffect(() => {
    checkSetupStatus();
  }, []);

  const checkSetupStatus = async () => {
    try {
      // Check if sovereign user exists as a proxy for setup completion
      const userExists = await invoke<boolean>("check_sovereign_user_exists");
      if (userExists) {
        setView("dashboard");
      }
    } catch (err) {
      console.error("Failed to check setup status:", err);
    }
  };

  // Allow manual view switching via hash
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash === "dashboard") {
        setView("dashboard");
      } else if (hash === "setup") {
        setView("setup");
      } else if (hash === "settings") {
        setView("settings");
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    handleHashChange(); // Check on mount

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return (
    <ErrorBoundary>
      <div className="app">
        {view === "setup" && <SetupWizard />}
        {view === "dashboard" && <Dashboard />}
        {view === "settings" && <Settings />}
      </div>
    </ErrorBoundary>
  );
}

export default App;
