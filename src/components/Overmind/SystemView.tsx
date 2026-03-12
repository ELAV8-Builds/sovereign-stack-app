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

      {/* Active Rules */}
      <div className="border border-white/[0.06] rounded-xl bg-slate-900/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Rules Engine
          </h3>
          <span className="text-[10px] text-slate-600">
            {rules.filter((r) => r.enabled).length} active / {rules.length} total
          </span>
        </div>

        {rules.length === 0 ? (
          <p className="text-[11px] text-slate-600 py-2">
            No rules configured. The orchestrator uses default policies.
          </p>
        ) : (
          <div className="space-y-1.5">
            {rules.slice(0, 15).map((rule) => (
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
