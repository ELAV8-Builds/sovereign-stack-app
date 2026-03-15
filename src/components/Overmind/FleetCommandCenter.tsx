/**
 * Fleet Command Center — Unified Operational View
 *
 * Single-page view showing everything operational:
 * - Fleet overview stats (machines, workers, jobs, health)
 * - Machines list with status
 * - Workers with live activity digest
 * - Active + recent jobs with progress
 * - Live activity feed from WebSocket events
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  getFleetDashboard,
  getFleetWorkers,
  getFleetStatus,
  getFleetSafety,
  getOvJobs,
  cancelOvJob,
  removeFleetMachine,
  removeFleetWorker,
  requestWorkerCheckpoint,
  requestWorkerRestart,
  requestWorkerStop,
  registerFleetWorker,
  resetFleetCircuitBreaker,
  sweepFleetMachines,
  unsuspendFleet,
  getDeployHistory,
  getRecentConversations,
  getActiveSessions,
  type FleetDashboard,
  type FleetWorker,
  type FleetStatus,
  type FleetSafety,
  type FleetMachine,
  type OvJob,
  type OvDeployRecord,
  type OvConversation,
  type ActiveSession,
} from '@/lib/overmind';
import type { OvermindEvent } from '@/lib/useOvermindSocket';

interface FleetCommandCenterProps {
  lastEvent?: OvermindEvent | null;
}

// ─── Helpers ──────────────────────────────────────────────────────

function timeAgo(ts: string | null): string {
  if (!ts) return 'never';
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const JOB_STATUS: Record<string, { color: string; bg: string; label: string }> = {
  pending: { color: 'text-slate-400', bg: 'bg-slate-500/20', label: 'Pending' },
  planning: { color: 'text-indigo-400', bg: 'bg-indigo-500/20', label: 'Planning' },
  running: { color: 'text-blue-400', bg: 'bg-blue-500/20', label: 'Running' },
  needs_review: { color: 'text-amber-400', bg: 'bg-amber-500/20', label: 'Review' },
  completed: { color: 'text-emerald-400', bg: 'bg-emerald-500/20', label: 'Done' },
  failed: { color: 'text-red-400', bg: 'bg-red-500/20', label: 'Failed' },
};

const MACHINE_STATUS: Record<string, { dot: string; text: string }> = {
  healthy: { dot: 'bg-emerald-400', text: 'text-emerald-400' },
  unhealthy: { dot: 'bg-amber-400', text: 'text-amber-400' },
  offline: { dot: 'bg-slate-500', text: 'text-slate-500' },
  suspended: { dot: 'bg-red-500', text: 'text-red-400' },
};

// ─── Main Component ──────────────────────────────────────────────

export function FleetCommandCenter({ lastEvent }: FleetCommandCenterProps) {
  const [dashboard, setDashboard] = useState<FleetDashboard | null>(null);
  const [workers, setWorkers] = useState<FleetWorker[]>([]);
  const [workerStatus, setWorkerStatus] = useState<FleetStatus | null>(null);
  const [safety, setSafety] = useState<FleetSafety | null>(null);
  const [jobs, setJobs] = useState<OvJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [deploys, setDeploys] = useState<OvDeployRecord[]>([]);
  const [conversations, setConversations] = useState<OvConversation[]>([]);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [activityLog, setActivityLog] = useState<OvermindEvent[]>([]);
  const [expandedMachine, setExpandedMachine] = useState<string | null>(null);
  const [expandedWorker, setExpandedWorker] = useState<string | null>(null);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [showAddWorker, setShowAddWorker] = useState(false);

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      getFleetDashboard(),
      getFleetWorkers(),
      getFleetStatus(),
      getFleetSafety(),
      getOvJobs(),
      getDeployHistory(),
      getRecentConversations(5),
      getActiveSessions(),
    ]);
    const val = <T,>(r: PromiseSettledResult<T>, fallback: T): T =>
      r.status === 'fulfilled' ? r.value : fallback;

    const db = val(results[0], null);
    if (db) setDashboard(db);
    setWorkers(val(results[1], []));
    setWorkerStatus(val(results[2], null));
    setSafety(val(results[3], null));
    setJobs(val(results[4], []));
    setDeploys(val(results[5], []) || []);
    setConversations(val(results[6], []));
    setActiveSessions(val(results[7], []));
    setLoading(false);
  }, []);

  const lastEventRef = useRef(lastEvent);
  useEffect(() => {
    if (lastEvent && lastEvent !== lastEventRef.current) {
      lastEventRef.current = lastEvent;
      if (lastEvent.type !== 'snapshot') {
        setActivityLog(prev => [lastEvent, ...prev].slice(0, 50));
      }
      const refreshEvents = [
        'snapshot', 'fleet_update', 'fleet_machine_registered', 'fleet_machine_removed',
        'job_update', 'job_completed', 'job_failed', 'job_running', 'task_queued',
        'task_assigned', 'checkpoint', 'command', 'phase_advanced', 'deploy_completed',
        'chat_message', 'job_handoff',
      ];
      if (refreshEvents.includes(lastEvent.type)) {
        refresh();
      }
    }
  }, [lastEvent, refresh]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 12_000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="animate-spin w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  const activeJobs = jobs.filter(j => ['pending', 'planning', 'running', 'needs_review'].includes(j.status));
  const recentJobs = jobs.filter(j => ['completed', 'failed'].includes(j.status)).slice(0, 5);
  const issues = (dashboard?.unhealthy || 0) + (dashboard?.offline || 0) + (dashboard?.suspended || 0);

  return (
    <div className="p-4 space-y-5 overflow-auto">
      {/* ═══ Active Sessions ═══ */}
      {activeSessions.length > 0 && (
        <div className="border border-blue-500/20 rounded-xl bg-blue-500/[0.03] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-blue-500/10">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <h2 className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Working Now</h2>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">{activeSessions.length}</span>
          </div>
          <div className="divide-y divide-white/[0.03]">
            {activeSessions.map(s => {
              const mins = Math.floor(s.duration_s / 60);
              const secs = s.duration_s % 60;
              return (
                <div key={s.conversation_id} className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
                    <span className="text-xs font-medium text-white truncate flex-1">{s.title || 'Agent session'}</span>
                    <span className="text-[10px] text-blue-400 font-mono flex-shrink-0">{mins}m {secs}s</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-slate-500 pl-3.5">
                    <span>Iteration {s.current_iteration}</span>
                    <span>{s.tool_calls} tool calls</span>
                    {s.last_tool && <span className="text-slate-400 font-mono">{s.last_tool}</span>}
                    <span className="ml-auto text-slate-600">{timeAgo(s.last_activity)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ Overview Stats ═══ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <StatCard label="Machines" value={dashboard?.total || 0} />
        <StatCard label="Healthy" value={dashboard?.healthy || 0} color="text-emerald-400" />
        <StatCard label="Workers" value={workerStatus?.total || 0} sub={`/ ${safety?.max_workers || 5} cap`} color="text-blue-400" />
        <StatCard label="Active" value={activeSessions.length > 0 ? activeSessions.length : activeJobs.length} color={activeSessions.length > 0 ? 'text-blue-400' : activeJobs.length > 0 ? 'text-indigo-400' : undefined} pulse={activeSessions.length > 0 || activeJobs.length > 0} sub={activeSessions.length > 0 ? 'working' : undefined} />
        <StatCard label="Load" value={`${workerStatus?.total_load || 0}/${workerStatus?.total_capacity || 0}`} color="text-cyan-400" />
        <StatCard label="Issues" value={issues} color={issues > 0 ? 'text-amber-400' : 'text-emerald-400'} />
      </div>

      {/* ═══ Live Conversations ═══ */}
      {conversations.length > 0 && (
        <Section title="Recent Conversations" count={conversations.length} pulse={conversations.some(c => {
          const age = (Date.now() - new Date(c.created_at).getTime()) / 1000;
          return age < 300;
        })}>
          <div className="space-y-0.5">
            {conversations.map(conv => (
              <ConversationRow key={conv.id} conversation={conv} />
            ))}
          </div>
        </Section>
      )}

      {/* Circuit breaker warning */}
      {safety?.circuit_breaker_open && (
        <button
          onClick={async () => { try { await resetFleetCircuitBreaker(); toast.success('Circuit breaker reset'); refresh(); } catch (err) { toast.error((err as Error).message); } }}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/20 hover:bg-red-500/25 transition-colors"
        >
          Circuit Breaker Open — Click to Reset
        </button>
      )}

      {/* ═══ Machines ═══ */}
      <Section
        title="Machines"
        count={dashboard?.fleets?.length || 0}
        actions={
          <div className="flex items-center gap-1.5">
            <MiniButton onClick={async () => { try { await sweepFleetMachines(); toast.success('Sweep complete'); refresh(); } catch (err) { toast.error((err as Error).message); } }}>Sweep</MiniButton>
            <MiniButton onClick={refresh}>Refresh</MiniButton>
          </div>
        }
      >
        {(!dashboard?.fleets || dashboard.fleets.length === 0) ? (
          <EmptyState icon="🖥" message="No machines registered" />
        ) : (
          <div className="space-y-1.5">
            {dashboard.fleets.map(machine => (
              <MachineRow
                key={machine.id}
                machine={machine}
                expanded={expandedMachine === machine.id}
                onToggle={() => setExpandedMachine(expandedMachine === machine.id ? null : machine.id)}
                onRemove={async () => { try { await removeFleetMachine(machine.id); toast.success(`Removed ${machine.fleet_name}`); refresh(); } catch (err) { toast.error((err as Error).message); } }}
                onUnsuspend={async () => { try { await unsuspendFleet(machine.id); toast.success('Unsuspended'); refresh(); } catch (err) { toast.error((err as Error).message); } }}
              />
            ))}
          </div>
        )}
      </Section>

      {/* ═══ Workers ═══ */}
      <Section
        title="Workers"
        count={workers.length}
        badge={workerStatus ? `${workerStatus.healthy} healthy` : undefined}
        badgeColor="text-emerald-400"
        actions={
          <div className="flex items-center gap-1.5">
            <MiniButton onClick={() => setShowAddWorker(true)} accent>+ Add</MiniButton>
          </div>
        }
      >
        {workers.length === 0 ? (
          <EmptyState icon="👷" message="No workers online" sub="Workers register automatically or add one manually" />
        ) : (
          <div className="space-y-1.5">
            {workers.map(worker => (
              <WorkerRow
                key={worker.id}
                worker={worker}
                expanded={expandedWorker === worker.id}
                onToggle={() => setExpandedWorker(expandedWorker === worker.id ? null : worker.id)}
                onCheckpoint={async () => { try { await requestWorkerCheckpoint(worker.id); toast.success(`Checkpoint: ${worker.name}`); } catch (err) { toast.error((err as Error).message); } }}
                onRestart={async () => { try { await requestWorkerRestart(worker.id); toast.success(`Restart: ${worker.name}`); refresh(); } catch (err) { toast.error((err as Error).message); } }}
                onStop={async () => { try { await requestWorkerStop(worker.id); toast.success(`Stop: ${worker.name}`); refresh(); } catch (err) { toast.error((err as Error).message); } }}
                onRemove={async () => { try { await removeFleetWorker(worker.id); toast.success(`Removed ${worker.name}`); refresh(); } catch (err) { toast.error((err as Error).message); } }}
              />
            ))}
          </div>
        )}
      </Section>

      {/* ═══ Active Jobs ═══ */}
      <Section
        title="Active Jobs"
        count={activeJobs.length}
        pulse={activeJobs.length > 0}
      >
        {activeJobs.length === 0 ? (
          <EmptyState icon="📋" message="No active jobs" sub="Jobs appear here when agents are working" />
        ) : (
          <div className="space-y-1.5">
            {activeJobs.map(job => (
              <JobRow
                key={job.id}
                job={job}
                expanded={expandedJob === job.id}
                onToggle={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
                onCancel={async () => { try { await cancelOvJob(job.id); toast.success(`Cancelled: ${job.title}`); refresh(); } catch (err) { toast.error((err as Error).message); } }}
              />
            ))}
          </div>
        )}
      </Section>

      {/* ═══ Recent Jobs ═══ */}
      {recentJobs.length > 0 && (
        <Section title="Recent Jobs" count={recentJobs.length}>
          <div className="space-y-1">
            {recentJobs.map(job => (
              <JobRow key={job.id} job={job} compact />
            ))}
          </div>
        </Section>
      )}

      {/* ═══ Recent Deploys ═══ */}
      {deploys.length > 0 && (
        <Section title="Recent Deploys" count={deploys.length}>
          <div className="space-y-0.5">
            {deploys.slice(0, 5).map(d => (
              <DeployRow key={d.id} deploy={d} />
            ))}
          </div>
        </Section>
      )}

      {/* ═══ Activity Feed ═══ */}
      <Section title="Activity Feed" count={activityLog.length}>
        {activityLog.length === 0 ? (
          <EmptyState icon="📡" message="Listening for events..." sub="Activity will appear as agents work" />
        ) : (
          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            {activityLog.slice(0, 20).map((evt, i) => (
              <ActivityRow key={`${evt.timestamp}-${i}`} event={evt} />
            ))}
          </div>
        )}
      </Section>

      {/* Add Worker Dialog */}
      {showAddWorker && (
        <AddWorkerDialog
          onClose={() => setShowAddWorker(false)}
          onAdded={() => { setShowAddWorker(false); refresh(); }}
          safety={safety}
          currentCount={workers.length}
        />
      )}
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────────

function StatCard({ label, value, sub, color, pulse }: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  pulse?: boolean;
}) {
  return (
    <div className="bg-white/[0.025] rounded-lg p-3 border border-white/[0.05]">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="flex items-baseline gap-1 mt-1">
        <span className={`text-lg font-bold ${color || 'text-white'}`}>{value}</span>
        {sub && <span className="text-[10px] text-slate-600">{sub}</span>}
        {pulse && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse ml-1" />}
      </div>
    </div>
  );
}

// ─── Section Wrapper ─────────────────────────────────────────────

function Section({ title, count, badge, badgeColor, pulse, actions, children }: {
  title: string;
  count?: number;
  badge?: string;
  badgeColor?: string;
  pulse?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">{title}</h2>
          {count !== undefined && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500">{count}</span>
          )}
          {badge && <span className={`text-[10px] ${badgeColor || 'text-slate-500'}`}>{badge}</span>}
          {pulse && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
        </div>
        {actions}
      </div>
      <div className="border border-white/[0.05] rounded-xl bg-slate-900/40 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

// ─── Machine Row ─────────────────────────────────────────────────

function MachineRow({ machine, expanded, onToggle, onRemove, onUnsuspend }: {
  machine: FleetMachine;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onUnsuspend: () => void;
}) {
  const s = MACHINE_STATUS[machine.status] || MACHINE_STATUS.offline;
  const workersActive = (machine.metadata as any)?.workers_active || 0;

  return (
    <div>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors border-b border-white/[0.03] last:border-0">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-white">{machine.fleet_name}</span>
            <span className="text-[10px] text-slate-600">{machine.machine_name}</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {machine.endpoint} · {machine.region} · {workersActive}/{machine.max_workers} workers
          </div>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded ${s.text} bg-white/[0.03]`}>{machine.status}</span>
        <span className="text-[10px] text-slate-600 w-14 text-right">{timeAgo(machine.last_heartbeat)}</span>
        <span className="text-[9px] text-slate-600">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="px-4 py-3 bg-black/20 border-b border-white/[0.03] space-y-2">
          {machine.capabilities.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {machine.capabilities.map(c => (
                <span key={c} className="text-[9px] px-1.5 py-0.5 rounded bg-blue-400/10 text-blue-400">{c}</span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            {machine.status === 'suspended' && (
              <button onClick={onUnsuspend} className="text-[10px] px-2.5 py-1 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors">
                Unsuspend
              </button>
            )}
            <button onClick={onRemove} className="text-[10px] px-2.5 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Worker Row ──────────────────────────────────────────────────

function WorkerRow({ worker, expanded, onToggle, onCheckpoint, onRestart, onStop, onRemove }: {
  worker: FleetWorker;
  expanded: boolean;
  onToggle: () => void;
  onCheckpoint: () => void;
  onRestart: () => void;
  onStop: () => void;
  onRemove: () => void;
}) {
  const statusDot = {
    healthy: 'bg-emerald-400',
    unhealthy: 'bg-amber-400',
    quarantined: 'bg-red-400',
    restarting: 'bg-blue-400 animate-pulse',
  }[worker.status] || 'bg-slate-500';

  const ctxColor = worker.context_usage >= 85 ? 'bg-red-500' :
    worker.context_usage >= 75 ? 'bg-amber-500' :
    worker.context_usage >= 65 ? 'bg-yellow-500' : 'bg-emerald-500';

  const ctxLabel = worker.context_usage >= 85 ? 'CRITICAL' :
    worker.context_usage >= 75 ? 'HIGH' :
    worker.context_usage >= 65 ? 'WARM' : null;

  return (
    <div>
      <div
        onClick={onToggle}
        className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors cursor-pointer border-b border-white/[0.03] last:border-0"
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-white">{worker.name}</span>
            <span className="text-[10px] text-slate-600 font-mono">{worker.id.slice(0, 8)}</span>
            {ctxLabel && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
                ctxLabel === 'CRITICAL' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                ctxLabel === 'HIGH' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
              }`}>{ctxLabel}</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <div className="flex items-center gap-1.5">
              <div className="w-16 h-1 bg-slate-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${ctxColor}`} style={{ width: `${Math.min(worker.context_usage, 100)}%` }} />
              </div>
              <span className="text-[10px] text-slate-600">{worker.context_usage}%</span>
            </div>
            <span className="text-[10px] text-slate-600">Load {worker.current_load}/{worker.max_load}</span>
            <span className="text-[10px] text-slate-600">{timeAgo(worker.last_heartbeat)}</span>
          </div>
        </div>
        <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
          <ActionBtn onClick={onCheckpoint} title="Checkpoint">💾</ActionBtn>
          <ActionBtn onClick={onRestart} title="Restart">🔄</ActionBtn>
          <ActionBtn onClick={onStop} title="Stop">⏹</ActionBtn>
        </div>
        <span className="text-[9px] text-slate-600">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="px-4 py-2.5 bg-black/20 border-b border-white/[0.03]">
          <div className="flex flex-wrap gap-1 mb-2">
            {worker.capabilities.map(c => (
              <span key={c} className="text-[9px] px-1.5 py-0.5 rounded bg-blue-400/10 text-blue-400">{c}</span>
            ))}
            {worker.capabilities.length === 0 && <span className="text-[10px] text-slate-600">No capabilities reported</span>}
          </div>
          <button onClick={onRemove} className="text-[10px] px-2.5 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">
            Remove from fleet
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Job Row ─────────────────────────────────────────────────────

function JobRow({ job, expanded, onToggle, onCancel, compact }: {
  job: OvJob;
  expanded?: boolean;
  onToggle?: () => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const sc = JOB_STATUS[job.status] || JOB_STATUS.pending;
  const isActive = ['pending', 'planning', 'running'].includes(job.status);

  if (compact) {
    return (
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/[0.03] last:border-0">
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${sc.bg} ${sc.color}`}>{sc.label}</span>
        <span className="text-[11px] text-slate-400 flex-1 truncate">{job.title}</span>
        <span className="text-[10px] text-slate-600">{timeAgo(job.updated_at || job.created_at)}</span>
      </div>
    );
  }

  return (
    <div>
      <div
        onClick={onToggle}
        className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors cursor-pointer border-b border-white/[0.03] last:border-0"
      >
        <span className={`text-[9px] px-2 py-0.5 rounded font-medium ${sc.bg} ${sc.color}`}>{sc.label}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-white truncate">{job.title}</span>
            {isActive && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />}
          </div>
          {job.description && (
            <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">{job.description}</p>
          )}
        </div>
        <span className="text-[10px] text-slate-600">{timeAgo(job.created_at)}</span>
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {isActive && onCancel && (
            <button onClick={onCancel} className="text-[10px] px-2 py-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
              Cancel
            </button>
          )}
        </div>
        <span className="text-[9px] text-slate-600">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="px-4 py-3 bg-black/20 border-b border-white/[0.03]">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
            <div>
              <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Source</div>
              <div className="text-slate-400">{job.source}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Created By</div>
              <div className="text-slate-400">{job.created_by}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">ID</div>
              <div className="text-slate-400 font-mono">{job.id}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">Created</div>
              <div className="text-slate-400">{new Date(job.created_at).toLocaleString()}</div>
            </div>
          </div>
          {/* Status timeline */}
          <div className="mt-3 flex items-center gap-1">
            {['pending', 'planning', 'running', 'completed'].map((step, i) => {
              const order = ['pending', 'planning', 'running', 'needs_review', 'completed'];
              const cur = order.indexOf(job.status);
              const idx = order.indexOf(step);
              const done = idx < cur;
              const active = step === job.status;
              return (
                <div key={step} className="flex items-center gap-1">
                  <div className={`w-2 h-2 rounded-full ${
                    job.status === 'failed' && active ? 'bg-red-400' :
                    active ? 'bg-blue-400 animate-pulse' :
                    done ? 'bg-emerald-400' : 'bg-slate-700'
                  }`} />
                  <span className={`text-[10px] ${active ? 'text-white font-medium' : done ? 'text-slate-400' : 'text-slate-600'}`}>{step}</span>
                  {i < 3 && <span className="text-slate-700 text-[10px] mx-0.5">→</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Activity Row ────────────────────────────────────────────────

const EVENT_LABELS: Record<string, { icon: string; label: string }> = {
  snapshot: { icon: '📸', label: 'Snapshot' },
  fleet_update: { icon: '🔄', label: 'Fleet update' },
  fleet_machine_registered: { icon: '🖥', label: 'Machine registered' },
  fleet_machine_removed: { icon: '🗑', label: 'Machine removed' },
  job_update: { icon: '📋', label: 'Job updated' },
  job_completed: { icon: '✅', label: 'Job completed' },
  job_failed: { icon: '❌', label: 'Job failed' },
  job_running: { icon: '▶', label: 'Job started' },
  task_queued: { icon: '📥', label: 'Task queued' },
  task_assigned: { icon: '🎯', label: 'Task assigned' },
  checkpoint: { icon: '💾', label: 'Checkpoint' },
  command: { icon: '⚡', label: 'Command' },
  phase_advanced: { icon: '⏭', label: 'Phase advanced' },
  chat_message: { icon: '💬', label: 'Chat' },
  job_handoff: { icon: '🤝', label: 'Job handoff' },
  recipe_created: { icon: '📦', label: 'Playbook created' },
  recipe_updated: { icon: '✏️', label: 'Playbook updated' },
  recipe_deleted: { icon: '🗑', label: 'Playbook deleted' },
  orchestrator_health: { icon: '💊', label: 'Health check' },
};

function ActivityRow({ event }: { event: OvermindEvent }) {
  const info = EVENT_LABELS[event.type] || { icon: '•', label: event.type };
  const detail = (event.data as any)?.title || (event.data as any)?.name || (event.data as any)?.message || '';
  const ts = new Date(event.timestamp);
  const time = `${ts.getHours().toString().padStart(2, '0')}:${ts.getMinutes().toString().padStart(2, '0')}:${ts.getSeconds().toString().padStart(2, '0')}`;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] border-b border-white/[0.02] last:border-0">
      <span className="text-[10px] text-slate-600 font-mono w-14 flex-shrink-0">{time}</span>
      <span className="flex-shrink-0">{info.icon}</span>
      <span className="text-slate-400">{info.label}</span>
      {detail && <span className="text-slate-600 truncate">— {detail}</span>}
    </div>
  );
}

// ─── Conversation Row ────────────────────────────────────────────

function ConversationRow({ conversation: c }: { conversation: OvConversation }) {
  const age = (Date.now() - new Date(c.created_at).getTime()) / 1000;
  const isRecent = age < 300;
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-white/[0.03] last:border-0">
      {isRecent ? (
        <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
      ) : (
        <span className="w-2 h-2 rounded-full bg-slate-600 flex-shrink-0" />
      )}
      <span className="text-[11px] text-slate-400 flex-1 truncate">{c.first_message || 'Conversation'}</span>
      <span className="text-[10px] text-slate-600 flex-shrink-0">{c.message_count} msg{c.message_count !== 1 ? 's' : ''}</span>
      <span className="text-[10px] text-slate-600 flex-shrink-0">{timeAgo(c.created_at)}</span>
    </div>
  );
}

// ─── Deploy Row ──────────────────────────────────────────────────

const DEPLOY_STATUS: Record<string, { color: string; bg: string; icon: string }> = {
  success: { color: 'text-emerald-400', bg: 'bg-emerald-500/20', icon: '✓' },
  failed: { color: 'text-red-400', bg: 'bg-red-500/20', icon: '✗' },
  rolled_back: { color: 'text-amber-400', bg: 'bg-amber-500/20', icon: '↩' },
  building: { color: 'text-blue-400', bg: 'bg-blue-500/20', icon: '⚙' },
  deploying: { color: 'text-indigo-400', bg: 'bg-indigo-500/20', icon: '🚀' },
  pending: { color: 'text-slate-400', bg: 'bg-slate-500/20', icon: '⏳' },
};

function DeployRow({ deploy: d }: { deploy: OvDeployRecord }) {
  const sc = DEPLOY_STATUS[d.deploy_status] || DEPLOY_STATUS.pending;
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-white/[0.03] last:border-0">
      <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${sc.bg} ${sc.color}`}>{sc.icon} {d.deploy_status}</span>
      <span className="text-[11px] text-white font-medium">#{d.version}</span>
      <span className="text-[11px] text-slate-400 flex-1 truncate">{d.reason || d.change_type}</span>
      <span className="text-[10px] text-slate-600">{d.files_changed.length} file{d.files_changed.length !== 1 ? 's' : ''}</span>
      <span className="text-[10px] text-slate-600">{timeAgo(d.created_at)}</span>
    </div>
  );
}

// ─── Micro Components ────────────────────────────────────────────

function MiniButton({ children, onClick, accent }: { children: React.ReactNode; onClick: () => void; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`text-[10px] px-2 py-1 rounded transition-all ${
        accent
          ? 'bg-indigo-600/80 text-white hover:bg-indigo-500'
          : 'bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/[0.08]'
      }`}
    >
      {children}
    </button>
  );
}

function ActionBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} title={title} className="px-1.5 py-1 rounded text-[11px] text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors">
      {children}
    </button>
  );
}

function EmptyState({ icon, message, sub }: { icon: string; message: string; sub?: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <div className="text-2xl mb-2">{icon}</div>
      <p className="text-xs text-slate-500">{message}</p>
      {sub && <p className="text-[10px] text-slate-600 mt-1">{sub}</p>}
    </div>
  );
}

// ─── Add Worker Dialog ───────────────────────────────────────────

function AddWorkerDialog({ onClose, onAdded, safety, currentCount }: {
  onClose: () => void;
  onAdded: () => void;
  safety: FleetSafety | null;
  currentCount: number;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [capabilities, setCapabilities] = useState('');
  const [maxLoad, setMaxLoad] = useState(3);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !url.trim()) return;
    setSubmitting(true);
    try {
      await registerFleetWorker({
        name: name.trim(),
        url: url.trim(),
        capabilities: capabilities.split(',').map(s => s.trim()).filter(Boolean),
        max_load: maxLoad,
      });
      toast.success(`Worker "${name}" registered`);
      onAdded();
    } catch (err) { toast.error((err as Error).message); }
    finally { setSubmitting(false); }
  };

  const field = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-600 transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-white">Add Worker</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {safety ? `${Math.max(0, safety.max_workers - currentCount)} of ${safety.max_workers} slots` : '...'}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-800 text-slate-500">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1">Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="worker-1" className={field} autoFocus />
          </div>
          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1">URL</label>
            <input type="text" value={url} onChange={e => setUrl(e.target.value)} placeholder="http://localhost:3101" className={`${field} font-mono`} />
          </div>
          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1">Capabilities</label>
            <input type="text" value={capabilities} onChange={e => setCapabilities(e.target.value)} placeholder="code, build, test" className={field} />
          </div>
          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1">Max Tasks</label>
            <input type="number" value={maxLoad} onChange={e => setMaxLoad(Math.min(5, Math.max(1, parseInt(e.target.value) || 1)))} min={1} max={5} className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-600" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-800">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !name.trim() || !url.trim()}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              submitting || !name.trim() || !url.trim()
                ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            {submitting ? 'Adding...' : 'Add Worker'}
          </button>
        </div>
      </div>
    </div>
  );
}
