/**
 * FleetView — Worker Management Panel
 *
 * Shows all fleet workers with:
 * - Status indicators (healthy/unhealthy/quarantined/restarting)
 * - Context usage badges (warm/high/critical)
 * - Lifecycle actions (checkpoint, restart, stop)
 * - Expandable detail panel (checkpoints, commands)
 * - Safety status (worker cap, circuit breaker)
 *
 * SAFETY: Hard limit of 5 workers enforced server-side.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  getFleetWorkers,
  getFleetStatus,
  getFleetSafety,
  registerFleetWorker,
  removeFleetWorker,
  requestWorkerCheckpoint,
  requestWorkerRestart,
  requestWorkerStop,
  resetFleetCircuitBreaker,
  getWorkerCheckpoints,
  getWorkerCommands,
  type FleetWorker,
  type FleetStatus,
  type FleetSafety,
  type WorkerCheckpoint,
  type WorkerCommand,
} from '@/lib/overmind';
import type { OvermindEvent } from '@/lib/useOvermindSocket';

interface FleetViewProps {
  lastEvent?: OvermindEvent | null;
}

export function FleetView({ lastEvent }: FleetViewProps) {
  const [workers, setWorkers] = useState<FleetWorker[]>([]);
  const [status, setStatus] = useState<FleetStatus | null>(null);
  const [safety, setSafety] = useState<FleetSafety | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedWorker, setExpandedWorker] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'checkpoints' | 'commands'>('checkpoints');
  const [checkpoints, setCheckpoints] = useState<WorkerCheckpoint[]>([]);
  const [commands, setCommands] = useState<WorkerCommand[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);

  const refresh = useCallback(async () => {
    const [w, s, sf] = await Promise.all([
      getFleetWorkers(),
      getFleetStatus(),
      getFleetSafety(),
    ]);
    setWorkers(w);
    setStatus(s);
    setSafety(sf);
    setLoading(false);
  }, []);

  // Auto-refresh on fleet-related WebSocket events
  const lastEventRef = useRef(lastEvent);
  useEffect(() => {
    if (lastEvent && lastEvent !== lastEventRef.current) {
      lastEventRef.current = lastEvent;
      const fleetEvents = ['fleet_update', 'checkpoint', 'command', 'snapshot'];
      if (fleetEvents.includes(lastEvent.type)) {
        refresh();
      }
    }
  }, [lastEvent, refresh]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Load detail data when expanding a worker
  useEffect(() => {
    if (!expandedWorker) return;
    Promise.all([
      getWorkerCheckpoints(expandedWorker),
      getWorkerCommands(expandedWorker),
    ]).then(([cp, cmd]) => {
      setCheckpoints(cp);
      setCommands(cmd);
    });
  }, [expandedWorker]);

  const handleCheckpoint = async (id: string, name: string) => {
    try {
      await requestWorkerCheckpoint(id);
      toast.success(`Checkpoint requested for ${name}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleRestart = async (id: string, name: string) => {
    try {
      await requestWorkerRestart(id);
      toast.success(`Restart requested for ${name}`);
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleStop = async (id: string, name: string) => {
    try {
      await requestWorkerStop(id);
      toast.success(`Stop requested for ${name}`);
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleRemove = async (id: string, name: string) => {
    if (!confirm(`Remove ${name} from fleet registry?`)) return;
    try {
      await removeFleetWorker(id);
      toast.success(`${name} removed`);
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleResetCircuitBreaker = async () => {
    try {
      await resetFleetCircuitBreaker();
      toast.success('Circuit breaker reset');
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const statusColor = (s: FleetWorker['status']): string => {
    switch (s) {
      case 'healthy': return 'bg-emerald-400';
      case 'unhealthy': return 'bg-amber-400';
      case 'quarantined': return 'bg-red-400';
      case 'restarting': return 'bg-blue-400 animate-pulse';
      default: return 'bg-slate-500';
    }
  };

  const contextBadge = (usage: number) => {
    if (usage >= 85) return { label: 'CRITICAL', color: 'bg-red-500/20 text-red-400 border-red-500/30' };
    if (usage >= 75) return { label: 'HIGH', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
    if (usage >= 65) return { label: 'WARM', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' };
    return null;
  };

  const formatTimeAgo = (dateStr: string | null): string => {
    if (!dateStr) return 'never';
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return `${Math.round(diff)}s ago`;
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    return `${Math.round(diff / 3600)}h ago`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="animate-spin w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Fleet Summary Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Workers</span>
            <span className="text-sm font-bold text-white">
              {status?.total || 0}
              <span className="text-slate-500 font-normal">/{safety?.max_workers || 5}</span>
            </span>
          </div>
          {status && status.total > 0 && (
            <>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-center gap-3 text-[11px]">
                <span className="text-emerald-400">{status.healthy} healthy</span>
                {status.unhealthy > 0 && <span className="text-amber-400">{status.unhealthy} unhealthy</span>}
                {status.quarantined > 0 && <span className="text-red-400">{status.quarantined} quarantined</span>}
                {status.restarting > 0 && <span className="text-blue-400">{status.restarting} restarting</span>}
              </div>
              <div className="w-px h-4 bg-white/10" />
              <div className="text-[11px] text-slate-500">
                Load: {status.total_load}/{status.total_capacity} · Context avg: {Math.round(status.avg_context_usage)}%
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Circuit breaker warning */}
          {safety?.circuit_breaker_open && (
            <button
              onClick={handleResetCircuitBreaker}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
            >
              ⚡ Circuit Breaker Open — Click to Reset
            </button>
          )}
          <button
            onClick={() => setShowAddDialog(true)}
            disabled={(status?.total || 0) >= (safety?.max_workers || 5)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              (status?.total || 0) >= (safety?.max_workers || 5)
                ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            + Add Worker
          </button>
        </div>
      </div>

      {/* Worker Cards */}
      {workers.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">🖥</div>
          <p className="text-sm text-slate-400 mb-1">No fleet workers registered</p>
          <p className="text-[11px] text-slate-600 mb-4 max-w-sm mx-auto">
            Start a worker on your machine with the worker supervisor script,
            or add one manually via the button above.
          </p>
          <code className="text-[11px] text-indigo-400 bg-slate-800/80 px-3 py-1.5 rounded-lg font-mono">
            ./scripts/worker-supervisor.sh --name worker-1 --project ~/projects/my-app
          </code>
        </div>
      ) : (
        <div className="space-y-2">
          {workers.map((worker) => {
            const ctxBadge = contextBadge(worker.context_usage);
            const isExpanded = expandedWorker === worker.id;

            return (
              <div
                key={worker.id}
                className="border border-white/[0.06] rounded-xl bg-slate-900/50 overflow-hidden"
              >
                {/* Worker Row */}
                <div
                  className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
                  onClick={() => setExpandedWorker(isExpanded ? null : worker.id)}
                >
                  <div className="flex items-center gap-3">
                    {/* Status dot */}
                    <span className={`w-2.5 h-2.5 rounded-full ${statusColor(worker.status)}`} />
                    {/* Name + meta */}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{worker.name}</span>
                        <span className="text-[10px] text-slate-600 font-mono">{worker.id.slice(0, 8)}</span>
                        {ctxBadge && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${ctxBadge.color}`}>
                            {ctxBadge.label}
                          </span>
                        )}
                      </div>
                      {/* Context usage bar */}
                      <div className="flex items-center gap-2 mt-1">
                        <div className="w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              worker.context_usage >= 85 ? 'bg-red-500' :
                              worker.context_usage >= 75 ? 'bg-amber-500' :
                              worker.context_usage >= 65 ? 'bg-yellow-500' :
                              'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(worker.context_usage, 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-600">{worker.context_usage}%</span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-slate-500">
                        <span>Load: {worker.current_load}/{worker.max_load}</span>
                        {/* Heartbeat with age-based warning */}
                        {(() => {
                          const hbAge = worker.last_heartbeat
                            ? (Date.now() - new Date(worker.last_heartbeat).getTime()) / 1000
                            : Infinity;
                          const hbColor = hbAge > 90 ? 'text-red-400' : hbAge > 60 ? 'text-amber-400' : 'text-slate-500';
                          return (
                            <span className={hbColor}>
                              {hbAge > 90 ? '⚠ ' : hbAge > 60 ? '⚡ ' : ''}
                              Heartbeat: {formatTimeAgo(worker.last_heartbeat)}
                            </span>
                          );
                        })()}
                        {worker.capabilities.length > 0 && (
                          <span className="text-slate-600">
                            {worker.capabilities.slice(0, 3).join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleCheckpoint(worker.id, worker.name)}
                      className="px-2 py-1 rounded-lg text-[11px] text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                      title="Request checkpoint"
                    >
                      💾
                    </button>
                    <button
                      onClick={() => handleRestart(worker.id, worker.name)}
                      className="px-2 py-1 rounded-lg text-[11px] text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                      title="Request restart"
                    >
                      🔄
                    </button>
                    <button
                      onClick={() => handleStop(worker.id, worker.name)}
                      className="px-2 py-1 rounded-lg text-[11px] text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Request stop"
                    >
                      ⏹
                    </button>
                    <button
                      onClick={() => handleRemove(worker.id, worker.name)}
                      className="px-2 py-1 rounded-lg text-[11px] text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Remove from fleet"
                    >
                      🗑
                    </button>
                    <span className="text-slate-600 ml-1">
                      {isExpanded ? '▾' : '▸'}
                    </span>
                  </div>
                </div>

                {/* Expanded Detail Panel */}
                {isExpanded && (
                  <div className="border-t border-white/[0.06] px-4 py-3 bg-slate-950/50">
                    {/* Detail tabs */}
                    <div className="flex items-center gap-2 mb-3">
                      <button
                        onClick={() => setDetailTab('checkpoints')}
                        className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                          detailTab === 'checkpoints'
                            ? 'bg-white/[0.08] text-white'
                            : 'text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        Checkpoints
                      </button>
                      <button
                        onClick={() => setDetailTab('commands')}
                        className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                          detailTab === 'commands'
                            ? 'bg-white/[0.08] text-white'
                            : 'text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        Commands
                      </button>
                    </div>

                    {detailTab === 'checkpoints' && (
                      <div className="space-y-1.5">
                        {checkpoints.length === 0 ? (
                          <p className="text-[11px] text-slate-600 py-2">No checkpoints yet</p>
                        ) : (
                          checkpoints.slice(0, 5).map((cp) => (
                            <div
                              key={cp.id}
                              className="flex items-center justify-between py-1.5 px-2 rounded bg-slate-800/30 text-[11px]"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-emerald-400">💾</span>
                                <span className="text-slate-300">{cp.reason}</span>
                                <span className="text-slate-600">· {cp.context_usage}% context</span>
                              </div>
                              <span className="text-slate-600">{formatTimeAgo(cp.created_at)}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    {detailTab === 'commands' && (
                      <div className="space-y-1.5">
                        {commands.length === 0 ? (
                          <p className="text-[11px] text-slate-600 py-2">No commands sent yet</p>
                        ) : (
                          commands.slice(0, 10).map((cmd) => {
                            const cmdStatusColor = {
                              pending: 'text-yellow-400',
                              acked: 'text-blue-400',
                              running: 'text-indigo-400',
                              completed: 'text-emerald-400',
                              failed: 'text-red-400',
                              expired: 'text-slate-500',
                            }[cmd.status] || 'text-slate-500';

                            return (
                              <div
                                key={cmd.id}
                                className="flex items-center justify-between py-1.5 px-2 rounded bg-slate-800/30 text-[11px]"
                              >
                                <div className="flex items-center gap-2">
                                  <span className={cmdStatusColor}>●</span>
                                  <span className="text-slate-300 font-mono">{cmd.command}</span>
                                  <span className="text-slate-600">{cmd.status}</span>
                                  {cmd.error && <span className="text-red-400 truncate max-w-[200px]">{cmd.error}</span>}
                                </div>
                                <span className="text-slate-600">{formatTimeAgo(cmd.created_at)}</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Worker Dialog */}
      {showAddDialog && <AddWorkerDialog onClose={() => setShowAddDialog(false)} onAdded={refresh} safety={safety} currentWorkerCount={workers.length} />}
    </div>
  );
}

// ─── Add Worker Dialog ──────────────────────────────────────────

function AddWorkerDialog({
  onClose,
  onAdded,
  safety,
  currentWorkerCount,
}: {
  onClose: () => void;
  onAdded: () => void;
  safety: FleetSafety | null;
  currentWorkerCount: number;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('http://localhost:');
  const [capabilities, setCapabilities] = useState('');
  const [maxLoad, setMaxLoad] = useState(3);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !url.trim()) {
      toast.error('Name and URL are required');
      return;
    }

    setSubmitting(true);
    try {
      await registerFleetWorker({
        name: name.trim(),
        url: url.trim(),
        capabilities: capabilities.split(',').map((s) => s.trim()).filter(Boolean),
        max_load: maxLoad,
      });
      toast.success(`Worker "${name}" registered`);
      onAdded();
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-white">Add Fleet Worker</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {safety ? `${Math.max(0, safety.max_workers - currentWorkerCount)} of ${safety.max_workers} slots remaining` : 'Checking...'}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-800 text-slate-500">
            ✕
          </button>
        </div>

        {/* Form */}
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">Worker Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., worker-1"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-600 transition-colors"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">Worker URL</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:3101"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-600 transition-colors font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">Capabilities (comma-separated)</label>
            <input
              type="text"
              value={capabilities}
              onChange={(e) => setCapabilities(e.target.value)}
              placeholder="e.g., code, build, test, deploy"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-600 transition-colors"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">Max Concurrent Tasks</label>
            <input
              type="number"
              value={maxLoad}
              onChange={(e) => setMaxLoad(Math.min(5, Math.max(1, parseInt(e.target.value) || 1)))}
              min={1}
              max={5}
              className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-600 transition-colors"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-800">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !name.trim() || !url.trim()}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              submitting || !name.trim() || !url.trim()
                ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            {submitting ? 'Registering...' : 'Register Worker'}
          </button>
        </div>
      </div>
    </div>
  );
}
