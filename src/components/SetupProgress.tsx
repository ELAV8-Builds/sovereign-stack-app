import { useState, useEffect, useCallback, useRef } from "react";
import { safeInvoke } from "@/lib/tauri";

// ── Types ────────────────────────────────────────────────────────────

interface ServiceStatus {
  name: string;
  healthy: boolean;
  status: string;
  port: number;
}

interface SetupProgressProps {
  isActive: boolean;
  onAllReady: () => void;
}

// ── Fun Facts shown during loading ──────────────────────────────────

const FUN_FACTS = [
  "Your AI runs 100% locally — nothing leaves your machine.",
  "LiteLLM routes 9 model tiers across 3 providers.",
  "Ollama handles local embeddings for semantic memory.",
  "Redis caches your frequent requests for speed.",
  "PostgreSQL stores all your conversations securely.",
  "Your workspace mounts directly into the stack.",
  "Every API call is proxied — your keys never touch the browser.",
  "The embedding model is only ~270MB — pretty small for an AI brain!",
  "Sovereign Stack uses the same architecture as production AI companies.",
  "Claude Haiku handles simple tasks. Opus tackles the hard stuff.",
  "Your agent can switch between Anthropic, OpenAI, and Google models.",
  "All your data stays in Docker volumes — portable and backed up.",
];

// ── Mini Word Scramble Game ─────────────────────────────────────────

const WORD_BANK = [
  { word: "SOVEREIGN", hint: "Self-governing, independent" },
  { word: "NEURAL", hint: "Related to the brain or AI networks" },
  { word: "DOCKER", hint: "Container platform running your stack" },
  { word: "AGENT", hint: "AI that acts on your behalf" },
  { word: "MEMORY", hint: "Where your AI stores context" },
  { word: "VECTOR", hint: "How embeddings represent meaning" },
  { word: "CLAUDE", hint: "Your primary AI model" },
  { word: "REDIS", hint: "Lightning-fast cache layer" },
  { word: "OLLAMA", hint: "Runs local AI models" },
  { word: "PROMPT", hint: "Your message to the AI" },
];

function scramble(word: string): string {
  const arr = word.split("");
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  // Make sure it's actually scrambled
  return arr.join("") === word ? scramble(word) : arr.join("");
}

function MiniGame() {
  const [wordIndex, setWordIndex] = useState(() =>
    Math.floor(Math.random() * WORD_BANK.length)
  );
  const [guess, setGuess] = useState("");
  const [scrambled, setScrambled] = useState("");
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const [showHint, setShowHint] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = WORD_BANK[wordIndex];

  useEffect(() => {
    setScrambled(scramble(current.word));
    setGuess("");
    setFeedback(null);
    setShowHint(false);
  }, [wordIndex, current.word]);

  const handleGuess = () => {
    if (guess.toUpperCase().trim() === current.word) {
      setFeedback("correct");
      setScore((s) => s + 1);
      setTimeout(() => {
        setWordIndex((i) => (i + 1) % WORD_BANK.length);
      }, 800);
    } else {
      setFeedback("wrong");
      setTimeout(() => setFeedback(null), 600);
    }
  };

  const handleSkip = () => {
    setWordIndex((i) => (i + 1) % WORD_BANK.length);
  };

  return (
    <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700/50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-300">
          Unscramble the Word
        </h3>
        <span className="text-xs text-blue-400 font-mono">
          Score: {score}
        </span>
      </div>

      {/* Scrambled word display */}
      <div className="flex items-center justify-center gap-1.5 mb-3">
        {scrambled.split("").map((letter, i) => (
          <div
            key={`${wordIndex}-${i}`}
            className="w-9 h-10 bg-slate-700 rounded-lg flex items-center justify-center text-lg font-bold text-blue-300 border border-slate-600 animate-scaleIn"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            {letter}
          </div>
        ))}
      </div>

      {/* Hint */}
      {showHint && (
        <p className="text-xs text-slate-400 text-center mb-2 animate-fadeIn">
          Hint: {current.hint}
        </p>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={guess}
          onChange={(e) => setGuess(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleGuess()}
          placeholder="Type your answer..."
          maxLength={current.word.length}
          className={`flex-1 bg-slate-900 border rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none transition-all duration-200 ${
            feedback === "correct"
              ? "border-green-500 bg-green-900/20"
              : feedback === "wrong"
              ? "border-red-500 bg-red-900/20 animate-[shake_0.3s_ease-in-out]"
              : "border-slate-700 focus:border-blue-500"
          }`}
        />
        <button
          onClick={handleGuess}
          disabled={!guess.trim()}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-600 rounded-lg text-sm font-medium text-white transition-all active:scale-95"
        >
          Check
        </button>
      </div>

      <div className="flex items-center justify-between mt-2">
        <button
          onClick={() => setShowHint(true)}
          className="text-xs text-slate-500 hover:text-slate-400 transition-colors"
        >
          Need a hint?
        </button>
        <button
          onClick={handleSkip}
          className="text-xs text-slate-500 hover:text-slate-400 transition-colors"
        >
          Skip word &rarr;
        </button>
      </div>

      {feedback === "correct" && (
        <div className="text-center mt-2 text-green-400 text-sm font-medium animate-fadeIn">
          Correct! Nice one!
        </div>
      )}
    </div>
  );
}

// ── Animated Service Card ───────────────────────────────────────────

function ServiceCard({
  name,
  healthy,
  status,
  delay,
}: {
  name: string;
  healthy: boolean;
  status: string;
  delay: number;
}) {
  const icons: Record<string, string> = {
    LiteLLM: "🧠",
    API: "🔌",
    Ollama: "🦙",
    "Web UI": "🌐",
    PostgreSQL: "🗄️",
    Redis: "⚡",
  };

  return (
    <div
      className="flex items-center gap-3 animate-slideIn"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all duration-500 ${
          healthy
            ? "bg-green-900/30 border border-green-700/50"
            : "bg-slate-800 border border-slate-700/50"
        }`}
      >
        {icons[name] || "📦"}
      </div>
      <div className="flex-1">
        <div className="text-xs font-medium text-slate-300">{name}</div>
        <div
          className={`text-[10px] transition-colors duration-500 ${
            healthy ? "text-green-400" : "text-slate-500"
          }`}
        >
          {healthy ? "Ready" : status === "starting" ? "Starting..." : "Waiting..."}
        </div>
      </div>
      <div className="relative w-4 h-4">
        {healthy ? (
          <svg
            className="w-4 h-4 text-green-400 animate-scaleIn"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M5 13l4 4L19 7"
            />
          </svg>
        ) : (
          <div className="w-3 h-3 border-2 border-slate-600 border-t-blue-400 rounded-full animate-spin" />
        )}
      </div>
    </div>
  );
}

// ── Main Progress Component ─────────────────────────────────────────

export function SetupProgress({ isActive, onAllReady }: SetupProgressProps) {
  const [services, setServices] = useState<ServiceStatus[]>([
    { name: "PostgreSQL", healthy: false, status: "waiting", port: 5432 },
    { name: "Redis", healthy: false, status: "waiting", port: 6379 },
    { name: "Ollama", healthy: false, status: "waiting", port: 11434 },
    { name: "LiteLLM", healthy: false, status: "waiting", port: 4000 },
    { name: "API", healthy: false, status: "waiting", port: 3100 },
    { name: "Web UI", healthy: false, status: "waiting", port: 3000 },
  ]);
  const [factIndex, setFactIndex] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const allReady = services.every((s) => s.healthy);
  const readyCount = services.filter((s) => s.healthy).length;
  const progress = Math.round((readyCount / services.length) * 100);

  // Health polling
  const pollHealth = useCallback(async () => {
    try {
      // Try Tauri backend first
      const health = await safeInvoke<ServiceStatus[]>("check_stack_health");
      setServices(health);
    } catch {
      // Fallback: browser-based HTTP checks
      const checks = await Promise.all(
        services.map(async (svc) => {
          if (svc.port === 5432 || svc.port === 6379) {
            // Can't TCP-check from browser, assume ready if API is ready
            return svc;
          }
          try {
            const urls: Record<number, string> = {
              4000: "/api/llm/health/liveliness",
              3100: "http://127.0.0.1:3100/health",
              11434: "http://127.0.0.1:11434/api/tags",
              3000: "http://127.0.0.1:3000",
            };
            const url = urls[svc.port];
            if (!url) return svc;
            const resp = await fetch(url, {
              signal: AbortSignal.timeout(3000),
            });
            return { ...svc, healthy: resp.ok, status: resp.ok ? "running" : "starting" };
          } catch {
            return { ...svc, healthy: false, status: "starting" };
          }
        })
      );
      setServices(checks);
    }
  }, [services]);

  // Poll every 3 seconds
  useEffect(() => {
    if (!isActive || allReady) return;

    const interval = setInterval(pollHealth, 3000);
    // Initial check
    pollHealth();

    return () => clearInterval(interval);
  }, [isActive, allReady, pollHealth]);

  // Timer
  useEffect(() => {
    if (!isActive || allReady) return;
    const timer = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isActive, allReady]);

  // Rotate fun facts
  useEffect(() => {
    if (!isActive || allReady) return;
    const interval = setInterval(() => {
      setFactIndex((i) => (i + 1) % FUN_FACTS.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [isActive, allReady]);

  // Notify parent when all ready
  useEffect(() => {
    if (allReady) {
      const timeout = setTimeout(onAllReady, 1500); // Brief celebration delay
      return () => clearTimeout(timeout);
    }
  }, [allReady, onAllReady]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Header */}
      <div className="text-center space-y-1">
        {allReady ? (
          <>
            <div className="text-4xl mb-2 animate-scaleIn">🚀</div>
            <h2 className="text-xl font-bold text-white">All Systems Go!</h2>
            <p className="text-sm text-green-400">
              Your AI infrastructure is ready.
            </p>
          </>
        ) : (
          <>
            <div className="text-4xl mb-2">
              <span className="inline-block animate-bounce">🔧</span>
            </div>
            <h2 className="text-xl font-bold text-white">
              Starting Your AI Stack
            </h2>
            <p className="text-sm text-slate-400">
              Spinning up {services.length} services...
            </p>
          </>
        )}
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">
            {readyCount}/{services.length} services ready
          </span>
          <span className="text-slate-500 font-mono">
            {formatTime(elapsedSec)}
          </span>
        </div>
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${
              allReady
                ? "bg-gradient-to-r from-green-500 to-emerald-400"
                : "bg-gradient-to-r from-blue-600 to-purple-500"
            }`}
            style={{ width: `${Math.max(progress, 5)}%` }}
          />
        </div>
      </div>

      {/* Service status grid */}
      <div className="grid grid-cols-2 gap-2.5">
        {services.map((svc, i) => (
          <ServiceCard
            key={svc.name}
            name={svc.name}
            healthy={svc.healthy}
            status={svc.status}
            delay={i * 100}
          />
        ))}
      </div>

      {/* Fun fact ticker */}
      {!allReady && (
        <div className="bg-slate-800/30 rounded-lg px-4 py-3 border border-slate-700/30">
          <div className="flex items-start gap-2">
            <span className="text-blue-400 text-sm mt-0.5">💡</span>
            <p
              key={factIndex}
              className="text-xs text-slate-400 leading-relaxed animate-fadeIn"
            >
              {FUN_FACTS[factIndex]}
            </p>
          </div>
        </div>
      )}

      {/* Mini game (only while waiting) */}
      {!allReady && (
        <div className="pt-1">
          <MiniGame />
        </div>
      )}
    </div>
  );
}
