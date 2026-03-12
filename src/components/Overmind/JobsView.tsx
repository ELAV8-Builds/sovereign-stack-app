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
            return (
              <div
                key={job.id}
                className="border border-white/[0.06] rounded-xl bg-slate-900/50 px-4 py-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${sc.bg} ${sc.color}`}>
                        {sc.label}
                      </span>
                      <span className="text-[10px] text-slate-600">{formatTimeAgo(job.created_at)}</span>
                    </div>
                    <h3 className="text-sm font-medium text-white truncate">{job.title}</h3>
                    {job.description && (
                      <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{job.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-600">
                      <span>Source: {job.source}</span>
                      <span>By: {job.created_by}</span>
                      <span className="font-mono">{job.id.slice(0, 8)}</span>
                    </div>
                  </div>

                  {/* Cancel button for active jobs */}
                  {['pending', 'planning', 'running'].includes(job.status) && (
                    <button
                      onClick={() => handleCancel(job.id, job.title)}
                      className="ml-3 px-2.5 py-1 rounded-lg text-[11px] text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
