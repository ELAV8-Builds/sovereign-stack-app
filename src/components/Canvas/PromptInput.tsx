/**
 * Canvas — Prompt textarea with generate/stop controls
 */
import { SparkleIcon } from "./Icons";
import type { PromptInputProps } from "./types";

export function PromptInput({
  prompt,
  isGenerating,
  activeSpec,
  inputRef,
  onPromptChange,
  onGenerate,
  onStop,
  onKeyDown,
}: PromptInputProps) {
  return (
    <div className="border-t border-white/[0.06] p-4">
      <div className="max-w-3xl mx-auto flex gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={activeSpec
              ? "Describe changes... (e.g. 'add a chart showing monthly trends')"
              : "Describe what to build... (e.g. 'create a sales dashboard')"
            }
            rows={1}
            className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20 resize-none"
            disabled={isGenerating}
          />
        </div>
        {isGenerating ? (
          <button
            onClick={onStop}
            className="px-4 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors flex-shrink-0"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={onGenerate}
            disabled={!prompt.trim()}
            className="px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-sm font-medium transition-colors flex-shrink-0 flex items-center gap-2"
          >
            <SparkleIcon /> Generate
          </button>
        )}
      </div>
    </div>
  );
}
