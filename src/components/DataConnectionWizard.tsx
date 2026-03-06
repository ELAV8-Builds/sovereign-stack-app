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
import Nango from "@nangohq/frontend";
import {
  getIntegrationStatus,
  createConnectSession,
  listAvailableIntegrations,
  listConnections,
  listWebhooks,
  createWebhook,
  testUrl,
  type StoredConnection,
  type CustomWebhook,
  type DataSource,
  type NangoDataSource,
  type WebhookDataSource,
  type DataSourceConfig,
} from "@/lib/integrations";
import toast from "react-hot-toast";

// ── Types ──────────────────────────────────────────────────────────────

type WizardStep = "describe" | "connect" | "building" | "done";

interface DataConnectionWizardProps {
  onComplete: (result: {
    prompt: string;
    dataSources: DataSourceConfig;
    pageName: string;
  }) => void;
  onCancel: () => void;
}

// ── Integration Categories ─────────────────────────────────────────────

const INTEGRATION_CATEGORIES: { id: string; label: string; icon: string; keywords: string[] }[] = [
  { id: "crm", label: "CRM", icon: "👥", keywords: ["hubspot", "salesforce", "pipedrive", "zoho", "attio", "close", "copper"] },
  { id: "accounting", label: "Accounting", icon: "📒", keywords: ["quickbooks", "xero", "freshbooks", "wave", "sage"] },
  { id: "dev", label: "Developer", icon: "💻", keywords: ["github", "gitlab", "bitbucket", "jira", "linear", "notion"] },
  { id: "comms", label: "Communication", icon: "💬", keywords: ["slack", "discord", "teams", "twilio", "intercom"] },
  { id: "productivity", label: "Productivity", icon: "⚡", keywords: ["google", "microsoft", "airtable", "asana", "monday", "clickup"] },
  { id: "ecommerce", label: "E-commerce", icon: "🛒", keywords: ["shopify", "stripe", "woocommerce", "square", "paypal"] },
  { id: "analytics", label: "Analytics", icon: "📈", keywords: ["amplitude", "mixpanel", "segment", "google-analytics", "plausible"] },
  { id: "marketing", label: "Marketing", icon: "📣", keywords: ["mailchimp", "sendgrid", "klaviyo", "brevo", "activecampaign"] },
  { id: "storage", label: "Storage", icon: "📁", keywords: ["google-drive", "dropbox", "onedrive", "box", "s3"] },
  { id: "other", label: "Other", icon: "🔗", keywords: [] },
];

function categorizeIntegration(uniqueKey: string): string {
  const lower = uniqueKey.toLowerCase();
  for (const cat of INTEGRATION_CATEGORIES) {
    if (cat.keywords.some(kw => lower.includes(kw))) return cat.id;
  }
  return "other";
}

// ── Icons ──────────────────────────────────────────────────────────────

const ArrowLeftIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

const ArrowRightIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

const CheckCircleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const XIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const SparkleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-5 h-5">
    <path d="M12 2L9 12l-7 3 7 3 3 10 3-10 7-3-7-3z" />
  </svg>
);

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const GlobeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-5 h-5">
    <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const LinkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-4 h-4">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

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

  // Custom webhook form
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const [customName, setCustomName] = useState("");
  const [customMethod, setCustomMethod] = useState("GET");
  const [customAuthType, setCustomAuthType] = useState<"none" | "bearer" | "api_key" | "basic">("none");
  const [customAuthToken, setCustomAuthToken] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

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
      }

      const conns = await listConnections();
      setActiveConnections(conns.connections || []);

      const wh = await listWebhooks();
      setWebhooks(wh);
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

      const nango = new Nango({});
      const connect = nango.openConnectUI({
        onEvent: (event: any) => {
          if (event.type === "close") {
            setIsConnecting(false);
            // Refresh connections after modal closes
            loadIntegrationData();
          } else if (event.type === "connect") {
            toast.success("Connection established!");
            setIsConnecting(false);
            loadIntegrationData();
          }
        },
      });

      connect.setSessionToken(session.token);
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

  // ── Test custom URL ─────────────────────────────────────────────────

  const handleTestUrl = async () => {
    if (!customUrl.trim()) return;
    setIsTesting(true);
    setTestResult(null);

    try {
      const headers: Record<string, string> = {};
      if (customAuthType === "bearer" && customAuthToken) {
        headers["Authorization"] = `Bearer ${customAuthToken}`;
      }

      const result = await testUrl({
        url: customUrl.trim(),
        method: customMethod,
        headers,
      });

      setTestResult(result);
      if (result.success) {
        toast.success(`API responded with ${result.statusCode}`);
      } else {
        toast.error(`API returned ${result.statusCode}`);
      }
    } catch (err: any) {
      setTestResult({ success: false, error: err.message });
      toast.error(err.message);
    }
    setIsTesting(false);
  };

  // ── Save custom webhook ─────────────────────────────────────────────

  const handleSaveCustomWebhook = async () => {
    if (!customUrl.trim() || !customName.trim()) return;

    try {
      const authConfig: Record<string, string> = {};
      if (customAuthType === "bearer") authConfig.token = customAuthToken;

      const webhook = await createWebhook({
        name: customName.trim(),
        url: customUrl.trim(),
        method: customMethod,
        authType: customAuthType,
        authConfig,
      });

      setWebhooks(prev => [webhook, ...prev]);
      addWebhookSource(webhook);

      // Reset form
      setShowCustomForm(false);
      setCustomUrl("");
      setCustomName("");
      setCustomMethod("GET");
      setCustomAuthType("none");
      setCustomAuthToken("");
      setTestResult(null);
    } catch (err: any) {
      toast.error(`Failed to save: ${err.message}`);
    }
  };

  // ── Step 2 → Complete ──────────────────────────────────────────────

  const handleFinish = () => {
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
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  What do you want to see on this page?
                </label>
                <textarea
                  ref={descriptionRef}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. A sales dashboard showing my HubSpot deals by stage, revenue metrics, and a table of recent activities..."
                  rows={4}
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20 resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.metaKey) handleDescribeNext();
                  }}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  Page name <span className="text-slate-600">(optional)</span>
                </label>
                <input
                  value={pageName}
                  onChange={(e) => setPageName(e.target.value)}
                  placeholder="Auto-generated from description"
                  className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20"
                />
              </div>

              {/* Quick templates */}
              <div>
                <p className="text-xs font-medium text-slate-500 mb-2">Quick start</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "Sales Dashboard", desc: "CRM deals, pipeline stages, and revenue metrics" },
                    { label: "Customer Activity", desc: "Recent customer interactions, support tickets, and engagement" },
                    { label: "Revenue Report", desc: "Monthly revenue, growth trends, and financial KPIs" },
                    { label: "Project Status", desc: "Task progress, team workload, and milestone tracking" },
                  ].map((t) => (
                    <button
                      key={t.label}
                      onClick={() => {
                        setDescription(t.desc);
                        setPageName(t.label);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-slate-400 hover:text-white hover:bg-white/[0.06] hover:border-indigo-500/20 transition-all"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ═══ STEP 2: CONNECT DATA ═══ */}
          {step === "connect" && (
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
                                    {INTEGRATION_CATEGORIES.find(c => c.id === categorizeIntegration(key))?.icon || "🔗"}
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

              {/* ── Custom API Tab ─────────────────────────────────── */}
              {connectTab === "custom" && (
                <div className="space-y-3">
                  {/* Existing webhooks */}
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

                  {/* Add custom API */}
                  {!showCustomForm ? (
                    <button
                      onClick={() => setShowCustomForm(true)}
                      className="w-full flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed border-white/[0.08] hover:border-indigo-500/20 text-xs text-slate-500 hover:text-slate-300 transition-all"
                    >
                      <PlusIcon /> Add Custom API Endpoint
                    </button>
                  ) : (
                    <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-slate-300">New Custom API</p>
                        <button
                          onClick={() => {
                            setShowCustomForm(false);
                            setTestResult(null);
                          }}
                          className="text-slate-500 hover:text-white"
                        >
                          <XIcon />
                        </button>
                      </div>

                      <input
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        placeholder="Connection name (e.g. 'My CRM API')"
                        className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/30"
                      />

                      <div className="flex gap-2">
                        <select
                          value={customMethod}
                          onChange={(e) => setCustomMethod(e.target.value)}
                          className="px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-white focus:outline-none focus:border-indigo-500/30"
                        >
                          <option value="GET">GET</option>
                          <option value="POST">POST</option>
                          <option value="PUT">PUT</option>
                        </select>
                        <input
                          value={customUrl}
                          onChange={(e) => setCustomUrl(e.target.value)}
                          placeholder="https://api.example.com/data"
                          className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/30"
                        />
                      </div>

                      {/* Auth */}
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500">Auth:</span>
                        {(["none", "bearer", "api_key", "basic"] as const).map((at) => (
                          <button
                            key={at}
                            onClick={() => setCustomAuthType(at)}
                            className={`px-2 py-1 rounded text-[10px] transition-all ${
                              customAuthType === at
                                ? "bg-indigo-500/15 text-indigo-400 border border-indigo-500/20"
                                : "bg-white/[0.03] text-slate-500 border border-white/[0.06]"
                            }`}
                          >
                            {at === "none" ? "None" : at === "bearer" ? "Bearer" : at === "api_key" ? "API Key" : "Basic"}
                          </button>
                        ))}
                      </div>

                      {customAuthType !== "none" && (
                        <input
                          value={customAuthToken}
                          onChange={(e) => setCustomAuthToken(e.target.value)}
                          placeholder={
                            customAuthType === "bearer" ? "Bearer token"
                            : customAuthType === "api_key" ? "API key"
                            : "username:password"
                          }
                          type="password"
                          className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/30"
                        />
                      )}

                      {/* Test result */}
                      {testResult && (
                        <div className={`p-3 rounded-lg text-xs ${
                          testResult.success
                            ? "bg-emerald-500/5 border border-emerald-500/20 text-emerald-400"
                            : "bg-red-500/5 border border-red-500/20 text-red-400"
                        }`}>
                          <p className="font-medium mb-1">
                            {testResult.success ? `Success (${testResult.statusCode})` : `Failed${testResult.statusCode ? ` (${testResult.statusCode})` : ""}`}
                          </p>
                          {testResult.schemaHints && (
                            <p className="text-[10px] text-slate-400 mt-1">
                              Schema: {JSON.stringify(testResult.schemaHints).slice(0, 200)}...
                            </p>
                          )}
                          {testResult.error && (
                            <p className="text-[10px]">{testResult.error}</p>
                          )}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2">
                        <button
                          onClick={handleTestUrl}
                          disabled={!customUrl.trim() || isTesting}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-slate-300 hover:bg-white/[0.06] disabled:opacity-50 transition-all"
                        >
                          {isTesting ? (
                            <div className="animate-spin w-3 h-3 border border-slate-500 border-t-transparent rounded-full" />
                          ) : null}
                          Test
                        </button>
                        <button
                          onClick={handleSaveCustomWebhook}
                          disabled={!customUrl.trim() || !customName.trim()}
                          className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white disabled:opacity-50 transition-all"
                        >
                          Save & Add
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────── */}
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
                disabled={false}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all"
              >
                <SparkleIcon />
                {selectedSources.length > 0 ? "Build with Data" : "Build without Data"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
