import { forwardRef } from "react";
import type { AgentToolCall } from "@/lib/agent";
import { ToolCallBlock } from "../ToolCallBlock";
import { SpeakButton } from "../VoiceControls";
import { renderContent } from "./MarkdownRenderer";
import type { ChatMessage } from "./types";
import { formatElapsed } from "./types";

// ─── Message Bubble ──────────────────────────────────────────────────────

function MessageBubble({ msg, agentName }: { msg: ChatMessage; agentName: string }) {
  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      key={msg.id}
      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-fadeIn`}
    >
      <div
        className={`max-w-[80%] group ${
          msg.role === "user"
            ? "bg-blue-600/90 rounded-2xl rounded-br-md"
            : "bg-slate-800/90 border border-slate-700 rounded-2xl rounded-bl-md"
        } px-4 py-3 shadow-lg`}
      >
        {msg.role === "agent" && (
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm">{msg.toolCalls ? "⚡" : "🤖"}</span>
            <span className="text-xs font-semibold text-slate-400">{agentName}</span>
            {msg.toolCalls && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-400 border border-emerald-800/50">
                {msg.toolCalls.length} tool{msg.toolCalls.length !== 1 ? "s" : ""} used
              </span>
            )}
          </div>
        )}

        {msg.thinking && (
          <div className="text-sm text-slate-400 italic mb-2">{renderContent(msg.thinking)}</div>
        )}

        {msg.toolCalls && (
          <div className="max-h-[280px] overflow-y-auto scrollbar-thin">
            {msg.toolCalls.map((tc) => (
              <ToolCallBlock
                key={tc.id}
                id={tc.id}
                tool={tc.tool}
                input={tc.input}
                output={tc.output}
                status={tc.status}
                durationMs={tc.duration_ms}
              />
            ))}
          </div>
        )}

        <div className="text-sm leading-relaxed text-slate-100 prose prose-invert prose-sm max-w-none">
          {renderContent(msg.content)}
        </div>
        <div
          className={`flex items-center gap-2 text-[10px] mt-2 ${
            msg.role === "user" ? "text-blue-200" : "text-slate-500"
          }`}
        >
          {formatTime(msg.timestamp)}
          {msg.role === "agent" && msg.content.length > 10 && <SpeakButton text={msg.content} />}
        </div>
      </div>
    </div>
  );
}

// ─── Agent Running Indicator ─────────────────────────────────────────────

interface AgentRunningProps {
  agentName: string;
  agentIteration: number;
  agentThinking: string;
  agentToolCalls: AgentToolCall[];
  loadingElapsed: number;
  showStaleWarning: boolean;
  onRetry: () => void;
  onStop: () => void;
}

function AgentRunningIndicator({
  agentName,
  agentIteration,
  agentThinking,
  agentToolCalls,
  loadingElapsed,
  showStaleWarning,
  onRetry,
  onStop,
}: AgentRunningProps) {
  return (
    <div className="flex justify-start animate-fadeIn">
      <div className="max-w-[80%] bg-slate-800/90 border border-slate-700 rounded-2xl rounded-bl-md px-4 py-3 shadow-lg">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">⚡</span>
          <span className="text-xs font-semibold text-slate-400">{agentName}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-800/50 animate-pulse">
            Step {agentIteration}
          </span>
        </div>

        {agentThinking && (
          <div className="text-sm text-slate-400 italic mb-2">{renderContent(agentThinking)}</div>
        )}

        <div className="max-h-[280px] overflow-y-auto scrollbar-thin flex flex-col-reverse">
          <div className="flex flex-col gap-1">
            {agentToolCalls.slice(-5).map((tc) => (
              <ToolCallBlock
                key={tc.id}
                id={tc.id}
                tool={tc.tool}
                input={tc.input}
                output={tc.output}
                status={tc.status}
                durationMs={tc.duration_ms}
              />
            ))}
          </div>
        </div>
        {agentToolCalls.length > 5 && (
          <div className="text-[10px] text-slate-600 text-center mt-1">
            {agentToolCalls.length - 5} more above — scroll to view
          </div>
        )}

        <div className="flex items-center gap-2 mt-2">
          <span className="animate-spin w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full" />
          <span className="text-[10px] text-slate-500">Working...</span>
          <span className="text-[10px] text-slate-600 tabular-nums ml-auto">
            {formatElapsed(loadingElapsed)}
          </span>
        </div>

        {showStaleWarning && (
          <div className="flex items-center gap-2 mt-2 px-2.5 py-1.5 rounded-lg bg-amber-900/20 border border-amber-800/40 animate-fadeIn">
            <span className="flex items-center justify-center w-4 h-4 min-w-[16px] rounded-full bg-amber-500 text-[10px] font-bold text-black">
              !
            </span>
            <span className="text-[11px] text-amber-400">
              No progress for {formatElapsed(loadingElapsed)}
            </span>
            <div className="flex gap-1.5 ml-auto">
              <button
                onClick={onRetry}
                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                Retry
              </button>
              <button
                onClick={onStop}
                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-900/40 hover:bg-red-900/60 text-red-400 border border-red-800/50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Typing Indicator ────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex justify-start animate-fadeIn">
      <div className="bg-slate-800/90 border border-slate-700 rounded-2xl rounded-bl-md px-4 py-3 shadow-lg">
        <div className="flex items-center gap-2">
          <span className="text-sm">🤖</span>
          <div className="flex gap-1">
            <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main MessageList ────────────────────────────────────────────────────

interface MessageListProps {
  messages: ChatMessage[];
  agentName: string;
  agentRunning: boolean;
  agentIteration: number;
  agentThinking: string;
  agentToolCalls: AgentToolCall[];
  isTyping: boolean;
  loadingElapsed: number;
  showStaleWarning: boolean;
  onStaleRetry: () => void;
  onStop: () => void;
}

export const MessageList = forwardRef<
  HTMLDivElement,
  MessageListProps & { scrollAnchorRef: React.RefObject<HTMLDivElement | null> }
>(function MessageList(
  {
    messages,
    agentName,
    agentRunning,
    agentIteration,
    agentThinking,
    agentToolCalls,
    isTyping,
    loadingElapsed,
    showStaleWarning,
    onStaleRetry,
    onStop,
    scrollAnchorRef,
  },
  containerRef
) {
  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-4 scrollbar-thin">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} msg={msg} agentName={agentName} />
      ))}

      {agentRunning && (
        <AgentRunningIndicator
          agentName={agentName}
          agentIteration={agentIteration}
          agentThinking={agentThinking}
          agentToolCalls={agentToolCalls}
          loadingElapsed={loadingElapsed}
          showStaleWarning={showStaleWarning}
          onRetry={onStaleRetry}
          onStop={onStop}
        />
      )}

      {isTyping && !agentRunning && <TypingIndicator />}

      <div ref={scrollAnchorRef} />
    </div>
  );
});
