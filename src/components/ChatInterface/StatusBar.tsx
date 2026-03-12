import type { ChannelStatus } from "./types";

interface StatusBarProps {
  channels: ChannelStatus;
  agentRunning: boolean;
  llmAvailable: boolean | null;
  messageCount: number;
  onShowLaunchAgent: () => void;
  onShowSoundSettings: () => void;
  onRetryConnection: () => void;
}

export function StatusBar({
  channels,
  agentRunning,
  llmAvailable,
  messageCount,
  onShowLaunchAgent,
  onShowSoundSettings,
  onRetryConnection,
}: StatusBarProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/50">
      <div className="flex items-center gap-3">
        {/* Overmind Brain Indicator */}
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-900/30 text-indigo-400 border border-indigo-800">
          <span className={`w-1.5 h-1.5 rounded-full ${agentRunning ? "bg-indigo-400 animate-pulse" : "bg-indigo-400"}`} />
          Overmind
        </span>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
              channels.whatsapp
                ? "bg-green-900/30 text-green-400 border border-green-800"
                : "bg-slate-800 text-slate-500 border border-slate-700"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                channels.whatsapp ? "bg-green-400 animate-pulse" : "bg-slate-600"
              }`}
            />
            WhatsApp
          </span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
              channels.slack
                ? "bg-purple-900/30 text-purple-400 border border-purple-800"
                : "bg-slate-800 text-slate-500 border border-slate-700"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                channels.slack ? "bg-purple-400 animate-pulse" : "bg-slate-600"
              }`}
            />
            Slack
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {/* Launch Agent Button */}
        <button
          onClick={onShowLaunchAgent}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-blue-800 bg-blue-900/30 text-blue-400 hover:bg-blue-900/50 transition-all cursor-pointer"
          title="Launch a new fleet agent"
        >
          <span className="text-sm leading-none">+</span>
          New Agent
        </button>

        {/* Sound Settings Button */}
        <button
          onClick={onShowSoundSettings}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white transition-all cursor-pointer"
          title="Sound settings"
        >
          🔔
        </button>

        {llmAvailable === false && (
          <button
            onClick={onRetryConnection}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-900/30 text-yellow-400 border border-yellow-800 hover:bg-yellow-900/50 cursor-pointer transition-all"
            title="Click to retry connection"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
            Disconnected — Retry
          </button>
        )}
        {llmAvailable === true && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/30 text-green-400 border border-green-800">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            AI Connected
          </span>
        )}
        <span className="text-xs text-slate-600">{messageCount} messages</span>
      </div>
    </div>
  );
}
