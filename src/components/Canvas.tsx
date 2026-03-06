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
  type CanvasPage,
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

      // Auto-start generation with the enriched prompt
      setPrompt(enrichedPrompt);
      generateForPage(page, enrichedPrompt);
    } catch {
      toast.error("Failed to create page");
    }
  };

  // ── Delete page ────────────────────────────────────────────────────

  const handleDeletePage = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this page?")) return;
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

  const generateForPage = (page: CanvasPage, userPrompt: string) => {
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
      }
    );

    abortRef.current = abort;
  };

  const handleStop = () => {
    abortRef.current?.();
    setIsGenerating(false);
  };

  // ── Key handler for prompt ─────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  // ── Empty state ────────────────────────────────────────────────────

  const EmptyState = () => (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-lg px-8">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 flex items-center justify-center">
          <SparkleIcon />
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">Visual Workspace</h2>
        <p className="text-sm text-slate-400 mb-8 leading-relaxed">
          Create dashboards, reports, and interactive views powered by AI.
          Describe what you want and watch it build live.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-8">
          {[
            { icon: "📊", label: "Sales Dashboard", prompt: "Create a sales dashboard with revenue metrics, deal pipeline by stage, and a table of recent deals" },
            { icon: "📋", label: "Project Tracker", prompt: "Build a project tracker with task status cards, a progress bar, and a team member list" },
            { icon: "📈", label: "Analytics Report", prompt: "Design an analytics report with key metrics, comparison tables, and trend indicators" },
            { icon: "🎯", label: "KPI Overview", prompt: "Create a KPI dashboard with metric cards for MRR, churn rate, customer count, and NPS score" },
          ].map((template) => (
            <button
              key={template.label}
              onClick={async () => {
                const page = await createCanvasPage({ name: template.label, icon: template.icon });
                setPages(prev => [page, ...prev]);
                setActivePage(page);
                setPrompt(template.prompt);
                setTimeout(() => inputRef.current?.focus(), 100);
              }}
              className="text-left p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-indigo-500/20 transition-all group"
            >
              <span className="text-2xl mb-2 block">{template.icon}</span>
              <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors">
                {template.label}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
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
                    className="p-0.5 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400"
                    title="Delete"
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
