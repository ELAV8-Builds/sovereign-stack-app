import { VoiceMicButton } from "../VoiceControls";
import type { QueuedMessage } from "./types";
import { formatElapsed } from "./types";

// ─── Create Visual Menu ──────────────────────────────────────────────────

function CreateVisualMenu({
  onSelectPrompt,
  onClose,
}: {
  onSelectPrompt: (prompt: string) => void;
  onClose: () => void;
}) {
  const items = [
    { icon: "📊", label: "Dashboard", prompt: "Create a dashboard showing " },
    { icon: "📈", label: "Chart / Metrics", prompt: "Build a visual with charts and metrics for " },
    { icon: "📋", label: "Report", prompt: "Generate a visual report about " },
    { icon: "🎨", label: "Mockup", prompt: "Design a UI mockup for " },
  ];

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-14 right-0 w-64 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-50">
        <div className="px-3 py-2 border-b border-slate-700">
          <span className="text-xs font-semibold text-slate-400">Create Visual</span>
        </div>
        {items.map((item) => (
          <button
            key={item.label}
            onClick={() => onSelectPrompt(item.prompt)}
            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.04] transition-colors text-left"
          >
            <span className="text-base">{item.icon}</span>
            <div>
              <span className="text-sm text-slate-200 block">{item.label}</span>
              <span className="text-[10px] text-slate-500">{item.prompt}...</span>
            </div>
          </button>
        ))}
        <div className="px-3 py-2 border-t border-slate-700">
          <span className="text-[10px] text-slate-500">
            Tip: Just describe what you want in chat — the agent can generate visuals inline
          </span>
        </div>
      </div>
    </>
  );
}

// ─── Queue Display ───────────────────────────────────────────────────────

function QueueDisplay({
  queue,
  onClearAll,
  onRemove,
}: {
  queue: QueuedMessage[];
  onClearAll: () => void;
  onRemove: (id: string) => void;
}) {
  if (queue.length === 0) return null;

  return (
    <div className="border-t border-slate-800 bg-slate-850/60 px-4 py-2 max-h-[120px] overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
            Queued ({queue.length})
          </span>
          <button
            onClick={onClearAll}
            className="text-[10px] text-slate-600 hover:text-red-400 transition-colors"
          >
            Clear all
          </button>
        </div>
        {queue.map((item, idx) => (
          <div
            key={item.id}
            className="flex items-center gap-2 py-1 px-2 mb-1 rounded bg-slate-800/60 border border-slate-700/50"
          >
            <span className="text-[10px] font-bold text-blue-400 min-w-[14px] text-center">
              {idx + 1}
            </span>
            <span className="text-xs text-slate-400 flex-1 truncate">{item.content}</span>
            <button
              onClick={() => onRemove(item.id)}
              className="text-[10px] text-slate-600 hover:text-red-400 transition-colors px-1"
              title="Remove"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Input Bar ──────────────────────────────────────────────────────

interface ChatInputBarProps {
  input: string;
  agentRunning: boolean;
  agentIteration: number;
  anyAgentRunning: boolean;
  loadingElapsed: number;
  queue: QueuedMessage[];
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  showCreateMenu: boolean;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSend: () => void;
  onStop: () => void;
  onInterrupt: () => void;
  onQueueMessage: () => void;
  onSetInput: (value: string | ((prev: string) => string)) => void;
  onSetShowCreateMenu: (value: boolean | ((prev: boolean) => boolean)) => void;
  onClearQueue: () => void;
  onRemoveFromQueue: (id: string) => void;
}

export function ChatInputBar({
  input,
  agentRunning,
  agentIteration,
  anyAgentRunning,
  loadingElapsed,
  queue,
  inputRef,
  showCreateMenu,
  onInputChange,
  onKeyDown,
  onSend,
  onStop,
  onInterrupt,
  onQueueMessage,
  onSetInput,
  onSetShowCreateMenu,
  onClearQueue,
  onRemoveFromQueue,
}: ChatInputBarProps) {
  return (
    <>
      <QueueDisplay queue={queue} onClearAll={onClearQueue} onRemove={onRemoveFromQueue} />

      <div className="border-t border-slate-800 bg-slate-900/80 backdrop-blur p-4">
        {agentRunning && (
          <div className="text-[10px] text-slate-600 mb-1.5 max-w-4xl mx-auto px-1">
            Type to queue a message — press Esc to stop
          </div>
        )}
        <div className="flex items-end gap-3 max-w-4xl mx-auto">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={onInputChange}
              onKeyDown={onKeyDown}
              placeholder={
                agentRunning
                  ? "Type to queue next message..."
                  : "Ask Overmind anything..."
              }
              rows={1}
              className={`w-full bg-slate-800 border rounded-xl px-4 py-3 pr-12 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 resize-none transition-all duration-200 ${
                agentRunning && input.trim() ? "border-amber-600/50" : "border-slate-700"
              }`}
              style={{ minHeight: "44px", maxHeight: "150px" }}
            />
          </div>

          {/* Create visual button */}
          {!agentRunning && (
            <div className="relative flex-shrink-0">
              <button
                onClick={() => onSetShowCreateMenu((prev) => !prev)}
                className="w-11 h-11 rounded-xl flex items-center justify-center bg-slate-800 hover:bg-indigo-600/20 border border-slate-700 hover:border-indigo-500/30 text-slate-400 hover:text-indigo-400 transition-all duration-200"
                title="Create visual content"
                aria-label="Create visual"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  className="w-4 h-4"
                >
                  <path d="M12 2L9 12l-7 3 7 3 3 10 3-10 7-3-7-3z" />
                </svg>
              </button>

              {showCreateMenu && (
                <CreateVisualMenu
                  onSelectPrompt={(prompt) => {
                    onSetInput(prompt);
                    onSetShowCreateMenu(false);
                    inputRef.current?.focus();
                  }}
                  onClose={() => onSetShowCreateMenu(false)}
                />
              )}
            </div>
          )}

          {/* Voice mic button */}
          {!agentRunning && (
            <VoiceMicButton
              onTranscription={(text) => {
                onSetInput((prev) => (prev ? prev + " " + text : text));
                inputRef.current?.focus();
              }}
              className="flex-shrink-0"
            />
          )}

          {/* Send / Stop / Queue / Interrupt buttons */}
          {agentRunning ? (
            <div className="flex gap-1.5 flex-shrink-0">
              {input.trim() && (
                <button
                  onClick={onInterrupt}
                  className="h-11 px-3 rounded-xl flex items-center justify-center bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 active:scale-95 transition-all duration-200"
                  aria-label="Interrupt and send"
                  title="Stop current and send this message"
                >
                  Interrupt
                </button>
              )}
              <button
                onClick={input.trim() ? onQueueMessage : onStop}
                className={`h-11 rounded-xl flex items-center justify-center active:scale-95 transition-all duration-200 ${
                  input.trim()
                    ? "px-3 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-700/50 text-xs font-semibold"
                    : "w-11 bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20"
                }`}
                aria-label={input.trim() ? "Queue message" : "Stop agent"}
                title={input.trim() ? "Add to queue" : "Stop agent"}
              >
                {input.trim() ? (
                  "Queue"
                ) : (
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                )}
              </button>
            </div>
          ) : (
            <button
              onClick={onSend}
              disabled={!input.trim()}
              className={`flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-200 ${
                input.trim()
                  ? "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20 active:scale-95"
                  : "bg-slate-800 text-slate-600 cursor-not-allowed"
              }`}
              aria-label="Send message"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex items-center gap-4 mt-2 max-w-4xl mx-auto px-1">
          <span className="text-[10px] text-slate-600">
            {agentRunning
              ? "Type to queue — Enter to queue, Esc to stop"
              : "Overmind — Shift+Enter for new line"}
          </span>
          {agentRunning && (
            <span className="text-[10px] text-amber-400 animate-pulse">
              Step {agentIteration} · {formatElapsed(loadingElapsed)}
            </span>
          )}
          {queue.length > 0 && (
            <span className="text-[10px] text-blue-400">{queue.length} queued</span>
          )}
          {!agentRunning && anyAgentRunning && (
            <span className="text-[10px] text-blue-400/60">Other agents working...</span>
          )}
        </div>
      </div>
    </>
  );
}
