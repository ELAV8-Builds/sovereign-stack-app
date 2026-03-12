/**
 * Overmind — Main Control Panel
 *
 * The brain of Sovereign Stack. Provides visibility and control over:
 * - Fleet workers (native Claude Code sessions)
 * - Jobs (multi-step build tasks)
 * - System (orchestrator health)
 *
 * Uses WebSocket for real-time updates with REST polling as fallback.
 */
import { useState } from 'react';
import { FleetView } from './FleetView';
import { JobsView } from './JobsView';
import { SystemView } from './SystemView';
import { useOvermindSocket } from '@/lib/useOvermindSocket';

type OvTab = 'fleet' | 'jobs' | 'system';

export function Overmind() {
  const [activeTab, setActiveTab] = useState<OvTab>('fleet');

  // Real-time WebSocket connection to Overmind event bridge
  const { connected, snapshot, lastEvent, eventCount, reconnect } = useOvermindSocket(true);

  // Derive orchestrator status from snapshot
  const orchStatus = snapshot?.orchestrator || null;

  const tabs: { id: OvTab; label: string; icon: string }[] = [
    { id: 'fleet', label: 'Fleet', icon: '🖥' },
    { id: 'jobs', label: 'Jobs', icon: '📋' },
    { id: 'system', label: 'System', icon: '⚙' },
  ];

  return (
    <div className="h-full flex flex-col bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <span className="text-lg">🧠</span>
          <div>
            <h1 className="text-sm font-semibold text-white tracking-wide">Overmind</h1>
            <p className="text-[10px] text-slate-500">
              {connected
                ? `Tick #${orchStatus?.tick_count || 0} · ${orchStatus?.running ? 'Running' : 'Stopped'}${eventCount > 0 ? ` · ${eventCount} events` : ''}`
                : 'Connecting...'}
            </p>
          </div>
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-2">
          <button
            onClick={reconnect}
            className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
            title="Reconnect WebSocket"
          >
            ↻
          </button>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
          <span className="text-[10px] text-slate-500 font-medium">
            {connected ? 'Live' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-white/[0.04]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-white/[0.08] text-white'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'fleet' && <FleetView lastEvent={lastEvent} />}
        {activeTab === 'jobs' && <JobsView lastEvent={lastEvent} />}
        {activeTab === 'system' && <SystemView lastEvent={lastEvent} />}
      </div>
    </div>
  );
}
