/**
 * Canvas — Empty state with smart suggestions
 */
import { SparkleIcon, PlusIcon } from "./Icons";
import { SMART_SUGGESTIONS } from "./constants";
import type { EmptyStateProps } from "./types";

export function EmptyState({
  vaultKeys,
  onNewPage,
  onQuickNewPage,
  onSuggestionClick,
}: EmptyStateProps) {
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
                onClick={() => onSuggestionClick(suggestion)}
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
            onClick={onNewPage}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
          >
            <SparkleIcon /> Create with Data
          </button>
          <button
            onClick={onQuickNewPage}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.10] text-slate-300 text-sm font-medium transition-colors border border-white/[0.08]"
          >
            <PlusIcon /> Blank Page
          </button>
        </div>
      </div>
    </div>
  );
}
