import { useState, useEffect, useRef, useCallback } from "react";
import { safeInvoke, localGet, localSet } from "@/lib/tauri";
import { checkLLMHealth } from "@/lib/ai";
import { chatWithAgent, type AgentToolCall, type AgentDecision, type JobHandoff, type PlaybookChainSuggestion } from "@/lib/agent";
import { MODEL_LABELS } from "@/lib/constants";
import {
  createConversation,
  getConversation,
  addMessage,
} from "@/lib/conversations";
import { ConversationSidebar } from "../ConversationSidebar";
import { SoundSettings } from "../SoundSettings";
import { useOvermindSocket } from "@/lib/useOvermindSocket";
import { markConversationRead } from "@/lib/unread";
import { playNotificationDing } from "@/lib/notifications";
import toast from "react-hot-toast";

import type { ChatMessage, ChannelStatus, QueuedMessage } from "./types";
import {
  QUEUE_STORAGE_KEY,
  STALE_THRESHOLD_MS,
  loadPersistedQueue,
  apiToLocal,
} from "./types";
import { StatusBar } from "./StatusBar";
import { MessageList } from "./MessageList";
import { ChatInputBar, type AttachedImage } from "./ChatInputBar";

// ─── Component ──────────────────────────────────────────────────────────

export function ChatInterface() {
  const agentName = localGet("agent_name", "Sovereign Agent");

  // ── Core state ─────────────────────────────────────────────────────
  const [llmAvailable, setLlmAvailable] = useState<boolean | null>(null);
  const [messagesMap, setMessagesMap] = useState<Record<string, ChatMessage[]>>({});
  const [input, setInput] = useState("");
  const [isTypingMap, setIsTypingMap] = useState<Record<string, boolean>>({});
  const [channels, setChannels] = useState<ChannelStatus>({ whatsapp: false, slack: false });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    () => localGet<string | null>("active_conversation_id", null)
  );
  const [conversationLoading, setConversationLoading] = useState(false);
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null);

  // ── Agent state (per-conversation) — always routes through Overmind ─
  const [agentRunningMap, setAgentRunningMap] = useState<Record<string, boolean>>({});
  const [agentIterationMap, setAgentIterationMap] = useState<Record<string, number>>({});
  const [agentToolCallsMap, setAgentToolCallsMap] = useState<Record<string, AgentToolCall[]>>({});
  const [agentThinkingMap, setAgentThinkingMap] = useState<Record<string, string>>({});
  const [agentDecisionMap, setAgentDecisionMap] = useState<Record<string, AgentDecision | null>>({});
  const [playbookChainMap, setPlaybookChainMap] = useState<Record<string, PlaybookChainSuggestion | null>>({});
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const abortControllerMapRef = useRef<Record<string, AbortController>>({});
  const [showSoundSettings, setShowSoundSettings] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

  // ── Background job tracking ────────────────────────────────────────
  const [pendingJobIds, setPendingJobIds] = useState<Set<string>>(new Set());

  // ── Queue & stale detection ────────────────────────────────────────
  const [queue, setQueue] = useState<QueuedMessage[]>(loadPersistedQueue);
  const [loadingElapsed, setLoadingElapsed] = useState(0);
  const [showStaleWarning, setShowStaleWarning] = useState(false);
  const loadingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadingStartRef = useRef<number>(0);

  // ── Refs ───────────────────────────────────────────────────────────
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Derived state ──────────────────────────────────────────────────
  const convKey = activeConversationId ?? "__none__";
  const agentRunning = agentRunningMap[convKey] ?? false;
  const agentIteration = agentIterationMap[convKey] ?? 0;
  const agentToolCalls = agentToolCallsMap[convKey] ?? [];
  const agentThinking = agentThinkingMap[convKey] ?? "";
  const agentDecision = agentDecisionMap[convKey] ?? null;
  const anyAgentRunning = Object.values(agentRunningMap).some(Boolean);
  const messages = messagesMap[convKey] ?? [];
  const isTyping = isTypingMap[convKey] ?? false;

  const welcomeMessage: ChatMessage = {
    id: "welcome",
    role: "agent",
    content: `Hey! I'm ${agentName}, powered by the Overmind. I can execute commands, manage your fleet, access tools, and more. What are we working on?`,
    timestamp: new Date(),
    status: "sent",
  };

  const displayMessages = messages.length > 0 ? messages : [welcomeMessage];

  // ── Health check ───────────────────────────────────────────────────

  const recheckHealth = useCallback(async () => {
    const healthy = await checkLLMHealth();
    setLlmAvailable(healthy);
    return healthy;
  }, []);

  useEffect(() => {
    recheckHealth();
    const interval = setInterval(recheckHealth, llmAvailable === false ? 15_000 : 60_000);
    return () => clearInterval(interval);
  }, [llmAvailable, recheckHealth]);

  // ── Persistence effects ────────────────────────────────────────────

  useEffect(() => {
    try { localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue)); } catch { /* full */ }
  }, [queue]);

  useEffect(() => {
    if (activeConversationId) localSet("active_conversation_id", activeConversationId);
  }, [activeConversationId]);

  // ── Loading elapsed timer & stale detection ────────────────────────

  useEffect(() => {
    if (agentRunning || isTyping) {
      loadingStartRef.current = Date.now();
      setLoadingElapsed(0);
      setShowStaleWarning(false);
      loadingTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - loadingStartRef.current;
        setLoadingElapsed(elapsed);
        if (elapsed >= STALE_THRESHOLD_MS) setShowStaleWarning(true);
      }, 1000);
    } else {
      if (loadingTimerRef.current) { clearInterval(loadingTimerRef.current); loadingTimerRef.current = null; }
      setLoadingElapsed(0);
      setShowStaleWarning(false);
    }
    return () => { if (loadingTimerRef.current) clearInterval(loadingTimerRef.current); };
  }, [agentRunning, isTyping]);

  const resetStaleTimer = useCallback(() => {
    loadingStartRef.current = Date.now();
    setLoadingElapsed(0);
    setShowStaleWarning(false);
  }, []);

  // ── WebSocket: listen for background job completion ─────────────────

  const { lastEvent } = useOvermindSocket(true);

  useEffect(() => {
    if (!lastEvent) return;
    const { type, data } = lastEvent;

    if (
      (type === 'job_completed' || type === 'job_failed' || type === 'job_needs_review') &&
      data?.job_id &&
      pendingJobIds.has(data.job_id as string)
    ) {
      const jobId = data.job_id as string;
      const title = (data.title as string) || 'Background job';

      setPendingJobIds(prev => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });

      let statusMsg: string;
      if (type === 'job_completed') {
        statusMsg = `Background job **"${title}"** completed successfully. Check the Jobs tab for details.`;
        playNotificationDing();
      } else if (type === 'job_failed') {
        statusMsg = `Background job **"${title}"** failed. Check the Jobs tab for details.`;
      } else {
        statusMsg = `Background job **"${title}"** needs review. Check the Jobs tab for details.`;
      }

      const resultMsg: ChatMessage = {
        id: `job-result-${Date.now()}`,
        role: "agent",
        content: statusMsg,
        timestamp: new Date(),
        status: "sent",
      };

      setMessagesMap(prev => ({
        ...prev,
        [convKey]: [...(prev[convKey] ?? []), resultMsg],
      }));

      toast(
        type === 'job_completed' ? `Job "${title}" completed` : `Job "${title}" ${type.replace('job_', '')}`,
        { icon: type === 'job_completed' ? '✅' : '⚠️', duration: 5000 }
      );
    }
  }, [lastEvent, pendingJobIds, convKey]);

  // ── Scroll management ──────────────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    if (!userScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      userScrolledUpRef.current = (scrollHeight - scrollTop - clientHeight) > 100;
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, isTyping, agentToolCalls, scrollToBottom]);

  // ── Cross-tab prefill (from "Create via Chat" buttons in Overmind) ──

  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent).detail;
      if (text && typeof text === 'string') {
        setInput(text);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    };
    window.addEventListener('prefill-chat', handler);
    return () => window.removeEventListener('prefill-chat', handler);
  }, []);

  // ── Channel status polling ─────────────────────────────────────────

  useEffect(() => {
    const checkChannels = async () => {
      try {
        const status = await safeInvoke<ChannelStatus>("get_channel_status");
        setChannels(status);
      } catch { /* not available */ }
    };
    checkChannels();
    const interval = setInterval(checkChannels, 30000);
    return () => clearInterval(interval);
  }, []);

  // ── Conversation management ────────────────────────────────────────

  const loadConversation = useCallback(async (id: string) => {
    setConversationLoading(true);
    try {
      const conv = await getConversation(id);
      setActiveConversationId(id);
      setMessagesMap((prev) => ({ ...prev, [id]: conv.messages.map(apiToLocal) }));
      setApiAvailable(true);
      markConversationRead(id);
    } catch {
      setApiAvailable(false);
      toast.error("Could not load conversation — API may be offline");
    } finally {
      setConversationLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeConversationId && messages.length === 0) loadConversation(activeConversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNewConversation = useCallback(async (agentId?: string | null) => {
    try {
      const conv = await createConversation(undefined, agentId || undefined);
      setActiveConversationId(conv.id);
      setMessagesMap((prev) => ({ ...prev, [conv.id]: [] }));
      setApiAvailable(true);
      userScrolledUpRef.current = false;
      markConversationRead(conv.id);
      return conv;
    } catch {
      setActiveConversationId(null);
      setApiAvailable(false);
      return null;
    }
  }, []);

  // ── Input handling ─────────────────────────────────────────────────

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const textarea = e.target;
    // Only resize if content might have changed height (newline added/removed
    // or overflow state changed). Collapsing to "auto" first is necessary to
    // get the true scrollHeight, but we hide the reflow inside a rAF so the
    // browser never paints the collapsed frame.
    requestAnimationFrame(() => {
      const prev = textarea.style.height;
      textarea.style.height = "auto";
      const next = Math.min(textarea.scrollHeight, 150) + "px";
      textarea.style.height = next;
      // Skip the transition when the height didn't actually change
      if (prev === next) return;
    });
  };

  // ── Agent stop / interrupt / queue ─────────────────────────────────

  const handleStopAgent = () => {
    const key = convKey;
    if (abortControllerMapRef.current[key]) {
      abortControllerMapRef.current[key].abort();
      delete abortControllerMapRef.current[key];
    }
    setAgentRunningMap((prev) => ({ ...prev, [key]: false }));
    setIsTypingMap((prev) => ({ ...prev, [key]: false }));
  };

  const handleInterrupt = () => {
    const trimmed = input.trim();
    handleStopAgent();
    if (trimmed) {
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
      setQueue((prev) => [{ id: `q-${Date.now()}`, content: trimmed, timestamp: Date.now() }, ...prev]);
    }
  };

  const handleQueueMessage = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setQueue((prev) => [...prev, { id: `q-${Date.now()}`, content: trimmed, timestamp: Date.now() }]);
    toast(`Queued: "${trimmed.slice(0, 40)}${trimmed.length > 40 ? "..." : ""}"`, { icon: "📋", duration: 2000 });
  };

  // ── Send Agent Mode ────────────────────────────────────────────────

  const handleSendAgent = async (trimmed: string, convId: string | null, imageUrls?: string[]) => {
    const sendKey = convId ?? "__none__";
    setAgentRunningMap((prev) => ({ ...prev, [sendKey]: true }));
    setAgentIterationMap((prev) => ({ ...prev, [sendKey]: 0 }));
    setAgentToolCallsMap((prev) => ({ ...prev, [sendKey]: [] }));
    setAgentThinkingMap((prev) => ({ ...prev, [sendKey]: "" }));
    setAgentDecisionMap((prev) => ({ ...prev, [sendKey]: null }));

    const abortController = new AbortController();
    abortControllerMapRef.current[sendKey] = abortController;

    const history = messages.filter((m) => m.id !== "welcome").slice(-20)
      .map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.content }));

    const collectedToolCalls: AgentToolCall[] = [];
    let thinkingText = "";

    try {
      await chatWithAgent(trimmed, convId, history, {
        onDecision: (decision) => { setAgentDecisionMap((prev) => ({ ...prev, [sendKey]: decision })); },
        onStatus: (iteration) => { resetStaleTimer(); setAgentIterationMap((prev) => ({ ...prev, [sendKey]: iteration })); },
        onThinking: (text) => { resetStaleTimer(); thinkingText += text; setAgentThinkingMap((prev) => ({ ...prev, [sendKey]: thinkingText })); },
        onToolCall: (id, tool, input) => {
          resetStaleTimer();
          collectedToolCalls.push({ id, tool, input, status: "running" });
          setAgentToolCallsMap((prev) => ({ ...prev, [sendKey]: [...collectedToolCalls] }));
        },
        onToolResult: (id, _tool, output, durationMs) => {
          resetStaleTimer();
          const call = collectedToolCalls.find((c) => c.id === id);
          if (call) {
            call.output = output;
            call.status = (output as Record<string, unknown>).error ? "error" : "completed";
            call.duration_ms = durationMs;
            setAgentToolCallsMap((prev) => ({ ...prev, [sendKey]: [...collectedToolCalls] }));
          }
        },
        onMessage: (text) => {
          resetStaleTimer();
          const agentMsg: ChatMessage = {
            id: `agent-${Date.now()}`, role: "agent", content: text, timestamp: new Date(), status: "sent",
            toolCalls: collectedToolCalls.length > 0 ? [...collectedToolCalls] : undefined,
            thinking: thinkingText || undefined,
          };
          setIsTypingMap((prev) => ({ ...prev, [sendKey]: false }));
          setAgentRunningMap((prev) => ({ ...prev, [sendKey]: false }));
          setAgentToolCallsMap((prev) => ({ ...prev, [sendKey]: [] }));
          setAgentThinkingMap((prev) => ({ ...prev, [sendKey]: "" }));
          setMessagesMap((prev) => ({ ...prev, [sendKey]: [...(prev[sendKey] ?? []), agentMsg] }));
          delete abortControllerMapRef.current[sendKey];
          if (convId && apiAvailable !== false) addMessage(convId, "agent", text).catch(() => {});
          playNotificationDing();
        },
        onJobHandoff: (handoff) => {
          resetStaleTimer();
          setPendingJobIds(prev => new Set(prev).add(handoff.job_id));
        },
        onPlaybookChain: (suggestion) => {
          resetStaleTimer();
          setPlaybookChainMap(prev => ({ ...prev, [sendKey]: suggestion }));
        },
        onHeartbeat: () => { resetStaleTimer(); },
        onError: (error) => { toast.error(`Agent error: ${error}`, { duration: 5000 }); },
        onDone: () => {
          setAgentRunningMap((prev) => ({ ...prev, [sendKey]: false }));
          setIsTypingMap((prev) => ({ ...prev, [sendKey]: false }));
          delete abortControllerMapRef.current[sendKey];
        },
      }, abortController.signal, undefined, imageUrls);

      if (llmAvailable === false || llmAvailable === null) setLlmAvailable(true);
    } catch (err) {
      if ((err as Error).name === "AbortError") toast("Agent stopped", { icon: "🛑" });
      else toast.error(`Agent error: ${(err as Error).message || "Unknown error"}`, { duration: 5000 });
    } finally {
      setAgentRunningMap((prev) => ({ ...prev, [sendKey]: false }));
      setIsTypingMap((prev) => ({ ...prev, [sendKey]: false }));
      delete abortControllerMapRef.current[sendKey];
    }
  };

  // ── Unified send entry point ───────────────────────────────────────

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (agentRunning) { handleQueueMessage(); return; }

    let convId = activeConversationId;
    if (!convId && apiAvailable !== false) {
      try { const conv = await createConversation(); convId = conv.id; setActiveConversationId(conv.id); setApiAvailable(true); }
      catch { setApiAvailable(false); }
    }

    const userMsg: ChatMessage = { id: `user-${Date.now()}`, role: "user", content: trimmed, timestamp: new Date(), status: "sent" };
    const sendKey = convId ?? "__none__";
    setMessagesMap((prev) => ({ ...prev, [sendKey]: [...(prev[sendKey] ?? []), userMsg] }));
    setInput("");
    setIsTypingMap((prev) => ({ ...prev, [sendKey]: true }));
    if (inputRef.current) inputRef.current.style.height = "auto";
    if (convId && apiAvailable !== false) addMessage(convId, "user", trimmed).catch(() => {});
    if (convId) markConversationRead(convId);

    const imageUrls = attachedImages
      .filter(img => img.uploadedUrl)
      .map(img => img.uploadedUrl!);

    attachedImages.forEach(img => {
      if (img.preview) URL.revokeObjectURL(img.preview);
    });
    setAttachedImages([]);

    try {
      await handleSendAgent(trimmed, convId, imageUrls.length > 0 ? imageUrls : undefined);
    } catch (err) {
      setIsTypingMap((prev) => ({ ...prev, [sendKey]: false }));
      setAgentRunningMap((prev) => ({ ...prev, [sendKey]: false }));

      // Fallback to Tauri backend
      try {
        const tauriResponse = await safeInvoke<string>("chat_with_agent", { message: trimmed });
        const agentMsg: ChatMessage = { id: `agent-${Date.now()}`, role: "agent", content: tauriResponse, timestamp: new Date(), status: "sent" };
        setMessagesMap((prev) => ({ ...prev, [sendKey]: [...(prev[sendKey] ?? []), agentMsg] }));
        if (convId && apiAvailable !== false) addMessage(convId, "agent", tauriResponse).catch(() => {});
        return;
      } catch { /* both failed */ }

      const stillDown = !(await recheckHealth());
      if (stillDown) {
        const errorMsg: ChatMessage = {
          id: `error-${Date.now()}`, role: "agent", status: "error", timestamp: new Date(),
          content: `I can't respond right now — the AI backend isn't reachable.\n\nTo fix this:\n1. Make sure Docker Desktop is running\n2. Check that the Sovereign Stack is started: \`docker compose up -d\`\n3. Verify LiteLLM is healthy at http://127.0.0.1:4000/health/liveliness\n\nI'll automatically retry when the backend comes back online. You can also click "Retry Connection" below.`,
        };
        setMessagesMap((prev) => ({ ...prev, [sendKey]: [...(prev[sendKey] ?? []), errorMsg] }));
        toast.error("AI not connected — will auto-retry in 15 seconds", { duration: 5000 });
      } else {
        toast("Backend reconnected — retrying your message...", { icon: "🔄" });
        try {
          await handleSendAgent(trimmed, convId);
        } catch {
          const errorMsg: ChatMessage = {
            id: `error-${Date.now()}`, role: "agent", status: "error", timestamp: new Date(),
            content: `Something went wrong with that request. The backend is online but the request failed. Please try again.`,
          };
          setMessagesMap((prev) => ({ ...prev, [sendKey]: [...(prev[sendKey] ?? []), errorMsg] }));
          toast.error("Request failed — please try again");
        }
      }
    }
  };

  // ── Queue processor ────────────────────────────────────────────────

  useEffect(() => {
    if (!agentRunning && !isTyping && queue.length > 0) {
      const [next, ...rest] = queue;
      setQueue(rest);
      setInput(next.content);
      setTimeout(() => {
        setInput("");
        void (async () => {
          const trimmed = next.content;
          let convId = activeConversationId;
          if (!convId && apiAvailable !== false) {
            try { const conv = await createConversation(); convId = conv.id; setActiveConversationId(conv.id); setApiAvailable(true); }
            catch { setApiAvailable(false); }
          }
          const userMsg: ChatMessage = { id: `user-${Date.now()}`, role: "user", content: trimmed, timestamp: new Date(), status: "sent" };
          const sendKey = convId ?? "__none__";
          setMessagesMap((prev) => ({ ...prev, [sendKey]: [...(prev[sendKey] ?? []), userMsg] }));
          setIsTypingMap((prev) => ({ ...prev, [sendKey]: true }));
          if (convId && apiAvailable !== false) addMessage(convId, "user", trimmed).catch(() => {});
          if (convId) markConversationRead(convId);
          try {
            await handleSendAgent(trimmed, convId);
          } catch {
            setIsTypingMap((prev) => ({ ...prev, [sendKey]: false }));
            setAgentRunningMap((prev) => ({ ...prev, [sendKey]: false }));
          }
        })();
      }, 200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentRunning, isTyping, queue.length]);

  // ── Key handler ────────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === "Escape" && agentRunning) { e.preventDefault(); handleStopAgent(); }
  };

  // ── Stale retry handler ────────────────────────────────────────────

  const handleStaleRetry = () => {
    handleStopAgent();
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg) {
      setTimeout(() => { setInput(lastUserMsg.content); handleSend(); }, 300);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="flex h-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      <ConversationSidebar
        activeConversationId={activeConversationId}
        onSelectConversation={(id) => {
          loadConversation(id);
          userScrolledUpRef.current = false;
          markConversationRead(id);
        }}
        onNewConversation={async () => {
          await handleNewConversation();
        }}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Background job indicator */}
        {pendingJobIds.size > 0 && (
          <div className="flex items-center gap-2 px-4 py-1.5 border-b border-amber-800/30 bg-amber-900/10">
            <span className="animate-spin w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full" />
            <span className="text-xs text-amber-300">
              {pendingJobIds.size} background job{pendingJobIds.size > 1 ? 's' : ''} running
            </span>
            <span className="text-[10px] text-slate-500">Track in Jobs tab</span>
          </div>
        )}

        <StatusBar
          channels={channels}
          agentRunning={agentRunning}
          llmAvailable={llmAvailable}
          messageCount={messages.length}
          onShowSoundSettings={() => setShowSoundSettings(true)}
          onRetryConnection={async () => {
            toast("Checking AI backend...", { icon: "🔄" });
            const ok = await recheckHealth();
            if (ok) toast.success("AI backend reconnected!");
            else toast.error("Still disconnected — check Docker stack");
          }}
        />

        {conversationLoading && (
          <div className="flex items-center justify-center py-4 bg-slate-900/50 border-b border-slate-800">
            <span className="animate-spin w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full mr-2" />
            <span className="text-xs text-slate-500">Loading conversation...</span>
          </div>
        )}

        {/* Decision banner — shows Overmind's routing decision */}
        {agentDecision && agentRunning && (
          <DecisionBanner decision={agentDecision} />
        )}

        <MessageList
          ref={messagesContainerRef}
          scrollAnchorRef={messagesEndRef}
          messages={displayMessages}
          agentName={agentName}
          agentRunning={agentRunning}
          agentIteration={agentIteration}
          agentThinking={agentThinking}
          agentToolCalls={agentToolCalls}
          isTyping={isTyping}
          loadingElapsed={loadingElapsed}
          showStaleWarning={showStaleWarning}
          onStaleRetry={handleStaleRetry}
          onStop={handleStopAgent}
          playbookChain={playbookChainMap[activeConversationId ?? '__none__'] || null}
        />

        <ChatInputBar
          input={input}
          agentRunning={agentRunning}
          agentIteration={agentIteration}
          anyAgentRunning={anyAgentRunning}
          loadingElapsed={loadingElapsed}
          queue={queue}
          inputRef={inputRef}
          showCreateMenu={showCreateMenu}
          attachedImages={attachedImages}
          onInputChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onSend={handleSend}
          onStop={handleStopAgent}
          onInterrupt={handleInterrupt}
          onQueueMessage={handleQueueMessage}
          onSetInput={setInput}
          onSetShowCreateMenu={setShowCreateMenu}
          onClearQueue={() => setQueue([])}
          onRemoveFromQueue={(id) => setQueue((prev) => prev.filter((q) => q.id !== id))}
          onAttachImages={(imgs) => setAttachedImages(prev => {
            const merged = [...prev];
            for (const img of imgs) {
              const existing = merged.findIndex(m => m.file.name === img.file.name && m.file.size === img.file.size);
              if (existing >= 0) {
                merged[existing] = img;
              } else {
                merged.push(img);
              }
            }
            return merged;
          })}
          onRemoveImage={(idx) => setAttachedImages(prev => {
            const next = [...prev];
            const removed = next.splice(idx, 1)[0];
            if (removed?.preview) URL.revokeObjectURL(removed.preview);
            return next;
          })}
        />
      </div>

      {/* Sound Settings Modal */}
      {showSoundSettings && <SoundSettings onClose={() => setShowSoundSettings(false)} />}
    </div>
  );
}

// ─── Decision Banner (with Playbook support) ─────────────────────────

function DecisionBanner({ decision }: { decision: AgentDecision }) {
  const [expanded, setExpanded] = useState(false);
  const pb = decision.matched_playbook;

  const riskColors: Record<string, string> = {
    low: 'text-emerald-400',
    medium: 'text-amber-400',
    high: 'text-red-400',
  };

  return (
    <div className={`px-4 py-1.5 border-b ${pb ? 'border-violet-800/30 bg-violet-900/10' : 'border-indigo-800/30 bg-indigo-900/10'}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-indigo-400">{pb ? '📋' : '🧠'}</span>
          {pb ? (
            <>
              <span className="text-violet-300 font-medium">{pb.name}</span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-400">{MODEL_LABELS[pb.model] || pb.model}</span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-400">{pb.iteration_config.min}-{pb.iteration_config.max} iter</span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-400">fleet: {pb.fleet_preference}</span>
            </>
          ) : (
            <>
              <span className="text-indigo-300 font-medium">{decision.agent}</span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-400">{MODEL_LABELS[decision.model] || decision.model}</span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-400">{decision.rules_count} rules</span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-400">{decision.iteration_config.min}-{decision.iteration_config.max} iter</span>
              {!pb && decision.change_track === 'B' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/20 text-amber-400 border border-amber-800/20 ml-1">ad-hoc</span>}
            </>
          )}
          {decision.change_risk && (
            <>
              <span className="text-slate-500">·</span>
              <span className={`${riskColors[decision.change_risk] || 'text-slate-400'}`}>
                {decision.change_track === 'A' ? 'config' : 'code'} · {decision.change_risk} risk
              </span>
            </>
          )}
        </div>
        <span className="text-[10px] text-slate-600">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="mt-2 pb-1 space-y-1.5">
          {pb && pb.skills.length > 0 && (
            <div>
              <span className="text-[10px] text-slate-600 uppercase tracking-wider">Playbook Skills:</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {pb.skills.map((skill) => (
                  <span key={skill} className="text-[10px] px-1.5 py-0.5 rounded bg-violet-900/30 text-violet-400 border border-violet-800/30">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}
          {decision.rules_applied.length > 0 && (
            <div>
              <span className="text-[10px] text-slate-600 uppercase tracking-wider">Rules:</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {decision.rules_applied.map((rule) => (
                  <span key={rule} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/30 text-indigo-400 border border-indigo-800/30">
                    {rule}
                  </span>
                ))}
              </div>
            </div>
          )}
          {decision.skills_loaded.length > 0 && (
            <div>
              <span className="text-[10px] text-slate-600 uppercase tracking-wider">Skills:</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {decision.skills_loaded.map((skill) => (
                  <span key={skill} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-400 border border-emerald-800/30">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
