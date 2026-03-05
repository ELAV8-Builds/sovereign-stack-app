import { useState, useEffect, useRef } from "react";
import { safeInvoke } from "@/lib/tauri";

interface ActivityEntry {
  id: string;
  timestamp: Date;
  agent: string;
  action: string;
  detail: string;
  level: "info" | "success" | "warning" | "error" | "thinking";
}

// Retro color scheme
const LEVEL_COLORS: Record<string, { text: string; glow: string; prefix: string }> = {
  info: { text: "text-cyan-400", glow: "drop-shadow-[0_0_6px_rgba(34,211,238,0.4)]", prefix: "▸" },
  success: { text: "text-green-400", glow: "drop-shadow-[0_0_6px_rgba(74,222,128,0.4)]", prefix: "✓" },
  warning: { text: "text-amber-400", glow: "drop-shadow-[0_0_6px_rgba(251,191,36,0.4)]", prefix: "⚠" },
  error: { text: "text-red-400", glow: "drop-shadow-[0_0_6px_rgba(248,113,113,0.4)]", prefix: "✗" },
  thinking: { text: "text-purple-400", glow: "drop-shadow-[0_0_6px_rgba(192,132,252,0.4)]", prefix: "◆" },
};

const AGENT_COLORS: Record<string, string> = {
  nanoclaw: "text-blue-400",
  litellm: "text-yellow-400",
  ollama: "text-green-400",
  memu: "text-pink-400",
  system: "text-slate-400",
  agent: "text-cyan-400",
};

// Mock activity data generator
function generateMockActivity(): ActivityEntry {
  const activities: Omit<ActivityEntry, "id" | "timestamp">[] = [
    { agent: "nanoclaw", action: "MSG_RECV", detail: "Incoming message from WhatsApp group 'Work Team'", level: "info" },
    { agent: "litellm", action: "ROUTE", detail: "Request → opus-4.6 (heavy tier) — complexity: high", level: "info" },
    { agent: "litellm", action: "RESPONSE", detail: "Generated 847 tokens in 2.3s — cost: $0.04", level: "success" },
    { agent: "nanoclaw", action: "MSG_SEND", detail: "Response delivered to WhatsApp (342ms)", level: "success" },
    { agent: "memu", action: "STORE", detail: "Memorized conversation context — 3 entries indexed", level: "info" },
    { agent: "ollama", action: "EMBED", detail: "Generated embedding for semantic search (nomic-embed-text)", level: "info" },
    { agent: "agent", action: "THINK", detail: "Analyzing user intent... classification: task_management", level: "thinking" },
    { agent: "agent", action: "THINK", detail: "Planning response... 2 tool calls needed", level: "thinking" },
    { agent: "system", action: "HEALTH", detail: "Health check passed — 6/7 services operational", level: "success" },
    { agent: "system", action: "METRIC", detail: "CPU: 23% | RAM: 4.2GB/16GB | Disk: 45GB free", level: "info" },
    { agent: "litellm", action: "CACHE", detail: "Cache hit — returning cached response (saved $0.02)", level: "success" },
    { agent: "nanoclaw", action: "QUEUE", detail: "Processing message queue — 0 pending, 147 today", level: "info" },
    { agent: "agent", action: "TOOL", detail: "Executing: get_services_status — result: 6 running", level: "info" },
    { agent: "memu", action: "RETRIEVE", detail: "Semantic search: 'deployment config' — 5 results (0.89 relevance)", level: "info" },
    { agent: "system", action: "WARN", detail: "Temporal service not responding — retry 1/3", level: "warning" },
    { agent: "litellm", action: "FALLBACK", detail: "Primary model timeout — falling back to sonnet-4.5", level: "warning" },
    { agent: "nanoclaw", action: "WEBHOOK", detail: "Slack event received: message.channels — #general", level: "info" },
    { agent: "agent", action: "THINK", detail: "Evaluating compound learning trigger... score: 0.72 (below threshold)", level: "thinking" },
    { agent: "ollama", action: "INFER", detail: "Local inference complete — 128 tokens, 45ms", level: "success" },
    { agent: "system", action: "BACKUP", detail: "Auto-backup completed — 2.3MB config snapshot", level: "success" },
  ];

  const activity = activities[Math.floor(Math.random() * activities.length)];
  return {
    ...activity,
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date(),
  };
}

export function AgentActivityLog() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scanlineOffset, setScanlineOffset] = useState(0);

  // Scanline animation
  useEffect(() => {
    const interval = setInterval(() => {
      setScanlineOffset((prev) => (prev + 1) % 100);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  // Generate initial entries
  useEffect(() => {
    const initial: ActivityEntry[] = [];
    for (let i = 0; i < 15; i++) {
      const entry = generateMockActivity();
      entry.timestamp = new Date(Date.now() - (15 - i) * 3000);
      initial.push(entry);
    }
    setEntries(initial);
  }, []);

  // Live feed — add new entries
  useEffect(() => {
    if (isPaused) return;

    // Try real backend first
    const fetchReal = async () => {
      try {
        const realEntries = await safeInvoke<ActivityEntry[]>("get_agent_activity", { limit: 1 });
        if (realEntries && realEntries.length > 0) {
          setEntries((prev) => [...prev.slice(-200), ...realEntries]);
          return true;
        }
      } catch {
        // Fall through to mock
      }
      return false;
    };

    const interval = setInterval(async () => {
      const gotReal = await fetchReal();
      if (!gotReal) {
        // Use mock data
        const newEntry = generateMockActivity();
        setEntries((prev) => [...prev.slice(-200), newEntry]);
      }
    }, 1500 + Math.random() * 2000); // Random interval 1.5-3.5s for natural feel

    return () => clearInterval(interval);
  }, [isPaused]);

  // Auto-scroll
  useEffect(() => {
    if (!isPaused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, isPaused]);

  // Format timestamp
  const formatTs = (date: Date) => {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  // Filter entries
  const filtered =
    filter === "all"
      ? entries
      : entries.filter((e) => e.agent === filter || e.level === filter);

  return (
    <div className="flex flex-col h-full bg-black rounded-xl overflow-hidden border border-slate-800 relative">
      {/* CRT overlay effects */}
      <div className="absolute inset-0 pointer-events-none z-10">
        {/* Scanline */}
        <div
          className="absolute left-0 right-0 h-[2px] bg-green-400/5"
          style={{ top: `${scanlineOffset}%` }}
        />
        {/* CRT vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_50%,rgba(0,0,0,0.4)_100%)]" />
        {/* Horizontal scan lines */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(255,255,255,0.03) 1px, rgba(255,255,255,0.03) 2px)",
          }}
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur z-20">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_6px_rgba(74,222,128,0.6)]" />
            <span className="text-xs font-mono text-green-400 drop-shadow-[0_0_4px_rgba(74,222,128,0.3)]">
              AGENT ACTIVITY
            </span>
          </div>
          <span className="text-[10px] font-mono text-slate-600">
            {entries.length} events
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Filter */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-slate-900 text-xs font-mono text-slate-400 border border-slate-800 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-green-500/50"
          >
            <option value="all">ALL</option>
            <option value="agent">AGENT</option>
            <option value="nanoclaw">NANOCLAW</option>
            <option value="litellm">LITELLM</option>
            <option value="memu">MEMU</option>
            <option value="ollama">OLLAMA</option>
            <option value="system">SYSTEM</option>
            <option value="thinking">THINKING</option>
            <option value="error">ERRORS</option>
          </select>

          {/* Pause/Resume */}
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`px-2 py-1 rounded text-xs font-mono transition-all duration-200 ${
              isPaused
                ? "bg-amber-900/30 text-amber-400 border border-amber-800 hover:bg-amber-900/50"
                : "bg-slate-900 text-slate-400 border border-slate-800 hover:bg-slate-800"
            }`}
          >
            {isPaused ? "▶ RESUME" : "⏸ PAUSE"}
          </button>

          {/* Clear */}
          <button
            onClick={() => setEntries([])}
            className="px-2 py-1 rounded text-xs font-mono bg-slate-900 text-slate-500 border border-slate-800 hover:bg-slate-800 hover:text-slate-400 transition-all duration-200"
          >
            ✕ CLEAR
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto font-mono text-xs leading-6 px-3 py-2 z-20 scrollbar-thin"
      >
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-2xl mb-2 opacity-30">📡</div>
              <div className="text-slate-600 text-xs">
                {isPaused ? "Feed paused" : "Waiting for activity..."}
              </div>
            </div>
          </div>
        ) : (
          filtered.map((entry) => {
            const level = LEVEL_COLORS[entry.level] || LEVEL_COLORS.info;
            const agentColor = AGENT_COLORS[entry.agent] || "text-slate-400";

            return (
              <div
                key={entry.id}
                className="flex items-start gap-2 hover:bg-white/[0.02] rounded px-1 transition-colors duration-100 animate-terminalFadeIn"
              >
                {/* Timestamp */}
                <span className="text-slate-600 flex-shrink-0 w-[60px]">
                  {formatTs(entry.timestamp)}
                </span>

                {/* Level indicator */}
                <span className={`flex-shrink-0 w-3 ${level.text} ${level.glow}`}>
                  {level.prefix}
                </span>

                {/* Agent name */}
                <span className={`flex-shrink-0 w-[72px] ${agentColor} font-bold uppercase tracking-wider text-[10px] leading-6`}>
                  {entry.agent}
                </span>

                {/* Action badge */}
                <span className="flex-shrink-0 w-[64px] text-slate-500 font-bold text-[10px] leading-6">
                  {entry.action}
                </span>

                {/* Detail */}
                <span className={`${level.text} opacity-80 flex-1`}>
                  {entry.detail}
                </span>
              </div>
            );
          })
        )}

        {/* Cursor blink at bottom */}
        {!isPaused && (
          <div className="flex items-center gap-2 px-1 mt-1">
            <span className="text-slate-600 w-[60px]">{formatTs(new Date())}</span>
            <span className="text-green-400 animate-pulse">█</span>
          </div>
        )}
      </div>

      {/* Footer status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-slate-800/80 bg-slate-950/80 backdrop-blur z-20">
        <div className="flex items-center gap-4">
          <span className="text-[10px] font-mono text-slate-600">
            FEED: {isPaused ? "PAUSED" : "LIVE"}
          </span>
          <span className="text-[10px] font-mono text-slate-600">
            FILTER: {filter.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-mono text-slate-600">
            SOVEREIGN STACK v0.3
          </span>
        </div>
      </div>
    </div>
  );
}
