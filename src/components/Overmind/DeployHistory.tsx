/**
 * DeployHistory — Timeline of self-modifications
 */
import { useState, useEffect, useCallback } from 'react';
import { getDeployHistory, type OvDeployRecord } from '@/lib/overmind';

export function DeployHistory() {
  const [deploys, setDeploys] = useState<OvDeployRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDeploy, setExpandedDeploy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getDeployHistory();
      if (data) setDeploys(data);
    } catch {
      // Non-critical — keep showing last known data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const formatTimeAgo = (dateStr: string): string => {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return `${Math.round(diff)}s ago`;
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
    return `${Math.round(diff / 86400)}d ago`;
  };

  const statusConfig: Record<string, { color: string; bg: string; icon: string }> = {
    success: { color: 'text-emerald-400', bg: 'bg-emerald-500/20', icon: '✓' },
    failed: { color: 'text-red-400', bg: 'bg-red-500/20', icon: '✗' },
    rolled_back: { color: 'text-amber-400', bg: 'bg-amber-500/20', icon: '↩' },
    building: { color: 'text-blue-400', bg: 'bg-blue-500/20', icon: '⚙' },
    deploying: { color: 'text-indigo-400', bg: 'bg-indigo-500/20', icon: '🚀' },
    pending: { color: 'text-slate-400', bg: 'bg-slate-500/20', icon: '⏳' },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="animate-spin w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-400">{deploys.length} deployment{deploys.length !== 1 ? 's' : ''}</span>
        <button onClick={refresh} className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
          ↻ Refresh
        </button>
      </div>

      {deploys.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">🚀</div>
          <p className="text-sm text-slate-400 mb-1">No deployments yet</p>
          <p className="text-[11px] text-slate-600 max-w-sm mx-auto">
            Track B code changes will appear here when the system modifies its own code.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {deploys.map((deploy) => {
            const sc = statusConfig[deploy.deploy_status] || statusConfig.pending;
            const isExpanded = expandedDeploy === deploy.id;

            return (
              <div key={deploy.id} className="border border-white/[0.06] rounded-xl bg-slate-900/50 overflow-hidden">
                <div
                  className="flex items-start justify-between px-4 py-3 cursor-pointer hover:bg-white/[0.02]"
                  onClick={() => setExpandedDeploy(isExpanded ? null : deploy.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold text-white">#{deploy.version}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${sc.bg} ${sc.color}`}>
                        {sc.icon} {deploy.deploy_status}
                      </span>
                      <span className="text-[10px] text-slate-600">{formatTimeAgo(deploy.created_at)}</span>
                    </div>
                    <p className="text-[11px] text-slate-400">{deploy.reason || 'No description'}</p>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-600">
                      <span>{deploy.files_changed.length} file{deploy.files_changed.length !== 1 ? 's' : ''}</span>
                      <span className="capitalize">{deploy.change_type} rebuild</span>
                      <span>by {deploy.requested_by}</span>
                    </div>
                  </div>
                  <span className="text-slate-600 text-[11px]">{isExpanded ? '▾' : '▸'}</span>
                </div>

                {isExpanded && (
                  <div className="border-t border-white/[0.06] px-4 py-3 bg-slate-950/50 space-y-3">
                    {deploy.files_changed.length > 0 && (
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">Files Changed</p>
                        <div className="space-y-1">
                          {deploy.files_changed.map((f, i) => (
                            <div key={i} className="text-[10px] font-mono text-slate-400 py-0.5 px-2 rounded bg-slate-800/30">
                              {f.path}
                              {f.diff_summary && <span className="text-slate-600 ml-2">— {f.diff_summary}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {deploy.build_output && (
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">Build Output</p>
                        <pre className="text-[10px] text-slate-500 font-mono bg-slate-800/30 rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap">
                          {deploy.build_output}
                        </pre>
                      </div>
                    )}
                    {deploy.health_check && (
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">Health Check</p>
                        <pre className="text-[10px] text-slate-500 font-mono bg-slate-800/30 rounded p-2 max-h-24 overflow-auto">
                          {JSON.stringify(deploy.health_check, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
