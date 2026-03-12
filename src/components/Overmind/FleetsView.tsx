/**
 * FleetsView — Multi-Machine Fleet Management Panel
 *
 * Shows all registered fleet machines (physical/virtual hosts) with:
 * - Status indicators (healthy/unhealthy/offline/suspended)
 * - Worker counts and capacity
 * - Capabilities and region
 * - Heartbeat freshness
 * - Security actions (rotate key, suspend, unsuspend)
 * - Audit log viewer
 */
import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  getFleetDashboard,
  getFleetAuditLog,
  removeFleetMachine,
  sweepFleetMachines,
  unsuspendFleet,
  type FleetMachine,
  type FleetDashboard,
  type FleetAuditEntry,
} from '@/lib/overmind';
import type { OvermindEvent } from '@/lib/useOvermindSocket';

interface FleetsViewProps {
  lastEvent?: OvermindEvent | null;
}

const STATUS_COLORS: Record<string, string> = {
  healthy: 'bg-emerald-400',
  unhealthy: 'bg-amber-400',
  offline: 'bg-slate-500',
  suspended: 'bg-red-500',
};

const STATUS_TEXT: Record<string, string> = {
  healthy: 'Healthy',
  unhealthy: 'Unhealthy',
  offline: 'Offline',
  suspended: 'Suspended',
};

export function FleetsView({ lastEvent }: FleetsViewProps) {
  const [dashboard, setDashboard] = useState<FleetDashboard | null>(null);
  const [auditLog, setAuditLog] = useState<FleetAuditEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [expandedFleet, setExpandedFleet] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await getFleetDashboard();
      if (data) setDashboard(data);
    } catch (err) {
      console.error('Failed to load fleet dashboard:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Refresh on relevant events
  useEffect(() => {
    if (lastEvent?.type === 'fleet_machine_registered' || lastEvent?.type === 'fleet_machine_removed') {
      refresh();
    }
  }, [lastEvent, refresh]);

  const loadAudit = async () => {
    try {
      const entries = await getFleetAuditLog(50);
      setAuditLog(entries);
      setShowAudit(true);
    } catch (err) {
      toast.error('Failed to load audit log');
    }
  };

  const handleSweep = async () => {
    try {
      await sweepFleetMachines();
      toast.success('Fleet sweep complete');
      refresh();
    } catch (err) {
      toast.error('Sweep failed');
    }
  };

  const handleRemove = async (fleet: FleetMachine) => {
    if (!confirm(`Remove fleet "${fleet.fleet_name}"? Workers will be unlinked.`)) return;
    try {
      await removeFleetMachine(fleet.id);
      toast.success(`Removed ${fleet.fleet_name}`);
      refresh();
    } catch (err) {
      toast.error('Failed to remove fleet');
    }
  };

  const handleUnsuspend = async (fleet: FleetMachine) => {
    try {
      const result = await unsuspendFleet(fleet.id);
      toast.success(
        `Fleet unsuspended. New API key: ${result.credentials.api_key.slice(0, 12)}...`,
        { duration: 10000 }
      );
      refresh();
    } catch (err) {
      toast.error('Failed to unsuspend fleet');
    }
  };

  const formatTimeAgo = (ts: string | null): string => {
    if (!ts) return 'Never';
    const diff = (Date.now() - new Date(ts).getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="text-slate-500 text-sm animate-pulse">Loading fleet machines...</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Dashboard Summary */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white/[0.03] rounded-lg p-3 border border-white/[0.06]">
          <div className="text-[10px] text-slate-500 uppercase tracking-wide">Total Fleets</div>
          <div className="text-xl font-bold text-white mt-1">{dashboard?.total || 0}</div>
        </div>
        <div className="bg-white/[0.03] rounded-lg p-3 border border-white/[0.06]">
          <div className="text-[10px] text-slate-500 uppercase tracking-wide">Healthy</div>
          <div className="text-xl font-bold text-emerald-400 mt-1">{dashboard?.healthy || 0}</div>
        </div>
        <div className="bg-white/[0.03] rounded-lg p-3 border border-white/[0.06]">
          <div className="text-[10px] text-slate-500 uppercase tracking-wide">Workers Active</div>
          <div className="text-xl font-bold text-blue-400 mt-1">
            {dashboard?.total_workers_active || 0}
            <span className="text-xs text-slate-500 font-normal"> / {dashboard?.total_workers_capacity || 0}</span>
          </div>
        </div>
        <div className="bg-white/[0.03] rounded-lg p-3 border border-white/[0.06]">
          <div className="text-[10px] text-slate-500 uppercase tracking-wide">Issues</div>
          <div className="text-xl font-bold text-amber-400 mt-1">
            {(dashboard?.unhealthy || 0) + (dashboard?.offline || 0) + (dashboard?.suspended || 0)}
          </div>
        </div>
      </div>

      {/* Actions Bar */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Fleet Machines</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={loadAudit}
            className="text-[10px] px-2.5 py-1 rounded bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/[0.08] transition-all"
          >
            🔍 Audit Log
          </button>
          <button
            onClick={handleSweep}
            className="text-[10px] px-2.5 py-1 rounded bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/[0.08] transition-all"
          >
            🔄 Sweep
          </button>
          <button
            onClick={refresh}
            className="text-[10px] px-2.5 py-1 rounded bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/[0.08] transition-all"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Fleet Cards */}
      {(!dashboard?.fleets || dashboard.fleets.length === 0) ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          No fleet machines registered.
          <br />
          <span className="text-[10px]">Use POST /api/overmind/fleets/register to add a machine.</span>
        </div>
      ) : (
        <div className="space-y-2">
          {dashboard.fleets.map((fleet) => (
            <FleetCard
              key={fleet.id}
              fleet={fleet}
              expanded={expandedFleet === fleet.id}
              onToggle={() => setExpandedFleet(expandedFleet === fleet.id ? null : fleet.id)}
              onRemove={() => handleRemove(fleet)}
              onUnsuspend={() => handleUnsuspend(fleet)}
              formatTimeAgo={formatTimeAgo}
            />
          ))}
        </div>
      )}

      {/* Audit Log Modal */}
      {showAudit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-900 rounded-xl border border-white/[0.1] w-[700px] max-h-[600px] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
              <h3 className="text-sm font-semibold text-white">Fleet Audit Log</h3>
              <button onClick={() => setShowAudit(false)} className="text-slate-500 hover:text-white">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {auditLog.length === 0 ? (
                <div className="text-center text-slate-500 text-sm py-8">No audit entries</div>
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-slate-500 border-b border-white/[0.06]">
                      <th className="text-left pb-2 font-medium">Time</th>
                      <th className="text-left pb-2 font-medium">Dir</th>
                      <th className="text-left pb-2 font-medium">Method</th>
                      <th className="text-left pb-2 font-medium">Path</th>
                      <th className="text-left pb-2 font-medium">Status</th>
                      <th className="text-left pb-2 font-medium">Latency</th>
                      <th className="text-left pb-2 font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map((entry) => (
                      <tr key={entry.id} className="border-b border-white/[0.03] text-slate-400">
                        <td className="py-1.5">{new Date(entry.created_at).toLocaleTimeString()}</td>
                        <td className="py-1.5">
                          <span className={entry.direction === 'inbound' ? 'text-blue-400' : 'text-amber-400'}>
                            {entry.direction === 'inbound' ? '⬇' : '⬆'}
                          </span>
                        </td>
                        <td className="py-1.5 font-mono">{entry.method}</td>
                        <td className="py-1.5 font-mono max-w-[200px] truncate">{entry.path}</td>
                        <td className="py-1.5">
                          <span className={
                            entry.status_code && entry.status_code < 300 ? 'text-emerald-400' :
                            entry.status_code && entry.status_code < 500 ? 'text-amber-400' : 'text-red-400'
                          }>
                            {entry.status_code || '—'}
                          </span>
                        </td>
                        <td className="py-1.5">{entry.latency_ms ? `${entry.latency_ms}ms` : '—'}</td>
                        <td className="py-1.5 text-red-400 max-w-[150px] truncate">{entry.error || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fleet Card Sub-component
// ---------------------------------------------------------------------------

function FleetCard({
  fleet,
  expanded,
  onToggle,
  onRemove,
  onUnsuspend,
  formatTimeAgo,
}: {
  fleet: FleetMachine;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onUnsuspend: () => void;
  formatTimeAgo: (ts: string | null) => string;
}) {
  const workersActive = (fleet.metadata as any)?.workers_active || 0;
  const avgContext = (fleet.metadata as any)?.avg_context_usage || 0;
  const diskFree = (fleet.metadata as any)?.disk_free_gb || 0;
  const memFree = (fleet.metadata as any)?.memory_free_gb || 0;

  return (
    <div className="bg-white/[0.02] rounded-lg border border-white/[0.06] overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          {/* Status dot */}
          <span className={`w-2.5 h-2.5 rounded-full ${STATUS_COLORS[fleet.status] || 'bg-slate-500'}`} />

          {/* Name + endpoint */}
          <div className="text-left">
            <div className="text-sm font-medium text-white">{fleet.fleet_name}</div>
            <div className="text-[10px] text-slate-500">{fleet.machine_name} · {fleet.endpoint}</div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Workers */}
          <div className="text-right">
            <div className="text-xs text-white font-medium">{workersActive}/{fleet.max_workers}</div>
            <div className="text-[10px] text-slate-500">Workers</div>
          </div>

          {/* Region */}
          <span className="text-[10px] px-2 py-0.5 rounded bg-white/[0.06] text-slate-400">
            {fleet.region}
          </span>

          {/* Status */}
          <span className={`text-[10px] px-2 py-0.5 rounded ${
            fleet.status === 'healthy' ? 'bg-emerald-400/10 text-emerald-400' :
            fleet.status === 'unhealthy' ? 'bg-amber-400/10 text-amber-400' :
            fleet.status === 'suspended' ? 'bg-red-400/10 text-red-400' :
            'bg-slate-400/10 text-slate-400'
          }`}>
            {STATUS_TEXT[fleet.status] || fleet.status}
          </span>

          {/* Heartbeat */}
          <div className="text-[10px] text-slate-500 w-16 text-right">
            {formatTimeAgo(fleet.last_heartbeat)}
          </div>

          {/* Expand arrow */}
          <span className="text-slate-500 text-xs">{expanded ? '▼' : '▶'}</span>
        </div>
      </button>

      {/* Expanded Detail */}
      {expanded && (
        <div className="px-4 pb-3 pt-1 border-t border-white/[0.04] space-y-3">
          {/* Capabilities */}
          <div>
            <div className="text-[10px] text-slate-500 mb-1">Capabilities</div>
            <div className="flex flex-wrap gap-1">
              {fleet.capabilities.map((cap) => (
                <span key={cap} className="text-[10px] px-2 py-0.5 rounded bg-blue-400/10 text-blue-400">
                  {cap}
                </span>
              ))}
              {fleet.capabilities.length === 0 && (
                <span className="text-[10px] text-slate-600">None reported</span>
              )}
            </div>
          </div>

          {/* System Stats */}
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-white/[0.02] rounded p-2">
              <div className="text-[10px] text-slate-500">Avg Context</div>
              <div className={`text-xs font-medium ${
                avgContext > 85 ? 'text-red-400' : avgContext > 65 ? 'text-amber-400' : 'text-emerald-400'
              }`}>{avgContext}%</div>
            </div>
            <div className="bg-white/[0.02] rounded p-2">
              <div className="text-[10px] text-slate-500">Disk Free</div>
              <div className="text-xs font-medium text-white">{diskFree} GB</div>
            </div>
            <div className="bg-white/[0.02] rounded p-2">
              <div className="text-[10px] text-slate-500">Memory Free</div>
              <div className="text-xs font-medium text-white">{memFree} GB</div>
            </div>
            <div className="bg-white/[0.02] rounded p-2">
              <div className="text-[10px] text-slate-500">IP Allow-List</div>
              <div className="text-xs font-medium text-white">{fleet.allowed_ips.length || 'Any'}</div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {fleet.status === 'suspended' && (
              <button
                onClick={onUnsuspend}
                className="text-[10px] px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
              >
                🔓 Unsuspend (Rotate Keys)
              </button>
            )}
            <button
              onClick={onRemove}
              className="text-[10px] px-3 py-1.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              🗑 Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
