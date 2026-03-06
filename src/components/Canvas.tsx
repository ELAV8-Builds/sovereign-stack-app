/**
 * Canvas — Persistent visual workspace powered by json-render
 *
 * Users create "pages" that the AI generates as interactive dashboards,
 * reports, mockups, or data views. Pages persist in PostgreSQL and can
 * be edited, renamed, duplicated, or deleted.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { Renderer, JSONUIProvider } from "@json-render/react";
import type { Spec } from "@json-render/core";
import { canvasRegistry, elementsToSpec, type SpecElement } from "@/lib/canvas-catalog";
import {
  listCanvasPages,
  createCanvasPage,
  updateCanvasPage,
  deleteCanvasPage,
  duplicateCanvasPage,
  generateCanvasUI,
  refreshCanvasData,
  getVaultStatus,
  type CanvasPage,
  type VaultKeyStatus,
} from "@/lib/canvas";
import { DataConnectionWizard } from "./DataConnectionWizard";
import type { DataSourceConfig } from "@/lib/integrations";
import toast from "react-hot-toast";

// ── Icons ──────────────────────────────────────────────────────────────

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-3.5 h-3.5">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-3.5 h-3.5">
    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const EditIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-3.5 h-3.5">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const SparkleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-4 h-4">
    <path d="M12 2L9 12l-7 3 7 3 3 10 3-10 7-3-7-3z" />
  </svg>
);

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-3.5 h-3.5">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-3.5 h-3.5">
    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

const DataIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-3.5 h-3.5">
    <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </svg>
);

// ── Component ──────────────────────────────────────────────────────────

export function Canvas() {
  const [pages, setPages] = useState<CanvasPage[]>([]);
  const [activePage, setActivePage] = useState<CanvasPage | null>(null);
  const [activeSpec, setActiveSpec] = useState<Spec | null>(null);
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [showWizard, setShowWizard] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [vaultKeys, setVaultKeys] = useState<VaultKeyStatus[]>([]);
  const abortRef = useRef<(() => void) | null>(null);
  const elementsRef = useRef<SpecElement[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Load pages ─────────────────────────────────────────────────────

  const loadPages = useCallback(async () => {
    try {
      const result = await listCanvasPages();
      setPages(result);
      // If we have an active page, refresh it
      if (activePage) {
        const refreshed = result.find(p => p.id === activePage.id);
        if (refreshed) setActivePage(refreshed);
      }
    } catch {
      // API might not be ready
    } finally {
      setIsLoading(false);
    }
  }, [activePage]);

  useEffect(() => {
    loadPages();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load vault status for smart suggestions ─────────────────────────

  useEffect(() => {
    getVaultStatus().then(setVaultKeys).catch(() => {});
  }, []);

  // ── Select a page ──────────────────────────────────────────────────

  const selectPage = useCallback((page: CanvasPage) => {
    setActivePage(page);
    if (page.spec) {
      setActiveSpec(page.spec as unknown as Spec);
    } else {
      setActiveSpec(null);
    }
    setPrompt("");
  }, []);

  // ── Create new page (opens wizard) ─────────────────────────────────

  const handleNewPage = () => {
    setShowWizard(true);
  };

  const handleQuickNewPage = async () => {
    try {
      const page = await createCanvasPage({ name: "Untitled Page" });
      setPages(prev => [page, ...prev]);
      selectPage(page);
      setTimeout(() => inputRef.current?.focus(), 100);
      toast.success("New page created");
    } catch {
      toast.error("Failed to create page");
    }
  };

  const handleWizardComplete = async (result: {
    prompt: string;
    dataSources: DataSourceConfig;
    pageName: string;
  }) => {
    setShowWizard(false);

    try {
      // Create the page with data source config
      const page = await createCanvasPage({
        name: result.pageName,
      });

      // Save data sources to the page
      if (result.dataSources.sources.length > 0) {
        await updateCanvasPage(page.id, {
          data_sources: result.dataSources as any,
        });
      }

      setPages(prev => [page, ...prev]);
      setActivePage(page);

      // Build a context-enriched prompt that includes data source info
      let enrichedPrompt = result.prompt;
      if (result.dataSources.sources.length > 0) {
        const sourceDescriptions = result.dataSources.sources
          .map(s => {
            if (s.type === "nango") return `Connected: ${s.displayName} (${s.integrationId})`;
            if (s.type === "webhook") return `Custom API: ${s.displayName}`;
            return "";
          })
          .filter(Boolean)
          .join(", ");
        enrichedPrompt += `\n\nData sources available: ${sourceDescriptions}. Design the UI to display this data effectively.`;
      }

      // Auto-start generation with the enriched prompt + pass data sources
      setPrompt(enrichedPrompt);
      generateForPage(page, enrichedPrompt, result.dataSources);
    } catch {
      toast.error("Failed to create page");
    }
  };

  // ── Delete page ────────────────────────────────────────────────────

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDeletePage = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      setTimeout(() => setConfirmDeleteId(null), 3000);
      return;
    }
    try {
      await deleteCanvasPage(id);
      setPages(prev => prev.filter(p => p.id !== id));
      if (activePage?.id === id) {
        setActivePage(null);
        setActiveSpec(null);
      }
      toast.success("Page deleted");
    } catch {
      toast.error("Failed to delete page");
    }
    setConfirmDeleteId(null);
  };

  // ── Duplicate page ─────────────────────────────────────────────────

  const handleDuplicate = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const page = await duplicateCanvasPage(id, `${name} (copy)`);
      setPages(prev => [page, ...prev]);
      toast.success("Page duplicated");
    } catch {
      toast.error("Failed to duplicate page");
    }
  };

  // ── Rename page ────────────────────────────────────────────────────

  const startRename = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingName(id);
    setEditNameValue(name);
  };

  const saveRename = async (id: string) => {
    if (!editNameValue.trim()) return;
    try {
      const updated = await updateCanvasPage(id, { name: editNameValue.trim() });
      setPages(prev => prev.map(p => p.id === id ? updated : p));
      if (activePage?.id === id) setActivePage(updated);
    } catch {
      toast.error("Failed to rename page");
    }
    setEditingName(null);
  };

  // ── Generate UI ────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
    if (!activePage) {
      // Auto-create a page if none selected
      try {
        const page = await createCanvasPage({
          name: prompt.trim().slice(0, 40),
        });
        setPages(prev => [page, ...prev]);
        setActivePage(page);
        generateForPage(page, prompt.trim());
      } catch {
        toast.error("Failed to create page");
      }
      return;
    }

    generateForPage(activePage, prompt.trim());
  };

  const generateForPage = (page: CanvasPage, userPrompt: string, dataSources?: DataSourceConfig) => {
    setIsGenerating(true);
    elementsRef.current = [];

    const abort = generateCanvasUI(
      userPrompt,
      {
        onElement: (element) => {
          elementsRef.current.push(element as SpecElement);
          const spec = elementsToSpec([...elementsRef.current]);
          if (spec) setActiveSpec(spec);
        },
        onIntegrationStatus: (event) => {
          if (event.status === 'missing_key') {
            toast(event.message, { icon: '\u26A0\uFE0F', duration: 6000 });
          } else if (event.status === 'connected') {
            toast.success(`${event.service} connected`, { duration: 3000 });
          }
        },
        onError: (error) => {
          toast.error(`Generation failed: ${error}`);
          setIsGenerating(false);
        },
        onComplete: async () => {
          setIsGenerating(false);
          setPrompt("");

          // Save the spec to the page
          const finalSpec = elementsToSpec(elementsRef.current);
          if (finalSpec && page) {
            try {
              const updated = await updateCanvasPage(page.id, {
                spec: finalSpec as any,
                name: page.name === "Untitled Page" ? userPrompt.slice(0, 40) : page.name,
              });
              setPages(prev => prev.map(p => p.id === page.id ? updated : p));
              setActivePage(updated);
              toast.success("Page saved");
            } catch {
              toast.error("Failed to save page");
            }
          }
        },
      },
      {
        currentSpec: activeSpec ? (activeSpec as any) : undefined,
        pageId: page.id,
        dataSources: dataSources ? (dataSources as any) : undefined,
      }
    );

    abortRef.current = abort;
  };

  const handleStop = () => {
    abortRef.current?.();
    setIsGenerating(false);
  };

  // ── Refresh data + re-generate ──────────────────────────────────────
  const handleRefreshData = async () => {
    if (!activePage || isRefreshing || isGenerating) return;

    setIsRefreshing(true);
    try {
      const result = await refreshCanvasData(activePage.id);
      toast.success(`Refreshed ${result.data.filter((d: any) => !d.error).length} source(s)`);

      // Auto-re-generate with refreshed data
      const refreshPrompt = activeSpec
        ? `Update this dashboard with the latest data. Keep the same layout and structure, but update all values with the fresh data.`
        : `Build a dashboard using the connected data sources.`;

      generateForPage(activePage, refreshPrompt);
    } catch (err: any) {
      toast.error(err.message || "Failed to refresh data");
    } finally {
      setIsRefreshing(false);
    }
  };

  // ── Key handler for prompt ─────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  // ── Smart suggestion definitions ────────────────────────────────────

  const SMART_SUGGESTIONS = [
    // Available when specific vault keys are configured
    { keys: ['slack_bot'], icon: '\u{1F4AC}', title: 'Slack Priority Briefing', prompt: 'Connect to Slack, scan my channels, and build a priority briefing showing urgent messages, action items, and key decisions I need to make', service: 'Slack' },
    { keys: ['brave_search'], icon: '\u{1F50D}', title: 'Competitive Intelligence', prompt: 'Research my top 5 competitors using web search and build a comparison dashboard with pricing, features, and market positioning', service: 'Brave Search' },
    { keys: ['openai', 'anthropic'], icon: '\u{1F3D7}\uFE0F', title: 'Architecture Overview', prompt: 'Analyze the codebase in this workspace and generate an architecture diagram with component dependencies, data flow, and tech stack summary', service: 'AI Analysis' },
    { keys: ['elevenlabs'], icon: '\u{1F399}\uFE0F', title: 'Voice Content Studio', prompt: 'Create a voice content dashboard where I can write scripts, generate audio previews, and manage my voice content library', service: 'ElevenLabs' },
    // Always available (no vault key requirement)
    { keys: [] as string[], icon: '\u{1F4CA}', title: 'Connect to Notion & Summarize Marketing', prompt: 'Connect to my Notion workspace, find all marketing-related pages and databases, and build a summary dashboard with campaign status, content calendar, and key metrics', service: 'Custom API' },
    { keys: [] as string[], icon: '\u{1F4B0}', title: 'QuickBooks P&L with CPA Advice', prompt: 'Connect to QuickBooks, pull my Profit & Loss statement, and build an interactive financial dashboard with AI-powered CPA-level advice on tax optimization and cash flow', service: 'Custom API' },
    { keys: [] as string[], icon: '\u{1F4E7}', title: 'Email Triage & Priority Board', prompt: 'Connect to my email, scan the last 48 hours, and build a triage board showing urgent items, follow-ups needed, and emails I can safely archive', service: 'Custom API' },
    { keys: [] as string[], icon: '\u{1F4C8}', title: 'Build a Live API Dashboard', prompt: 'I want to connect to a custom API endpoint and build a real-time monitoring dashboard that auto-refreshes with the latest data', service: 'Any API' },
  ];

  // ── Empty state ────────────────────────────────────────────────────

  const EmptyState = () => {
    const configuredIds = new Set(vaultKeys.filter(k => k.configured).map(k => k.id));
    const configuredCount = configuredIds.size;

    // Prioritize suggestions: ones with ALL required keys configured first, then always-available
    const keyed = SMART_SUGGESTIONS
      .filter(s => s.keys.length > 0 && s.keys.every(k => configuredIds.has(k)));
    const always = SMART_SUGGESTIONS.filter(s => s.keys.length === 0);
    const suggestions = [...keyed, ...always].slice(0, 6);

    return (
      <div className="flex-1 flex items-center justify-center overflow-y-auto">
        <div className="max-w-2xl w-full px-8 py-12">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 flex items-center justify-center">
              <SparkleIcon />
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">What should we build?</h2>
            <p className="text-sm text-slate-400 leading-relaxed max-w-md mx-auto">
              Describe any idea and watch it come to life. Connect your APIs for real data-powered dashboards.
            </p>
          </div>

          {/* Connected services indicator */}
          {configuredCount > 0 && (
            <div className="flex items-center justify-center gap-2 mb-6">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-emerald-400 font-medium">
                  {configuredCount} service{configuredCount !== 1 ? 's' : ''} connected
                </span>
              </div>
            </div>
          )}

          {/* Smart suggestion cards */}
          <div className="grid grid-cols-2 gap-3 mb-8">
            {suggestions.map((suggestion) => {
              const isConnected = suggestion.keys.length > 0 && suggestion.keys.every(k => configuredIds.has(k));
              return (
                <button
                  key={suggestion.title}
                  onClick={async () => {
                    try {
                      const page = await createCanvasPage({ name: suggestion.title, icon: suggestion.icon });
                      setPages(prev => [page, ...prev]);
                      setActivePage(page);
                      setPrompt(suggestion.prompt);
                      setTimeout(() => inputRef.current?.focus(), 100);
                    } catch {
                      toast.error("Failed to create page");
                    }
                  }}
                  className="text-left p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-indigo-500/20 transition-all group relative"
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-2xl">{suggestion.icon}</span>
                    {isConnected && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <div className="w-1 h-1 rounded-full bg-emerald-400" />
                        Live
                      </span>
                    )}
                  </div>
                  <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors block mb-1">
                    {suggestion.title}
                  </span>
                  <span className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                    {suggestion.prompt.slice(0, 80)}...
                  </span>
                  <div className="mt-2.5 flex items-center gap-1">
                    <span className="text-[10px] text-slate-600 font-medium px-1.5 py-0.5 rounded bg-white/[0.03] border border-white/[0.04]">
                      {suggestion.service}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleNewPage}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
            >
              <SparkleIcon /> Create with Data
            </button>
            <button
              onClick={handleQuickNewPage}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.10] text-slate-300 text-sm font-medium transition-colors border border-white/[0.08]"
            >
              <PlusIcon /> Blank Page
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="h-full flex bg-slate-950 relative">
      {/* ── Wizard Overlay ──────────────────────────────────────────── */}
      {showWizard && (
        <DataConnectionWizard
          onComplete={handleWizardComplete}
          onCancel={() => setShowWizard(false)}
        />
      )}

      {/* ── Page List Sidebar ───────────────────────────────────────── */}
      <div className="w-56 flex-shrink-0 border-r border-white/[0.06] flex flex-col">
        {/* Header */}
        <div className="p-3 border-b border-white/[0.06] flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Pages</span>
          <button
            onClick={handleNewPage}
            className="p-1 rounded-md hover:bg-white/[0.06] text-slate-400 hover:text-white transition-colors"
            title="New page"
          >
            <PlusIcon />
          </button>
        </div>

        {/* Page list */}
        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {isLoading ? (
            <div className="p-4 text-center">
              <div className="animate-spin w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto" />
            </div>
          ) : pages.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500">
              No pages yet. Create one to get started.
            </div>
          ) : (
            pages.map((page) => (
              <div
                key={page.id}
                onClick={() => selectPage(page)}
                className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all ${
                  activePage?.id === page.id
                    ? "bg-indigo-500/10 border border-indigo-500/20 text-white"
                    : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 border border-transparent"
                }`}
              >
                <span className="text-sm flex-shrink-0">{page.icon}</span>
                {editingName === page.id ? (
                  <input
                    autoFocus
                    value={editNameValue}
                    onChange={(e) => setEditNameValue(e.target.value)}
                    onBlur={() => saveRename(page.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRename(page.id);
                      if (e.key === "Escape") setEditingName(null);
                    }}
                    className="flex-1 text-xs bg-transparent border-b border-indigo-500 outline-none text-white"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="flex-1 text-xs truncate">{page.name}</span>
                )}

                {/* Actions (hover) */}
                <div className="hidden group-hover:flex items-center gap-0.5">
                  <button
                    onClick={(e) => startRename(page.id, page.name, e)}
                    className="p-0.5 rounded hover:bg-white/10 text-slate-500 hover:text-white"
                    title="Rename"
                  >
                    <EditIcon />
                  </button>
                  <button
                    onClick={(e) => handleDuplicate(page.id, page.name, e)}
                    className="p-0.5 rounded hover:bg-white/10 text-slate-500 hover:text-white"
                    title="Duplicate"
                  >
                    <CopyIcon />
                  </button>
                  <button
                    onClick={(e) => handleDeletePage(page.id, e)}
                    className={`p-0.5 rounded transition-all ${
                      confirmDeleteId === page.id
                        ? "bg-red-500/30 text-red-400 ring-1 ring-red-500/50"
                        : "hover:bg-red-500/20 text-slate-500 hover:text-red-400"
                    }`}
                    title={confirmDeleteId === page.id ? "Click again to confirm" : "Delete"}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Main Content Area ───────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {!activePage && !isLoading ? (
          <EmptyState />
        ) : activePage ? (
          <>
            {/* Page header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <span className="text-lg">{activePage.icon}</span>
                <h2 className="text-sm font-semibold text-white">{activePage.name}</h2>
                {isGenerating && (
                  <span className="flex items-center gap-1.5 text-xs text-indigo-400">
                    <div className="animate-spin w-3 h-3 border border-indigo-500 border-t-transparent rounded-full" />
                    Generating...
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Data sources indicator + refresh */}
                {activePage.data_sources && (activePage.data_sources as any)?.sources?.length > 0 && (
                  <button
                    onClick={handleRefreshData}
                    disabled={isRefreshing || isGenerating}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
                    title="Refresh data from connected sources"
                  >
                    <span className={isRefreshing ? "animate-spin" : ""}>
                      <RefreshIcon />
                    </span>
                    <DataIcon />
                    <span>{(activePage.data_sources as any).sources.length} source{(activePage.data_sources as any).sources.length > 1 ? "s" : ""}</span>
                  </button>
                )}
                {activeSpec && (
                  <button
                    onClick={() => {
                      // Export spec as JSON
                      const blob = new Blob([JSON.stringify(activeSpec, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${activePage.name.replace(/\s+/g, '-').toLowerCase()}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                      toast.success("Exported as JSON");
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                  >
                    <DownloadIcon /> Export
                  </button>
                )}
              </div>
            </div>

            {/* Rendered spec */}
            <div className="flex-1 overflow-y-auto p-6">
              {activeSpec ? (
                <div className="max-w-5xl mx-auto">
                  <JSONUIProvider registry={canvasRegistry}>
                    <Renderer
                      spec={activeSpec}
                      registry={canvasRegistry}
                      loading={isGenerating}
                    />
                  </JSONUIProvider>
                </div>
              ) : !isGenerating ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-slate-500">
                      <SparkleIcon />
                    </div>
                    <p className="text-sm text-slate-400 mb-1">This page is empty</p>
                    <p className="text-xs text-slate-500">
                      Describe what you want to build below
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Prompt input */}
            <div className="border-t border-white/[0.06] p-4">
              <div className="max-w-3xl mx-auto flex gap-2">
                <div className="flex-1 relative">
                  <textarea
                    ref={inputRef}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={activeSpec
                      ? "Describe changes... (e.g. 'add a chart showing monthly trends')"
                      : "Describe what to build... (e.g. 'create a sales dashboard')"
                    }
                    rows={1}
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20 resize-none"
                    disabled={isGenerating}
                  />
                </div>
                {isGenerating ? (
                  <button
                    onClick={handleStop}
                    className="px-4 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors flex-shrink-0"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={handleGenerate}
                    disabled={!prompt.trim()}
                    className="px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-sm font-medium transition-colors flex-shrink-0 flex items-center gap-2"
                  >
                    <SparkleIcon /> Generate
                  </button>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
