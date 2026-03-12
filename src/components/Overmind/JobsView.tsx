/**
 * JobsView — Overmind Job Queue
 *
 * Shows all orchestration jobs with status, progress, and controls.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { getOvJobs, cancelOvJob, type OvJob } from '@/lib/overmind';
import type { OvermindEvent } from '@/lib/useOvermindSocket';
import toast from 'react-hot-toast';

interface JobsViewProps {
  lastEvent?: OvermindEvent | null;
}

export function JobsView({ lastEvent }: JobsViewProps) {
  const [jobs, setJobs] = useState<OvJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await getOvJobs();
    setJobs(data);
    setLoading(false);
  }, []);

  // Auto-refresh on job-related WebSocket events
  const lastEventRef = useRef(lastEvent);
  useEffect(() => {
    if (lastEvent && lastEvent !== lastEventRef.current) {
      lastEventRef.current = lastEvent;
      const jobEvents = ['job_update', 'snapshot'];
      if (jobEvents.includes(lastEvent.type)) {
        refresh();
      }
    }
  }, [lastEvent, refresh]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleCancel = async (id: string, title: string) => {
    try {
      await cancelOvJob(id);
      toast.success(`Cancelled: ${title}`);
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
    pending: { color: 'text-slate-400', bg: 'bg-slate-500/20', label: 'Pending' },
    planning: { color: 'text-indigo-400', bg: 'bg-indigo-500/20', label: 'Planning' },
    running: { color: 'text-blue-400', bg: 'bg-blue-500/20', label: 'Running' },
    needs_review: { color: 'text-amber-400', bg: 'bg-amber-500/20', label: 'Needs Review' },
    completed: { color: 'text-emerald-400', bg: 'bg-emerald-500/20', label: 'Completed' },
    failed: { color: 'text-red-400', bg: 'bg-red-500/20', label: 'Failed' },
  };

  const formatTimeAgo = (dateStr: string): string => {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return `${Math.round(diff)}s ago`;
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
    return `${Math.round(diff / 86400)}d ago`;
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
      {/* Summary */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-400">{jobs.length} job{jobs.length !== 1 ? 's' : ''}</span>
        <button
          onClick={refresh}
          className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-sm text-slate-400 mb-1">No jobs yet</p>
          <p className="text-[11px] text-slate-600 max-w-sm mx-auto">
            Jobs are created when you ask the Overmind to build something.
            Use the Chat tab to start a conversation.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => {
            const sc = statusConfig[job.status] || statusConfig.pending;
            const isExpanded = expandedJob === job.id;
            const isActive = ['pending', 'planning', 'running'].includes(job.status);

            return (
              <div
                key={job.id}
                className="border border-white/[0.06] rounded-xl bg-slate-900/50 overflow-hidden"
              >
                <div
                  className="flex items-start justify-between px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
                  onClick={() => setExpandedJob(isExpanded ? null : job.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${sc.bg} ${sc.color}`}>
                        {sc.label}
                      </span>
                      <span className="text-[10px] text-slate-600">{formatTimeAgo(job.created_at)}</span>
                      {isActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                      )}
                    </div>
                    <h3 className="text-sm font-medium text-white truncate">{job.title}</h3>
                    {!isExpanded && job.description && (
                      <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{job.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {isActive && (
                      <button
                        onClick={() => handleCancel(job.id, job.title)}
                        className="px-2.5 py-1 rounded-lg text-[11px] text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                    <span className="text-slate-600 text-[11px]">{isExpanded ? '▾' : '▸'}</span>
                  </div>
                </div>

                {/* Expanded detail panel */}
                {isExpanded && (
                  <div className="border-t border-white/[0.06] px-4 py-3 bg-slate-950/50 space-y-3">
                    {/* Full description */}
                    {job.description && (
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">Description</p>
                        <p className="text-[11px] text-slate-400">{job.description}</p>
                      </div>
                    )}

                    {/* Job metadata */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Source</p>
                        <p className="text-[11px] text-slate-400">{job.source}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Created By</p>
                        <p className="text-[11px] text-slate-400">{job.created_by}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Job ID</p>
                        <p className="text-[11px] text-slate-400 font-mono">{job.id}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Created</p>
                        <p className="text-[11px] text-slate-400">{new Date(job.created_at).toLocaleString()}</p>
                      </div>
                    </div>

                    {/* Status timeline */}
                    <div>
                      <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-1.5">Timeline</p>
                      <div className="flex items-center gap-1">
                        {['pending', 'planning', 'running', 'completed'].map((step, i) => {
                          const statusOrder = ['pending', 'planning', 'running', 'needs_review', 'completed'];
                          const currentIdx = statusOrder.indexOf(job.status);
                          const stepIdx = statusOrder.indexOf(step);
                          const isCompleted = stepIdx < currentIdx;
                          const isCurrent = step === job.status;
                          const isFailed = job.status === 'failed';

                          return (
                            <div key={step} className="flex items-center gap-1">
                              <div className={`w-2 h-2 rounded-full ${
                                isFailed && isCurrent ? 'bg-red-400' :
                                isCurrent ? 'bg-blue-400 animate-pulse' :
                                isCompleted ? 'bg-emerald-400' :
                                'bg-slate-700'
                              }`} />
                              <span className={`text-[10px] ${
                                isCurrent ? 'text-white font-medium' :
                                isCompleted ? 'text-slate-400' :
                                'text-slate-600'
                              }`}>
                                {step}
                              </span>
                              {i < 3 && <span className="text-slate-700 text-[10px]">→</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
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
