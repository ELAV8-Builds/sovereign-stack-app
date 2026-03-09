/**
 * Canvas — Persistent visual workspace powered by json-render
 *
 * Users create "pages" that the AI generates as interactive dashboards,
 * reports, mockups, or data views. Pages persist in PostgreSQL and can
 * be edited, renamed, duplicated, or deleted.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { elementsToSpec } from "@/lib/canvas-catalog";
import {
  listCanvasPages,
  createCanvasPage,
  updateCanvasPage,
  deleteCanvasPage,
  duplicateCanvasPage,
  generateCanvasUI,
  refreshCanvasData,
  getVaultStatus,
} from "@/lib/canvas";
import { DataConnectionWizard } from "../DataConnectionWizard";
import toast from "react-hot-toast";

import { PageSidebar } from "./PageSidebar";
import { PageHeader } from "./PageHeader";
import { CanvasRenderer } from "./CanvasRenderer";
import { PromptInput } from "./PromptInput";
import { EmptyState } from "./EmptyState";

import type {
  Spec,
  CanvasPage,
  VaultKeyStatus,
  DataSourceConfig,
  SpecElement,
  WizardResult,
  SmartSuggestion,
} from "./types";

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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
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

  const handleWizardComplete = async (result: WizardResult) => {
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

  // ── Export handler ──────────────────────────────────────────────────

  const handleExport = () => {
    if (!activeSpec || !activePage) return;
    const blob = new Blob([JSON.stringify(activeSpec, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activePage.name.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported as JSON");
  };

  // ── Suggestion click handler ──────────────────────────────────────

  const handleSuggestionClick = async (suggestion: SmartSuggestion) => {
    try {
      const page = await createCanvasPage({ name: suggestion.title, icon: suggestion.icon });
      setPages(prev => [page, ...prev]);
      setActivePage(page);
      setPrompt(suggestion.prompt);
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch {
      toast.error("Failed to create page");
    }
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
      <PageSidebar
        pages={pages}
        activePage={activePage}
        isLoading={isLoading}
        editingName={editingName}
        editNameValue={editNameValue}
        confirmDeleteId={confirmDeleteId}
        onSelectPage={selectPage}
        onNewPage={handleNewPage}
        onStartRename={startRename}
        onSaveRename={saveRename}
        onCancelRename={() => setEditingName(null)}
        onEditNameValueChange={setEditNameValue}
        onDuplicate={handleDuplicate}
        onDelete={handleDeletePage}
      />

      {/* ── Main Content Area ───────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {!activePage && !isLoading ? (
          <EmptyState
            vaultKeys={vaultKeys}
            onNewPage={handleNewPage}
            onQuickNewPage={handleQuickNewPage}
            onSuggestionClick={handleSuggestionClick}
          />
        ) : activePage ? (
          <>
            <PageHeader
              activePage={activePage}
              isGenerating={isGenerating}
              isRefreshing={isRefreshing}
              activeSpec={activeSpec}
              onRefreshData={handleRefreshData}
              onExport={handleExport}
            />
            <CanvasRenderer
              activeSpec={activeSpec}
              isGenerating={isGenerating}
            />
            <PromptInput
              prompt={prompt}
              isGenerating={isGenerating}
              activeSpec={activeSpec}
              inputRef={inputRef}
              onPromptChange={setPrompt}
              onGenerate={handleGenerate}
              onStop={handleStop}
              onKeyDown={handleKeyDown}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
