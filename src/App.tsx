import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import SetupWizard from "./pages/SetupWizard";
import Dashboard from "./pages/Dashboard";
import "./App.css";

type AppView = "setup" | "dashboard";

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

  // Allow manual view switching
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash === "dashboard") {
        setView("dashboard");
      } else if (hash === "setup") {
        setView("setup");
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    handleHashChange(); // Check on mount

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return (
    <div className="app">
      {view === "setup" && <SetupWizard />}
      {view === "dashboard" && <Dashboard />}
    </div>
  );
}

export default App;
