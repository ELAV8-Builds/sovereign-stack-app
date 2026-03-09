/**
 * DataConnectionWizard — Multi-step wizard for creating Canvas pages with data connections
 *
 * Steps:
 * 1. Describe — What do you want to build?
 * 2. Connect — Browse Nango integrations + add custom APIs
 * 3. Building — AI generates the canvas with real data
 * 4. Done — Preview and close
 *
 * The wizard opens as a full-screen overlay from the Canvas component.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  getIntegrationStatus,
  createConnectSession,
  listAvailableIntegrations,
  listConnections,
  syncNangoConnections,
  listWebhooks,
  createWebhook,
  testUrl,
  type StoredConnection,
  type CustomWebhook,
  type DataSource,
  type NangoDataSource,
  type WebhookDataSource,
} from "@/lib/integrations";
import { getVaultStatus, type VaultKeyStatus } from "@/lib/canvas";
import toast from "react-hot-toast";

import type { WizardStep, DataConnectionWizardProps, DiscoveryResult } from "./types";
import { categorizeIntegration } from "./types";
import { ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon, XIcon, SparkleIcon } from "./Icons";
import { DescribeStep } from "./DescribeStep";
import { ConnectStep } from "./ConnectStep";
import { BuildingStep } from "./BuildingStep";

// ── Component ──────────────────────────────────────────────────────────

export function DataConnectionWizard({ onComplete, onCancel }: DataConnectionWizardProps) {
  const [step, setStep] = useState<WizardStep>("describe");

  // Step 1: Describe
  const [description, setDescription] = useState("");
  const [pageName, setPageName] = useState("");

  // Step 2: Connect
  const [nangoConfigured, setNangoConfigured] = useState(false);
  const [availableIntegrations, setAvailableIntegrations] = useState<any[]>([]);
  const [activeConnections, setActiveConnections] = useState<StoredConnection[]>([]);
  const [webhooks, setWebhooks] = useState<CustomWebhook[]>([]);
  const [selectedSources, setSelectedSources] = useState<DataSource[]>([]);
  const [connectTab, setConnectTab] = useState<"nango" | "custom">("nango");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  // Custom API — streamlined URL-only flow
  const [customUrl, setCustomUrl] = useState("");
  const [customAuthToken, setCustomAuthToken] = useState("");
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<DiscoveryResult | null>(null);

  // Vault key status
  const [vaultKeys, setVaultKeys] = useState<VaultKeyStatus[]>([]);

  // Status feed during build
  const [statusMessages, setStatusMessages] = useState<string[]>([]);
  const [isBuilding, setIsBuilding] = useState(false);

  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  // ── Load integration status ─────────────────────────────────────────

  useEffect(() => {
    loadIntegrationData();
  }, []);

  const loadIntegrationData = useCallback(async () => {
    try {
      const status = await getIntegrationStatus();
      setNangoConfigured(status.nangoConfigured);

      if (status.nangoConfigured) {
        const integrations = await listAvailableIntegrations();
        setAvailableIntegrations(integrations?.configs || []);

        // Sync live Nango connections into local DB so existing ones show up
        try {
          const synced = await syncNangoConnections();
          setActiveConnections(synced.connections || []);
        } catch {
          const conns = await listConnections();
          setActiveConnections(conns.connections || []);
        }
      } else {
        const conns = await listConnections();
        setActiveConnections(conns.connections || []);
      }

      const wh = await listWebhooks();
      setWebhooks(wh);

      // Load vault key status
      const keys = await getVaultStatus();
      setVaultKeys(keys);
    } catch {
      // Services might not be ready yet
    }
  }, []);

  // ── Auto-focus ──────────────────────────────────────────────────────

  useEffect(() => {
    if (step === "describe") {
      setTimeout(() => descriptionRef.current?.focus(), 200);
    }
  }, [step]);

  // ── Step 1 → Step 2 ────────────────────────────────────────────────

  const handleDescribeNext = () => {
    if (!description.trim()) return;
    if (!pageName.trim()) {
      setPageName(description.trim().slice(0, 40));
    }
    setStep("connect");
  };

  // ── Nango Connect UI ───────────────────────────────────────────────

  const handleNangoConnect = async (integrationId?: string) => {
    setIsConnecting(true);
    try {
      const session = await createConnectSession({
        allowedIntegrations: integrationId ? [integrationId] : undefined,
      });

      const connectUrl = new URL("https://connect.nango.dev");
      connectUrl.searchParams.set("apiURL", "https://api.nango.dev");
      if (session.token) {
        connectUrl.searchParams.set("session_token", session.token);
      }

      // Open Nango Connect in the system browser (avoids popup blocking in Tauri WebView)
      try {
        await openUrl(connectUrl.toString());
      } catch {
        window.open(connectUrl.toString(), "_blank");
      }

      toast("Opened in your browser — complete the connection there, then come back.", {
        icon: "\u{1F310}",
        duration: 6000,
      });

      // Poll: ask the API to sync live Nango connections into local DB
      const beforeCount = activeConnections.length;
      const pollInterval = setInterval(async () => {
        try {
          const result = await syncNangoConnections();
          if (result.connections.length > beforeCount) {
            clearInterval(pollInterval);
            setActiveConnections(result.connections);
            setIsConnecting(false);
            toast.success("Connection established!");
            loadIntegrationData();
          }
        } catch {
          // API hiccup — keep polling
        }
      }, 3000);

      setTimeout(() => {
        clearInterval(pollInterval);
        setIsConnecting(false);
      }, 300_000);
    } catch (err: any) {
      toast.error(`Failed to connect: ${err.message}`);
      setIsConnecting(false);
    }
  };

  // ── Add Nango connection as data source ─────────────────────────────

  const addNangoSource = (connection: StoredConnection) => {
    const source: NangoDataSource = {
      id: `nango_${connection.connection_id}`,
      type: "nango",
      integrationId: connection.integration_id,
      connectionId: connection.connection_id,
      endpoint: "/", // Will be set by AI during generation
      displayName: connection.display_name || connection.integration_id,
    };

    if (!selectedSources.find(s => s.id === source.id)) {
      setSelectedSources(prev => [...prev, source]);
      toast.success(`Added ${source.displayName}`);
    }
  };

  // ── Add custom webhook as data source ───────────────────────────────

  const addWebhookSource = (webhook: CustomWebhook) => {
    const source: WebhookDataSource = {
      id: `webhook_${webhook.id}`,
      type: "webhook",
      webhookId: webhook.id,
      displayName: webhook.name,
    };

    if (!selectedSources.find(s => s.id === source.id)) {
      setSelectedSources(prev => [...prev, source]);
      toast.success(`Added ${webhook.name}`);
    }
  };

  const removeSource = (id: string) => {
    setSelectedSources(prev => prev.filter(s => s.id !== id));
  };

  // ── Auto-discover custom URL ────────────────────────────────────────

  const handleAutoDiscover = async () => {
    if (!customUrl.trim()) return;
    setIsDiscovering(true);
    setDiscoveryResult(null);

    try {
      const result = await testUrl({
        url: customUrl.trim(),
        method: 'GET',
        headers: customAuthToken ? { 'Authorization': `Bearer ${customAuthToken}` } : {},
      });

      if (result.success) {
        setDiscoveryResult({
          success: true,
          statusCode: result.statusCode,
          contentType: result.contentType,
          schemaHints: result.schemaHints,
        });
      } else if (result.statusCode === 401 || result.statusCode === 403) {
        setDiscoveryResult({
          success: false,
          needsAuth: true,
          statusCode: result.statusCode,
        });
      } else {
        setDiscoveryResult({
          success: false,
          error: `API returned ${result.statusCode}`,
          statusCode: result.statusCode,
        });
      }
    } catch (err: any) {
      setDiscoveryResult({
        success: false,
        error: err.message || 'Could not connect to URL',
      });
    }

    setIsDiscovering(false);
  };

  // ── Auto-save webhook from discovered URL ─────────────────────────

  const handleAutoSaveWebhook = async () => {
    if (!customUrl.trim()) return;

    try {
      // Auto-generate name from URL hostname
      const hostname = new URL(customUrl.trim()).hostname.replace('api.', '').replace('www.', '');
      const domainBase = hostname.split('.')[0];
      const autoName = domainBase.charAt(0).toUpperCase() + domainBase.slice(1) + ' API';

      const authConfig: Record<string, string> = {};
      const authType = customAuthToken ? 'bearer' as const : 'none' as const;
      if (customAuthToken) authConfig.token = customAuthToken;

      const webhook = await createWebhook({
        name: autoName,
        url: customUrl.trim(),
        method: 'GET',
        authType,
        authConfig,
      });

      setWebhooks(prev => [webhook, ...prev]);
      addWebhookSource(webhook);

      // Reset
      setCustomUrl('');
      setCustomAuthToken('');
      setDiscoveryResult(null);

      toast.success(`Connected to ${autoName}`);
    } catch (err: any) {
      toast.error(`Failed to save: ${err.message}`);
    }
  };

  // ── Step 2 → Build (with status feed) ──────────────────────────────

  const handleFinish = async () => {
    setIsBuilding(true);
    setStep("building");
    setStatusMessages([]);

    const addStatus = (msg: string) => setStatusMessages(prev => [...prev, msg]);

    addStatus("Preparing data sources...");

    // Brief pause for each source to show progress
    for (const src of selectedSources) {
      await new Promise(r => setTimeout(r, 400));
      addStatus(`Connecting to ${src.displayName}...`);
    }

    await new Promise(r => setTimeout(r, 500));
    addStatus("Building your dashboard...");

    await new Promise(r => setTimeout(r, 600));

    onComplete({
      prompt: description.trim(),
      dataSources: { sources: selectedSources },
      pageName: pageName.trim() || description.trim().slice(0, 40),
    });
  };

  // ── Filter integrations ────────────────────────────────────────────

  const filteredIntegrations = availableIntegrations.filter(int => {
    const key = (int.unique_key || int.uniqueKey || "").toLowerCase();
    const matchesSearch = !searchQuery || key.includes(searchQuery.toLowerCase());
    const matchesCategory = !selectedCategory || categorizeIntegration(key) === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // ── Step Indicator ─────────────────────────────────────────────────

  const steps: { key: WizardStep; label: string; num: number }[] = [
    { key: "describe", label: "Describe", num: 1 },
    { key: "connect", label: "Connect Data", num: 2 },
  ];

  const currentStepIndex = steps.findIndex(s => s.key === step);

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[90vh] bg-slate-950 border border-white/[0.08] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 flex items-center justify-center">
              <SparkleIcon />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Create Canvas Page</h2>
              <p className="text-[11px] text-slate-500">Connect data and let AI build your interface</p>
            </div>
          </div>

          <button
            onClick={onCancel}
            className="p-2 rounded-lg hover:bg-white/[0.06] text-slate-500 hover:text-white transition-colors"
          >
            <XIcon />
          </button>
        </div>

        {/* ── Step Indicator ────────────────────────────────────────── */}
        <div className="px-6 py-3 border-b border-white/[0.04] flex items-center gap-2">
          {steps.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                i < currentStepIndex
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : i === currentStepIndex
                    ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                    : "bg-white/[0.03] text-slate-600 border border-white/[0.06]"
              }`}>
                {i < currentStepIndex ? (
                  <CheckCircleIcon />
                ) : (
                  <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold">{s.num}</span>
                )}
                {s.label}
              </div>
              {i < steps.length - 1 && (
                <div className={`w-8 h-px ${i < currentStepIndex ? "bg-emerald-500/30" : "bg-white/[0.06]"}`} />
              )}
            </div>
          ))}
        </div>

        {/* ── Content ──────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {/* ═══ STEP 1: DESCRIBE ═══ */}
          {step === "describe" && (
            <DescribeStep
              description={description}
              setDescription={setDescription}
              pageName={pageName}
              setPageName={setPageName}
              descriptionRef={descriptionRef}
              onNext={handleDescribeNext}
            />
          )}

          {/* ═══ STEP 2: CONNECT DATA ═══ */}
          {step === "connect" && (
            <ConnectStep
              selectedSources={selectedSources}
              removeSource={removeSource}
              vaultKeys={vaultKeys}
              connectTab={connectTab}
              setConnectTab={setConnectTab}
              nangoConfigured={nangoConfigured}
              activeConnections={activeConnections}
              addNangoSource={addNangoSource}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
              filteredIntegrations={filteredIntegrations}
              availableIntegrations={availableIntegrations}
              isConnecting={isConnecting}
              handleNangoConnect={handleNangoConnect}
              webhooks={webhooks}
              addWebhookSource={addWebhookSource}
              customUrl={customUrl}
              setCustomUrl={setCustomUrl}
              customAuthToken={customAuthToken}
              setCustomAuthToken={setCustomAuthToken}
              isDiscovering={isDiscovering}
              discoveryResult={discoveryResult}
              handleAutoDiscover={handleAutoDiscover}
              handleAutoSaveWebhook={handleAutoSaveWebhook}
            />
          )}

          {/* ═══ BUILDING STEP: Status Feed ═══ */}
          {step === "building" && (
            <BuildingStep statusMessages={statusMessages} />
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────── */}
        {step !== "building" && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-white/[0.06]">
            <button
              onClick={step === "describe" ? onCancel : () => setStep("describe")}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all"
            >
              <ArrowLeftIcon />
              {step === "describe" ? "Cancel" : "Back"}
            </button>

            {step === "describe" ? (
              <button
                onClick={handleDescribeNext}
                disabled={!description.trim()}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-medium transition-all"
              >
                Next <ArrowRightIcon />
              </button>
            ) : step === "connect" ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleFinish}
                  disabled={isBuilding}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all disabled:opacity-50"
                >
                  <SparkleIcon />
                  {selectedSources.length > 0 ? "Build with Data" : "Build without Data"}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
