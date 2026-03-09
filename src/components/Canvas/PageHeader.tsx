/**
 * Canvas — Active page header with actions
 */
import { RefreshIcon, DataIcon, DownloadIcon } from "./Icons";
import type { PageHeaderProps } from "./types";

export function PageHeader({
  activePage,
  isGenerating,
  isRefreshing,
  activeSpec,
  onRefreshData,
  onExport,
}: PageHeaderProps) {
  return (
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
            onClick={onRefreshData}
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
            onClick={onExport}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <DownloadIcon /> Export
          </button>
        )}
      </div>
    </div>
  );
}
