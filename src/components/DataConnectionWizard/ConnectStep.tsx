/**
 * ConnectStep — Step 2: Browse Nango integrations + add custom APIs
 */
import { CheckCircleIcon, XIcon, GlobeIcon, LinkIcon, PlusIcon } from "./Icons";
import {
  INTEGRATION_CATEGORIES,
  categorizeIntegration,
  type DataSource,
  type NangoDataSource,
  type WebhookDataSource,
  type StoredConnection,
  type CustomWebhook,
  type DiscoveryResult,
} from "./types";
import type { VaultKeyStatus } from "@/lib/canvas";

interface ConnectStepProps {
  selectedSources: DataSource[];
  removeSource: (id: string) => void;
  vaultKeys: VaultKeyStatus[];
  connectTab: "nango" | "custom";
  setConnectTab: (tab: "nango" | "custom") => void;

  // Nango
  nangoConfigured: boolean;
  activeConnections: StoredConnection[];
  addNangoSource: (connection: StoredConnection) => void;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  selectedCategory: string | null;
  setSelectedCategory: (val: string | null) => void;
  filteredIntegrations: any[];
  availableIntegrations: any[];
  isConnecting: boolean;
  handleNangoConnect: (integrationId?: string) => void;

  // Custom API
  webhooks: CustomWebhook[];
  addWebhookSource: (webhook: CustomWebhook) => void;
  customUrl: string;
  setCustomUrl: (val: string) => void;
  customAuthToken: string;
  setCustomAuthToken: (val: string) => void;
  isDiscovering: boolean;
  discoveryResult: DiscoveryResult | null;
  handleAutoDiscover: () => void;
  handleAutoSaveWebhook: () => void;
}

export function ConnectStep({
  selectedSources,
  removeSource,
  vaultKeys,
  connectTab,
  setConnectTab,
  nangoConfigured,
  activeConnections,
  addNangoSource,
  searchQuery,
  setSearchQuery,
  selectedCategory,
  setSelectedCategory,
  filteredIntegrations,
  availableIntegrations,
  isConnecting,
  handleNangoConnect,
  webhooks,
  addWebhookSource,
  customUrl,
  setCustomUrl,
  customAuthToken,
  setCustomAuthToken,
  isDiscovering,
  discoveryResult,
  handleAutoDiscover,
  handleAutoSaveWebhook,
}: ConnectStepProps) {
  return (
    <div className="p-6 space-y-4">
      {/* Selected sources */}
      {selectedSources.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-400">Connected data sources</p>
          <div className="flex flex-wrap gap-2">
            {selectedSources.map((src) => (
              <div
                key={src.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400"
              >
                <CheckCircleIcon />
                {src.displayName}
                <button
                  onClick={() => removeSource(src.id)}
                  className="ml-1 hover:text-red-400 transition-colors"
                >
                  <XIcon />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Vault key status */}
      {vaultKeys.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
          <span className="text-[10px] text-slate-500 font-medium">Keys:</span>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1 text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-slate-400">{vaultKeys.filter(k => k.configured).length} configured</span>
            </span>
            {vaultKeys.filter(k => !k.configured).length > 0 && (
              <span className="flex items-center gap-1 text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                <span className="text-slate-500">{vaultKeys.filter(k => !k.configured).length} missing</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Source type tabs */}
      <div className="flex items-center gap-1 bg-white/[0.03] rounded-xl p-1">
        <button
          onClick={() => setConnectTab("nango")}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            connectTab === "nango"
              ? "bg-white/[0.08] text-white"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          <GlobeIcon /> Browse Integrations
        </button>
        <button
          onClick={() => setConnectTab("custom")}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            connectTab === "custom"
              ? "bg-white/[0.08] text-white"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          <LinkIcon /> Custom API
        </button>
      </div>

      {/* ── Nango Integrations Tab ──────────────────────────── */}
      {connectTab === "nango" && (
        <div className="space-y-3">
          {!nangoConfigured ? (
            <div className="p-6 text-center rounded-xl bg-amber-500/5 border border-amber-500/20">
              <p className="text-sm text-amber-400 mb-1">Nango not configured</p>
              <p className="text-xs text-slate-500">
                Set NANGO_SECRET_KEY in your environment to enable 700+ API integrations.
              </p>
            </div>
          ) : (
            <>
              {/* Existing connections */}
              {activeConnections.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-2">Your connections</p>
                  <div className="grid grid-cols-2 gap-2">
                    {activeConnections.map((conn) => {
                      const isSelected = selectedSources.some(
                        s => s.type === "nango" && (s as NangoDataSource).connectionId === conn.connection_id
                      );
                      return (
                        <button
                          key={conn.id}
                          onClick={() => !isSelected && addNangoSource(conn)}
                          disabled={isSelected}
                          className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all ${
                            isSelected
                              ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-400"
                              : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-indigo-500/20 text-slate-300"
                          }`}
                        >
                          {isSelected ? <CheckCircleIcon /> : <GlobeIcon />}
                          <div>
                            <p className="text-xs font-medium">{conn.display_name}</p>
                            <p className="text-[10px] text-slate-500">{conn.integration_id}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Browse integrations */}
              <div>
                <p className="text-xs font-medium text-slate-400 mb-2">Add new connection</p>
                {/* Search */}
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search integrations..."
                  className="w-full px-4 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/30 mb-3"
                />

                {/* Categories */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <button
                    onClick={() => setSelectedCategory(null)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                      !selectedCategory
                        ? "bg-indigo-500/15 text-indigo-400 border border-indigo-500/20"
                        : "bg-white/[0.03] text-slate-500 border border-white/[0.06] hover:text-slate-300"
                    }`}
                  >
                    All
                  </button>
                  {INTEGRATION_CATEGORIES.filter(c => c.id !== "other").map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                        selectedCategory === cat.id
                          ? "bg-indigo-500/15 text-indigo-400 border border-indigo-500/20"
                          : "bg-white/[0.03] text-slate-500 border border-white/[0.06] hover:text-slate-300"
                      }`}
                    >
                      {cat.icon} {cat.label}
                    </button>
                  ))}
                </div>

                {/* Integration grid */}
                <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
                  {filteredIntegrations.length === 0 ? (
                    <div className="col-span-3 p-4 text-center text-xs text-slate-600">
                      {availableIntegrations.length === 0
                        ? "No integrations configured in Nango yet"
                        : "No matching integrations"}
                    </div>
                  ) : (
                    filteredIntegrations.map((int: any) => {
                      const key = int.unique_key || int.uniqueKey;
                      return (
                        <button
                          key={key}
                          onClick={() => handleNangoConnect(key)}
                          disabled={isConnecting}
                          className="flex items-center gap-2 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.04] hover:border-indigo-500/20 text-xs text-slate-300 hover:text-white transition-all text-left disabled:opacity-50"
                        >
                          <span className="text-sm">
                            {INTEGRATION_CATEGORIES.find(c => c.id === categorizeIntegration(key))?.icon || "\u{1F517}"}
                          </span>
                          <span className="truncate">{key}</span>
                        </button>
                      );
                    })
                  )}
                </div>

                {/* Generic connect button */}
                <button
                  onClick={() => handleNangoConnect()}
                  disabled={isConnecting}
                  className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs font-medium text-indigo-400 hover:bg-indigo-500/15 transition-all disabled:opacity-50"
                >
                  {isConnecting ? (
                    <div className="animate-spin w-3 h-3 border border-indigo-500 border-t-transparent rounded-full" />
                  ) : (
                    <PlusIcon />
                  )}
                  {isConnecting ? "Connecting..." : "Connect New Service"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Custom API Tab — Streamlined URL-only flow ──── */}
      {connectTab === "custom" && (
        <div className="space-y-3">
          {/* Existing saved webhooks */}
          {webhooks.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-400 mb-2">Saved APIs</p>
              <div className="space-y-1.5">
                {webhooks.map((wh) => {
                  const isSelected = selectedSources.some(
                    s => s.type === "webhook" && (s as WebhookDataSource).webhookId === wh.id
                  );
                  return (
                    <button
                      key={wh.id}
                      onClick={() => !isSelected && addWebhookSource(wh)}
                      disabled={isSelected}
                      className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                        isSelected
                          ? "bg-emerald-500/5 border-emerald-500/20"
                          : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-indigo-500/20"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {isSelected ? (
                          <span className="text-emerald-400"><CheckCircleIcon /></span>
                        ) : (
                          <span className="text-slate-500"><LinkIcon /></span>
                        )}
                        <div>
                          <p className="text-xs font-medium text-slate-300">{wh.name}</p>
                          <p className="text-[10px] text-slate-500 truncate max-w-xs">{wh.method} {wh.url}</p>
                        </div>
                      </div>
                      {wh.last_test_result && (
                        <span className={`text-[10px] ${wh.last_test_result.success ? "text-emerald-400" : "text-red-400"}`}>
                          {wh.last_test_result.success ? "Tested" : "Failed"}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Simplified URL-only input */}
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-3">
            <p className="text-xs font-medium text-slate-300">Connect to any API</p>
            <p className="text-[11px] text-slate-500">Just paste the endpoint URL — we'll figure out the rest</p>

            <div className="flex gap-2">
              <input
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://api.example.com/v1/data"
                className="flex-1 px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/30"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customUrl.trim()) handleAutoDiscover();
                }}
              />
              <button
                onClick={handleAutoDiscover}
                disabled={!customUrl.trim() || isDiscovering}
                className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white disabled:opacity-50 transition-all flex items-center gap-1.5"
              >
                {isDiscovering ? (
                  <div className="animate-spin w-3 h-3 border border-white border-t-transparent rounded-full" />
                ) : (
                  <LinkIcon />
                )}
                {isDiscovering ? 'Discovering...' : 'Connect'}
              </button>
            </div>

            {/* Discovery result */}
            {discoveryResult && (
              <div className={`p-3 rounded-lg text-xs ${
                discoveryResult.success
                  ? "bg-emerald-500/5 border border-emerald-500/20"
                  : discoveryResult.needsAuth
                    ? "bg-amber-500/5 border border-amber-500/20"
                    : "bg-red-500/5 border border-red-500/20"
              }`}>
                {discoveryResult.success ? (
                  <>
                    <p className="text-emerald-400 font-medium">API responded ({discoveryResult.statusCode})</p>
                    <p className="text-slate-400 mt-1">
                      {discoveryResult.contentType?.includes('json')
                        ? `JSON response with ${Object.keys(discoveryResult.schemaHints || {}).length} fields detected`
                        : `${discoveryResult.contentType || 'Unknown'} response`}
                    </p>
                  </>
                ) : discoveryResult.needsAuth ? (
                  <>
                    <p className="text-amber-400 font-medium">Authentication required</p>
                    <p className="text-slate-400 mt-1">This API needs a key or token to access</p>
                  </>
                ) : (
                  <p className="text-red-400">{discoveryResult.error || 'Could not connect'}</p>
                )}
              </div>
            )}

            {/* Auth input — only shown when needed */}
            {discoveryResult?.needsAuth && (
              <div className="space-y-2">
                <input
                  value={customAuthToken}
                  onChange={(e) => setCustomAuthToken(e.target.value)}
                  placeholder="API key or Bearer token"
                  type="password"
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/30"
                />
                {customAuthToken && (
                  <button
                    onClick={handleAutoDiscover}
                    disabled={isDiscovering}
                    className="w-full px-3 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-xs font-medium text-indigo-400 hover:bg-indigo-500/15 transition-all"
                  >
                    Retry with token
                  </button>
                )}
              </div>
            )}

            {/* Auto-save button after successful discovery */}
            {discoveryResult?.success && (
              <button
                onClick={handleAutoSaveWebhook}
                className="w-full px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-medium text-white transition-all"
              >
                Add as Data Source
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
