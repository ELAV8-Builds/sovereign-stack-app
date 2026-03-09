/**
 * DescribePhase — Phase 1: user describes what they want to build
 */
import { SUGGESTIONS } from "./types";
import type { DescribePhaseProps } from "./types";

export function DescribePhase({ description, setDescription }: DescribePhaseProps) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white mb-1">What do you want to build?</h2>
        <p className="text-sm text-slate-400">Describe your project in a few sentences. This helps the AI generate better code.</p>
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="E.g., A real-time chat app with user authentication, message history, and file uploads..."
        className="w-full h-32 bg-slate-900/50 border border-white/[0.06] rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/40 resize-none"
      />

      <div>
        <p className="text-xs text-slate-500 mb-2">Quick suggestions:</p>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setDescription(s)}
              className="px-3 py-1.5 bg-white/[0.04] border border-white/[0.06] rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/[0.08] transition-all"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
