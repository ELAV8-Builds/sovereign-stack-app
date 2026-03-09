import { NetworkIsolationSelector } from "../../components/NetworkIsolationSelector";
import { AutonomySettings } from "../../components/AutonomySettings";
import { Section } from "./Section";
import type { VaultKey } from "./types";
import { CATEGORY_LABELS } from "./types";

interface SecuritySectionProps {
  vaultLoading: boolean;
  vaultKeys: VaultKey[];
  keyInputs: Record<string, string>;
  savingKey: string | null;
  savedKeys: Set<string>;
  expandedKey: string | null;
  addingCustom: boolean;
  customKeyName: string;
  onSetExpandedKey: (key: string | null) => void;
  onSetKeyInputs: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  onSaveVaultKey: (keyId: string) => void;
  onDeleteVaultKey: (keyId: string) => void;
  onSetAddingCustom: (adding: boolean) => void;
  onSetCustomKeyName: (name: string) => void;
  onAddCustomKey: () => void;
}

export function SecuritySection({
  vaultLoading,
  vaultKeys,
  keyInputs,
  savingKey,
  savedKeys,
  expandedKey,
  addingCustom,
  customKeyName,
  onSetExpandedKey,
  onSetKeyInputs,
  onSaveVaultKey,
  onDeleteVaultKey,
  onSetAddingCustom,
  onSetCustomKeyName,
  onAddCustomKey,
}: SecuritySectionProps) {
  return (
    <div className="space-y-6 animate-fadeIn">
      <Section title="Network Isolation" icon="\u{1F310}" description="Control network access for containers">
        <NetworkIsolationSelector />
      </Section>

      <Section title="Autonomy Settings" icon="\u{1F6E1}\u{FE0F}" description="What the agent can do autonomously">
        <AutonomySettings />
      </Section>

      {/* Key Vault */}
      <Section title="Key Vault" icon="\u{1F510}" description="Encrypted API key storage \u2014 agents can access these at runtime">
        {vaultLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="w-4 h-4 border-2 border-slate-600 border-t-blue-400 rounded-full animate-spin" />
            Loading key vault...
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary bar */}
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                {vaultKeys.filter((k) => k.configured).length} configured
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-slate-600" />
                {vaultKeys.filter((k) => !k.configured).length} empty
              </span>
              <span className="text-slate-700">|</span>
              <span>AES-256-GCM encrypted at rest</span>
            </div>

            {/* Keys grouped by category */}
            {Object.entries(CATEGORY_LABELS).map(([cat, meta]) => {
              const keys = vaultKeys.filter((k) => k.category === cat);
              if (keys.length === 0) return null;
              return (
                <div key={cat}>
                  <div className="text-xs uppercase tracking-wider text-slate-600 font-medium mb-2 flex items-center gap-1.5">
                    <span>{meta.icon}</span> {meta.label}
                  </div>
                  <div className="space-y-1">
                    {keys.map((k) => (
                      <div key={k.id} className="rounded-lg border border-slate-700/50 overflow-hidden">
                        <button
                          onClick={() => onSetExpandedKey(expandedKey === k.id ? null : k.id)}
                          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-800/50 transition-colors"
                        >
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${k.configured ? "bg-green-400" : "bg-slate-700"}`} />
                          <div className="flex-1 text-left min-w-0">
                            <div className="text-sm text-slate-300 font-medium truncate">{k.name}</div>
                            <div className="text-[10px] text-slate-600 truncate">{k.description}</div>
                          </div>
                          {k.configured && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-900/30 text-green-400 border border-green-800/50 flex-shrink-0">
                              configured
                            </span>
                          )}
                          <svg className={`w-3.5 h-3.5 text-slate-600 transition-transform ${expandedKey === k.id ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </button>

                        {expandedKey === k.id && (
                          <div className="px-3 pb-3 pt-1 bg-slate-800/30 border-t border-slate-700/30">
                            <div className="text-[10px] text-slate-600 mb-1.5 font-mono">{k.envVar}</div>
                            <div className="flex gap-2">
                              <input
                                type="password"
                                value={keyInputs[k.id] || ""}
                                onChange={(e) => onSetKeyInputs((prev) => ({ ...prev, [k.id]: e.target.value }))}
                                onKeyDown={(e) => { if (e.key === "Enter") onSaveVaultKey(k.id); }}
                                placeholder={k.configured ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022  (enter new value to replace)" : k.placeholder || "Enter key..."}
                                className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-600 transition-colors"
                              />
                              <button
                                onClick={() => onSaveVaultKey(k.id)}
                                disabled={!keyInputs[k.id]?.trim() || savingKey === k.id}
                                className={`px-3 py-1.5 rounded text-sm font-medium transition-all ${
                                  keyInputs[k.id]?.trim() && savingKey !== k.id
                                    ? "bg-blue-600 hover:bg-blue-500 text-white"
                                    : "bg-slate-800 text-slate-600 cursor-not-allowed"
                                }`}
                              >
                                {savingKey === k.id ? "..." : savedKeys.has(k.id) ? "\u2713" : "Save"}
                              </button>
                              {k.configured && (
                                <button
                                  onClick={() => onDeleteVaultKey(k.id)}
                                  className="px-2 py-1.5 rounded text-sm text-red-400 hover:bg-red-900/30 transition-colors"
                                  title="Remove key"
                                >
                                  \u2715
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Add Custom Key */}
            <div className="pt-2 border-t border-slate-800">
              {addingCustom ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customKeyName}
                    onChange={(e) => onSetCustomKeyName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") onAddCustomKey(); if (e.key === "Escape") onSetAddingCustom(false); }}
                    placeholder="custom_service_name"
                    autoFocus
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-600 font-mono"
                  />
                  <button
                    onClick={onAddCustomKey}
                    disabled={!customKeyName.trim()}
                    className="px-3 py-1.5 rounded text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:bg-slate-800 disabled:text-slate-600 transition-all"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => { onSetAddingCustom(false); onSetCustomKeyName(""); }}
                    className="px-2 py-1.5 rounded text-sm text-slate-500 hover:text-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => onSetAddingCustom(true)}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  + Add custom key
                </button>
              )}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
