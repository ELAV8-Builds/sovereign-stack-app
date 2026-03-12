/**
 * HealthFeed — Live health event stream
 */
import { useState, useEffect, useCallback } from 'react';
import { getHealthEvents, type OvHealthEvent } from '@/lib/overmind';

export function HealthFeed() {
  const [events, setEvents] = useState<OvHealthEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  const refresh = useCallback(async () => {
    try {
      const severity = filter !== 'all' ? filter : undefined;
      const data = await getHealthEvents(50, severity);
      if (data) setEvents(data);
    } catch {
      // Non-critical — keep showing last known data
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const severityConfig: Record<string, { color: string; icon: string }> = {
    info: { color: 'text-slate-400', icon: 'ℹ' },
    warn: { color: 'text-amber-400', icon: '⚡' },
    error: { color: 'text-red-400', icon: '✗' },
    critical: { color: 'text-red-500', icon: '🔴' },
  };

  const formatTime = (dateStr: string): string => {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour12: false });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="animate-spin w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filter */}
      <div className="flex items-center gap-1">
        {['all', 'info', 'warn', 'error', 'critical'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[10px] px-2 py-1 rounded-lg transition-colors ${
              filter === f
                ? 'bg-indigo-500/20 text-indigo-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {events.length === 0 ? (
        <p className="text-center text-[11px] text-slate-600 py-4">No health events recorded yet</p>
      ) : (
        <div className="space-y-0.5 font-mono text-[11px]">
          {events.map((event) => {
            const sc = severityConfig[event.severity] || severityConfig.info;
            return (
              <div key={event.id} className="flex items-start gap-2 py-1 px-2 rounded hover:bg-slate-800/30">
                <span className="text-slate-600 shrink-0">[{formatTime(event.created_at)}]</span>
                <span className={`shrink-0 ${sc.color}`}>{sc.icon}</span>
                <span className="text-slate-400">{event.message}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
