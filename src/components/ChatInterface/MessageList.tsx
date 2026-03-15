import { forwardRef, useMemo } from "react";
import type { AgentToolCall, PlaybookChainSuggestion } from "@/lib/agent";
import { MODEL_LABELS } from "@/lib/constants";
import { ToolCallBlock } from "../ToolCallBlock";
import { SpeakButton } from "../VoiceControls";
import { renderContent } from "./MarkdownRenderer";
import type { ChatMessage } from "./types";
import { formatElapsed } from "./types";

const EXTERNAL_TOOL_LABELS: Record<string, { label: string; icon: string }> = {
  slack: { label: "Sending to Slack", icon: "💬" },
  email: { label: "Sending email", icon: "📧" },
  gmail: { label: "Sending email", icon: "📧" },
  webhook: { label: "Calling webhook", icon: "🔗" },
  github: { label: "Working with GitHub", icon: "🐙" },
  deploy: { label: "Deploying", icon: "🚀" },
  calendar: { label: "Updating calendar", icon: "📅" },
};

function getActiveExternalStatus(toolCalls: AgentToolCall[]): { label: string; icon: string } | null {
  const running = toolCalls.filter(tc => tc.status === "running");
  for (const tc of running) {
    const toolLower = tc.tool.toLowerCase();
    for (const [key, meta] of Object.entries(EXTERNAL_TOOL_LABELS)) {
      if (toolLower.includes(key)) return meta;
    }
  }
  return null;
}

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
  const externalStatus = useMemo(() => getActiveExternalStatus(agentToolCalls), [agentToolCalls]);

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
          {externalStatus ? (
            <span className="text-[10px] text-purple-400 animate-pulse">
              {externalStatus.icon} {externalStatus.label}...
            </span>
          ) : (
            <span className="text-[10px] text-slate-500">Working...</span>
          )}
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

// ─── Playbook Chain Card ─────────────────────────────────────────────────

function PlaybookChainCard({ suggestion }: { suggestion: PlaybookChainSuggestion }) {
  if (!suggestion.chain || suggestion.chain.length === 0) return null;

  return (
    <div className="flex justify-start animate-fadeIn">
      <div className="max-w-[90%] bg-slate-800/90 border border-violet-500/30 rounded-2xl rounded-bl-md px-4 py-3 shadow-lg">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-semibold text-violet-400">Playbook Chain</span>
          {suggestion.auto_approved && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-400 border border-emerald-800/50">
              auto-approved
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {suggestion.chain.map((item, idx) => (
            <div key={item.id} className="flex items-center gap-1 flex-shrink-0">
              <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 min-w-[140px]">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="flex items-center justify-center w-4 h-4 rounded bg-violet-900/40 text-violet-400 text-[9px] font-bold">
                    {idx + 1}
                  </span>
                  <span className="text-[11px] font-medium text-white truncate">{item.name}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {item.model && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-indigo-900/30 text-indigo-400 border border-indigo-800/30">
                      {MODEL_LABELS[item.model] || item.model}
                    </span>
                  )}
                  {item.iteration_config && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/30">
                      {item.iteration_config.min}-{item.iteration_config.max} iter
                    </span>
                  )}
                </div>
                {item.steps && item.steps.length > 0 && (
                  <div className="text-[9px] text-slate-500 mt-1 truncate">
                    {item.steps.join(' -> ')}
                  </div>
                )}
                <div className="text-[9px] text-slate-600 mt-1 italic truncate">{item.reason}</div>
              </div>
              {idx < suggestion.chain.length - 1 && (
                <span className="text-slate-600 text-xs flex-shrink-0">-&gt;</span>
              )}
            </div>
          ))}
        </div>

        {suggestion.reasoning && (
          <div className="text-[10px] text-slate-500 mt-1 border-t border-white/[0.04] pt-1.5">
            {suggestion.reasoning}
          </div>
        )}
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
  playbookChain?: PlaybookChainSuggestion | null;
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
    playbookChain,
  },
  containerRef
) {
  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-4 scrollbar-thin">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} msg={msg} agentName={agentName} />
      ))}

      {playbookChain && playbookChain.chain.length > 1 && (
        <PlaybookChainCard suggestion={playbookChain} />
      )}

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
