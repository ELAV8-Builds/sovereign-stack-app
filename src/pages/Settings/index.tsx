import { useState, useEffect, useCallback } from "react";
import { safeInvoke } from "@/lib/tauri";
import toast from "react-hot-toast";
import type { SystemInfo, VaultKey, SettingsSection } from "./types";
import { API_BASE, SECTIONS } from "./types";
import { CommunicationSection } from "./CommunicationSection";
import { AgentSection } from "./AgentSection";
import { KnowledgeSection } from "./KnowledgeSection";
import { SystemSection } from "./SystemSection";
import { SecuritySection } from "./SecuritySection";
import { AdvancedSection } from "./AdvancedSection";

export default function Settings() {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>("communication");
  // Key Vault state
  const [vaultKeys, setVaultKeys] = useState<VaultKey[]>([]);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [customKeyName, setCustomKeyName] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);

  useEffect(() => {
    loadSystemInfo();
  }, []);

  const loadSystemInfo = async () => {
    try {
      const info = await safeInvoke<SystemInfo>("get_system_info");
      setSystemInfo(info);
    } catch {
      // System info not available outside Tauri runtime
    }
  };

  // ── Key Vault Functions ──────────────────────────────────

  const loadVaultKeys = useCallback(async () => {
    setVaultLoading(true);
    try {
      const res = await fetch(`${API_BASE}/settings/vault/registry`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        setVaultKeys(data.keys || []);
      }
    } catch {
      // API not available
    } finally {
      setVaultLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSection === "security") {
      loadVaultKeys();
    }
  }, [activeSection, loadVaultKeys]);

  const handleSaveVaultKey = async (keyId: string) => {
    const value = keyInputs[keyId]?.trim();
    if (!value) return;

    setSavingKey(keyId);
    try {
      const res = await fetch(`${API_BASE}/settings/vault/${keyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error);
      }
      toast.success(`Key saved (encrypted)`);
      setSavedKeys((prev) => new Set([...prev, keyId]));
      setKeyInputs((prev) => ({ ...prev, [keyId]: "" }));
      setExpandedKey(null);
      setTimeout(() => setSavedKeys((prev) => { const n = new Set(prev); n.delete(keyId); return n; }), 3000);
      loadVaultKeys();
    } catch (err) {
      toast.error(`Failed to save: ${(err as Error).message}`);
    } finally {
      setSavingKey(null);
    }
  };

  const handleDeleteVaultKey = async (keyId: string) => {
    try {
      const res = await fetch(`${API_BASE}/settings/vault/${keyId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Key removed");
      loadVaultKeys();
    } catch {
      toast.error("Failed to remove key");
    }
  };

  const handleAddCustomKey = async () => {
    const id = customKeyName.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!id) return;
    setAddingCustom(false);
    setCustomKeyName("");
    setExpandedKey(id);
  };

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-5xl mx-auto p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-white">Settings</h1>
          <p className="text-sm text-slate-500">Configure your Sovereign Stack</p>
        </div>

        {/* Section tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-slate-800 pb-3 overflow-x-auto">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap ${
                activeSection === section.id
                  ? "bg-slate-800 text-white"
                  : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
              }`}
            >
              <span>{section.icon}</span>
              <span>{section.label}</span>
            </button>
          ))}
        </div>

        {/* Section content */}
        <div className="space-y-6">
          {activeSection === "communication" && <CommunicationSection />}
          {activeSection === "agent" && <AgentSection />}
          {activeSection === "knowledge" && <KnowledgeSection />}
          {activeSection === "system" && <SystemSection systemInfo={systemInfo} />}
          {activeSection === "security" && (
            <SecuritySection
              vaultLoading={vaultLoading}
              vaultKeys={vaultKeys}
              keyInputs={keyInputs}
              savingKey={savingKey}
              savedKeys={savedKeys}
              expandedKey={expandedKey}
              addingCustom={addingCustom}
              customKeyName={customKeyName}
              onSetExpandedKey={setExpandedKey}
              onSetKeyInputs={setKeyInputs}
              onSaveVaultKey={handleSaveVaultKey}
              onDeleteVaultKey={handleDeleteVaultKey}
              onSetAddingCustom={setAddingCustom}
              onSetCustomKeyName={setCustomKeyName}
              onAddCustomKey={handleAddCustomKey}
            />
          )}
          {activeSection === "advanced" && <AdvancedSection />}
        </div>
      </div>
    </div>
  );
}
