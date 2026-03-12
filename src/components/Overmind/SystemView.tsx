/**
 * SystemView — Orchestrator Health & System Status
 *
 * Shows orchestrator status, tick count, active rules, and safety info.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getOrchestratorStatus,
  getOvRules,
  getFleetSafety,
  getSlackListenerStatus,
  reconnectSlackListener,
  type OrchestratorStatus,
  type OvRule,
  type FleetSafety,
  type SlackListenerStatus,
} from '@/lib/overmind';
import type { OvermindEvent } from '@/lib/useOvermindSocket';

interface SystemViewProps {
  lastEvent?: OvermindEvent | null;
}

export function SystemView({ lastEvent }: SystemViewProps) {
  const [orch, setOrch] = useState<OrchestratorStatus | null>(null);
  const [rules, setRules] = useState<OvRule[]>([]);
  const [safety, setSafety] = useState<FleetSafety | null>(null);
  const [slack, setSlack] = useState<SlackListenerStatus | null>(null);
  const [slackReconnecting, setSlackReconnecting] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [o, r, s, sl] = await Promise.all([
      getOrchestratorStatus(),
      getOvRules(),
      getFleetSafety(),
      getSlackListenerStatus(),
    ]);
    setOrch(o);
    setRules(r);
    setSafety(s);
    setSlack(sl);
    setLoading(false);
  }, []);

  const handleSlackReconnect = useCallback(async () => {
    setSlackReconnecting(true);
    try {
      const status = await reconnectSlackListener();
      setSlack(status);
    } catch {
      // Refresh to get current state even on failure
      const sl = await getSlackListenerStatus();
      setSlack(sl);
    } finally {
      setSlackReconnecting(false);
    }
  }, []);

  // Auto-refresh on system-related WebSocket events
  const lastEventRef = useRef(lastEvent);
  useEffect(() => {
    if (lastEvent && lastEvent !== lastEventRef.current) {
      lastEventRef.current = lastEvent;
      const sysEvents = ['orchestrator_health', 'snapshot'];
      if (sysEvents.includes(lastEvent.type)) {
        refresh();
      }
    }
  }, [lastEvent, refresh]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const formatUptime = (startedAt: string | null): string => {
    if (!startedAt) return 'N/A';
    const seconds = (Date.now() - new Date(startedAt).getTime()) / 1000;
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
    return `${Math.round(seconds / 86400)}d`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="animate-spin w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5">
      {/* Orchestrator Status Card */}
      <div className="border border-white/[0.06] rounded-xl bg-slate-900/50 p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Orchestrator</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatusItem
            label="Status"
            value={orch?.running ? 'Running' : 'Stopped'}
            color={orch?.running ? 'text-emerald-400' : 'text-red-400'}
          />
          <StatusItem
            label="Ticks"
            value={String(orch?.tick_count || 0)}
          />
          <StatusItem
            label="Interval"
            value={`${(orch?.tick_interval_ms || 15000) / 1000}s`}
          />
          <StatusItem
            label="Uptime"
            value={formatUptime(orch?.started_at || null)}
          />
        </div>
      </div>

      {/* Fleet Safety Card */}
      <div className="border border-white/[0.06] rounded-xl bg-slate-900/50 p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Fleet Safety</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatusItem
            label="Max Workers"
            value={String(safety?.max_workers || 5)}
          />
          <StatusItem
            label="Circuit Breaker"
            value={safety?.circuit_breaker_open ? 'OPEN' : 'Closed'}
            color={safety?.circuit_breaker_open ? 'text-red-400' : 'text-emerald-400'}
          />
          <StatusItem
            label="Failures"
            value={String(safety?.consecutive_failures || 0)}
            color={(safety?.consecutive_failures || 0) > 0 ? 'text-amber-400' : undefined}
          />
          <StatusItem
            label="Spawn Cooldown"
            value={`${(safety?.min_spawn_interval_ms || 30000) / 1000}s`}
          />
        </div>
      </div>

      {/* Slack Integration Card */}
      <div className="border border-white/[0.06] rounded-xl bg-slate-900/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Slack Integration
          </h3>
          <button
            onClick={handleSlackReconnect}
            disabled={slackReconnecting}
            className="text-[10px] text-indigo-400 hover:text-indigo-300 disabled:text-slate-600 disabled:cursor-not-allowed transition-colors"
          >
            {slackReconnecting ? 'Reconnecting...' : 'Reconnect'}
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatusItem
            label="Socket Mode"
            value={slack?.connected ? 'Connected' : 'Disconnected'}
            color={slack?.connected ? 'text-emerald-400' : 'text-slate-500'}
          />
          <StatusItem
            label="Bot User"
            value={slack?.botUserId || 'N/A'}
          />
          <StatusItem
            label="Webhook"
            value={slack?.webhook_configured ? 'Configured' : 'Not Set'}
            color={slack?.webhook_configured ? 'text-emerald-400' : 'text-slate-500'}
          />
          <StatusItem
            label="Mode"
            value={slack?.connected ? 'Socket Mode' : 'Inactive'}
          />
        </div>
        {!slack?.connected && (
          <p className="text-[10px] text-slate-600 mt-3">
            Configure Slack tokens in the vault (slack_bot + slack_app) or set SLACK_BOT_TOKEN and SLACK_APP_TOKEN env vars.
          </p>
        )}
      </div>

      {/* Self-Healing Status */}
      <div className="border border-white/[0.06] rounded-xl bg-slate-900/50 p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Self-Healing</h3>

        {/* Overall system health indicator */}
        <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-slate-800/30">
          <div className={`w-3 h-3 rounded-full ${
            orch?.running && !safety?.circuit_breaker_open
              ? 'bg-emerald-400 animate-pulse'
              : safety?.circuit_breaker_open
                ? 'bg-red-400 animate-pulse'
                : 'bg-amber-400'
          }`} />
          <div>
            <p className={`text-sm font-medium ${
              orch?.running && !safety?.circuit_breaker_open
                ? 'text-emerald-400'
                : safety?.circuit_breaker_open
                  ? 'text-red-400'
                  : 'text-amber-400'
            }`}>
              {orch?.running && !safety?.circuit_breaker_open
                ? 'System Healthy'
                : safety?.circuit_breaker_open
                  ? 'System Needs Attention'
                  : 'System Recovering'}
            </p>
            <p className="text-[10px] text-slate-600">
              {orch?.running
                ? 'Orchestrator loop active — monitoring workers and enforcing rules'
                : 'Orchestrator not running — self-healing is offline'}
            </p>
          </div>
        </div>

        {/* Context Warden Thresholds */}
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="rounded-lg bg-slate-800/30 p-2.5 text-center">
            <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">Warn</p>
            <p className="text-lg font-bold text-yellow-400">65%</p>
            <p className="text-[9px] text-slate-600">Deprioritize</p>
          </div>
          <div className="rounded-lg bg-slate-800/30 p-2.5 text-center">
            <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">Checkpoint</p>
            <p className="text-lg font-bold text-amber-400">75%</p>
            <p className="text-[9px] text-slate-600">Save & Continue</p>
          </div>
          <div className="rounded-lg bg-slate-800/30 p-2.5 text-center">
            <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">Restart</p>
            <p className="text-lg font-bold text-red-400">85%</p>
            <p className="text-[9px] text-slate-600">Force Reset</p>
          </div>
        </div>

        <div className="space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between py-1 px-2 rounded bg-slate-800/20">
            <span className="text-slate-500">Worker health sweep</span>
            <span className={orch?.running ? 'text-emerald-400' : 'text-slate-600'}>
              {orch?.running ? `Every ${(orch?.tick_interval_ms || 15000) / 1000}s` : 'Inactive'}
            </span>
          </div>
          <div className="flex items-center justify-between py-1 px-2 rounded bg-slate-800/20">
            <span className="text-slate-500">Unhealthy after</span>
            <span className="text-slate-400">90s no heartbeat</span>
          </div>
          <div className="flex items-center justify-between py-1 px-2 rounded bg-slate-800/20">
            <span className="text-slate-500">Quarantine after</span>
            <span className="text-slate-400">300s no heartbeat</span>
          </div>
          <div className="flex items-center justify-between py-1 px-2 rounded bg-slate-800/20">
            <span className="text-slate-500">Circuit breaker trips after</span>
            <span className="text-slate-400">3 consecutive failures</span>
          </div>
        </div>
      </div>

      {/* Active Rules Summary (compact — full management in Rules tab) */}
      <div className="border border-white/[0.06] rounded-xl bg-slate-900/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Rules Engine
          </h3>
          <span className="text-[10px] text-slate-600">
            {rules.filter((r) => r.enabled).length} active / {rules.length} total — manage in Rules tab
          </span>
        </div>

        {rules.length === 0 ? (
          <p className="text-[11px] text-slate-600 py-2">
            No rules configured. Go to the Rules tab to seed defaults or create custom rules.
          </p>
        ) : (
          <div className="space-y-1.5">
            {rules.slice(0, 8).map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between py-1.5 px-2.5 rounded bg-slate-800/30"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${rule.enabled ? 'bg-emerald-400' : 'bg-slate-600'}`}
                  />
                  <span className="text-[11px] text-slate-300 font-mono">
                    {rule.category}.{rule.key}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500 font-mono">
                    {typeof rule.value === 'object' ? JSON.stringify(rule.value) : String(rule.value)}
                  </span>
                  <span className="text-[10px] text-slate-600">{rule.scope}</span>
                </div>
              </div>
            ))}
            {rules.length > 8 && (
              <p className="text-[10px] text-slate-600 text-center pt-1">
                +{rules.length - 8} more — see Rules tab
              </p>
            )}
          </div>
        )}
      </div>

      {/* Last Tick Debug Info */}
      {orch?.last_tick && (
        <div className="border border-white/[0.06] rounded-xl bg-slate-900/50 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Last Tick</h3>
          <pre className="text-[10px] text-slate-500 font-mono overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
            {JSON.stringify(orch.last_tick, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function StatusItem({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">{label}</p>
      <p className={`text-sm font-semibold ${color || 'text-white'}`}>{value}</p>
    </div>
  );
}
