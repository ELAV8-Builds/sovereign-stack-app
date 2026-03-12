/**
 * RuleHistory — Per-category version timeline with rollback
 */
import { useState, useEffect, useCallback } from 'react';
import { getRuleVersions, rollbackRules, type OvRuleVersion, type OvRule } from '@/lib/overmind';
import toast from 'react-hot-toast';

interface RuleHistoryProps {
  category: string;
  onClose: () => void;
  onRollback: () => void;
}

export function RuleHistory({ category, onClose, onRollback }: RuleHistoryProps) {
  const [versions, setVersions] = useState<OvRuleVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [rolling, setRolling] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await getRuleVersions(category);
    setVersions(data);
    setLoading(false);
  }, [category]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleRollback = async (version: OvRuleVersion) => {
    setRolling(version.id);
    try {
      await rollbackRules(version.id);
      toast.success(`Restored ${category} rules to v${version.version}`);
      onRollback();
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRolling(null);
    }
  };

  const formatTimeAgo = (dateStr: string): string => {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return `${Math.round(diff)}s ago`;
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
    return `${Math.round(diff / 86400)}d ago`;
  };

  const changeTypeBadge: Record<string, { bg: string; text: string }> = {
    seed: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
    preset: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
    updated: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
    rollback: { bg: 'bg-red-500/20', text: 'text-red-400' },
    conversation: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
    deleted: { bg: 'bg-slate-500/20', text: 'text-slate-400' },
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/[0.08] rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div>
            <h3 className="text-sm font-semibold text-white">Version History</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Category: <span className="text-slate-300 font-mono">{category}</span></p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg">&times;</button>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-auto p-4 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <span className="animate-spin w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full" />
            </div>
          ) : versions.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-8">No version history yet</p>
          ) : (
            versions.map((v) => {
              const badge = changeTypeBadge[v.change_type] || changeTypeBadge.updated;
              const isExpanded = expandedVersion === v.id;

              return (
                <div key={v.id} className="border border-white/[0.06] rounded-xl bg-slate-800/30 overflow-hidden">
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white/[0.02]"
                    onClick={() => setExpandedVersion(isExpanded ? null : v.id)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">v{v.version}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>
                        {v.change_type}
                      </span>
                      <span className="text-[10px] text-slate-600">{formatTimeAgo(v.created_at)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRollback(v); }}
                        disabled={rolling === v.id}
                        className="text-[10px] px-2 py-1 rounded bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 disabled:opacity-50"
                      >
                        {rolling === v.id ? 'Restoring...' : 'Restore'}
                      </button>
                      <span className="text-slate-600 text-[10px]">{isExpanded ? '▾' : '▸'}</span>
                    </div>
                  </div>

                  {v.reason && !isExpanded && (
                    <p className="px-4 pb-2 text-[11px] text-slate-500 line-clamp-1">{v.reason}</p>
                  )}

                  {isExpanded && (
                    <div className="border-t border-white/[0.06] px-4 py-3 bg-slate-950/50 space-y-2">
                      {v.reason && (
                        <div>
                          <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Reason</p>
                          <p className="text-[11px] text-slate-400">{v.reason}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Changed By</p>
                          <p className="text-[11px] text-slate-400">{v.changed_by}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Rules</p>
                          <p className="text-[11px] text-slate-400">{v.snapshot.length} rules</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">Snapshot</p>
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {v.snapshot.map((rule: OvRule, i: number) => (
                            <div key={i} className="flex items-center justify-between py-1 px-2 rounded bg-slate-800/30 text-[10px]">
                              <span className="text-slate-300 font-mono">{rule.category}.{rule.key}</span>
                              <span className="text-slate-500 font-mono">
                                {typeof rule.value === 'object' ? JSON.stringify(rule.value) : String(rule.value)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
