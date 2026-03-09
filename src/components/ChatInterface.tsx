import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { safeInvoke, localGet, localSet } from "@/lib/tauri";
import { chatWithAI, checkLLMHealth } from "@/lib/ai";
import { chatWithAgent, type AgentToolCall } from "@/lib/agent";
import {
  createConversation,
  getConversation,
  addMessage,
  type Message,
} from "@/lib/conversations";
import { ConversationSidebar } from "./ConversationSidebar";
import { ToolCallBlock } from "./ToolCallBlock";
import { FleetPanel } from "./FleetPanel";
import { VoiceMicButton, SpeakButton } from "./VoiceControls";
import { RichMessageBlock, parseRichContent } from "./RichMessageBlock";
import { InlineImage } from "./InlineImage";
import { JsonBlock } from "./JsonBlock";
import { SoundSettings } from "./SoundSettings";
import { markConversationRead } from "@/lib/unread";
import { playNotificationDing } from "@/lib/notifications";
import type { FleetAgent } from "@/lib/fleet";
import toast from "react-hot-toast";

// ─── Queue Types ──────────────────────────────────────────────────────────

interface QueuedMessage {
  id: string;
  content: string;
  timestamp: number;
}

const QUEUE_STORAGE_KEY = "sovereign_chat_queue";
const STALE_THRESHOLD_MS = 45_000;

function loadPersistedQueue(): QueuedMessage[] {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* corrupted */ }
  return [];
}

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ─── Types ───────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: Date;
  status?: "sending" | "sent" | "error";
  // Agent mode: tool calls executed during this message
  toolCalls?: AgentToolCall[];
  // Agent mode: thinking text before tool calls
  thinking?: string;
}

interface ChannelStatus {
  whatsapp: boolean;
  slack: boolean;
}

// ─── Convert API message to local format ────────────────────────────────

function apiToLocal(msg: Message): ChatMessage {
  return {
    id: msg.id,
    role: msg.role === "user" ? "user" : "agent",
    content: msg.content,
    timestamp: new Date(msg.created_at),
    status: msg.status as ChatMessage["status"],
  };
}

// ─── Component ──────────────────────────────────────────────────────────

export function ChatInterface() {
  const agentName = localGet("agent_name", "Sovereign Agent");
  const [llmAvailable, setLlmAvailable] = useState<boolean | null>(null);
  const [messagesMap, setMessagesMap] = useState<Record<string, ChatMessage[]>>({});
  const [input, setInput] = useState("");
  const [isTypingMap, setIsTypingMap] = useState<Record<string, boolean>>({});
  const [channels, setChannels] = useState<ChannelStatus>({
    whatsapp: false,
    slack: false,
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    () => localGet<string | null>("active_conversation_id", null)
  );
  const [conversationLoading, setConversationLoading] = useState(false);
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null);

  // Agent mode state — per-conversation so fleet agents run concurrently
  const [agentMode, setAgentMode] = useState(true);
  const [agentRunningMap, setAgentRunningMap] = useState<Record<string, boolean>>({});
  const [agentIterationMap, setAgentIterationMap] = useState<Record<string, number>>({});
  const [agentToolCallsMap, setAgentToolCallsMap] = useState<Record<string, AgentToolCall[]>>({});
  const [agentThinkingMap, setAgentThinkingMap] = useState<Record<string, string>>({});
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const abortControllerMapRef = useRef<Record<string, AbortController>>({});
  const [showLaunchAgent, setShowLaunchAgent] = useState(false);
  const [showSoundSettings, setShowSoundSettings] = useState(false);

  // ── Queue & Stale Detection state ──────────────────────────────────────
  const [queue, setQueue] = useState<QueuedMessage[]>(loadPersistedQueue);
  const [loadingElapsed, setLoadingElapsed] = useState(0);
  const [showStaleWarning, setShowStaleWarning] = useState(false);
  const loadingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadingStartRef = useRef<number>(0);

  // Fleet Mode state — persist selection to localStorage
  const [activeFleetAgent, setActiveFleetAgent] = useState<FleetAgent | null>(() => {
    try {
      const stored = localStorage.getItem("sovereign_active_fleet_agent");
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Derive current-conversation agent state from the maps
  const convKey = activeFleetAgent?.conversation_id ?? activeConversationId ?? "__none__";
  const agentRunning = agentRunningMap[convKey] ?? false;
  const agentIteration = agentIterationMap[convKey] ?? 0;
  const agentToolCalls = agentToolCallsMap[convKey] ?? [];
  const agentThinking = agentThinkingMap[convKey] ?? "";
  const anyAgentRunning = Object.values(agentRunningMap).some(Boolean);
  const messages = messagesMap[convKey] ?? [];
  const isTyping = isTypingMap[convKey] ?? false;

  // ── Welcome message ───────────────────────────────────────────────────

  const welcomeMessage: ChatMessage = {
    id: "welcome",
    role: "agent",
    content: activeFleetAgent
      ? `${activeFleetAgent.icon} I'm ${activeFleetAgent.name}, a specialized ${activeFleetAgent.template.replace('_', ' ')} agent. How can I help?`
      : agentMode
        ? `Hey! I'm ${agentName}. I'm in *Agent Mode* — I can actually execute commands, read/write files, clone repos, and more. Try asking me to do something!`
        : `Hey! I'm ${agentName}. I can help answer questions and have conversations. What are we working on?`,
    timestamp: new Date(),
    status: "sent",
  };

  // ── Check LLM availability (with periodic re-check) ──────────────────

  const recheckHealth = useCallback(async () => {
    const healthy = await checkLLMHealth();
    setLlmAvailable(healthy);
    return healthy;
  }, []);

  useEffect(() => {
    recheckHealth();
    // Re-check every 30s when disconnected, every 60s when connected
    const interval = setInterval(
      recheckHealth,
      llmAvailable === false ? 15_000 : 60_000
    );
    return () => clearInterval(interval);
  }, [llmAvailable, recheckHealth]);

  // ── Persist fleet agent selection ─────────────────────────────────────

  useEffect(() => {
    if (activeFleetAgent) {
      localStorage.setItem("sovereign_active_fleet_agent", JSON.stringify(activeFleetAgent));
    } else {
      localStorage.removeItem("sovereign_active_fleet_agent");
    }
  }, [activeFleetAgent]);

  // ── Queue persistence ────────────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue)); } catch { /* full */ }
  }, [queue]);

  // ── Loading elapsed timer & stale detection ─────────────────────────
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

  // ── Queue processor: auto-send next queued message after completion ──
  useEffect(() => {
    if (!agentRunning && !isTyping && queue.length > 0) {
      const [next, ...rest] = queue;
      setQueue(rest);
      setInput(next.content);
      setTimeout(() => {
        setInput('');
        void (async () => {
          const trimmed = next.content;
          let convId = activeConversationId;
          if (!convId && apiAvailable !== false) {
            try {
              const conv = await createConversation();
              convId = conv.id;
              setActiveConversationId(conv.id);
              setApiAvailable(true);
            } catch { setApiAvailable(false); }
          }
          const userMsg: ChatMessage = {
            id: `user-${Date.now()}`,
            role: "user",
            content: trimmed,
            timestamp: new Date(),
            status: "sent",
          };
          const sendKey = activeFleetAgent?.conversation_id ?? convId ?? "__none__";
          setMessagesMap((prev) => ({ ...prev, [sendKey]: [...(prev[sendKey] ?? []), userMsg] }));
          setIsTypingMap((prev) => ({ ...prev, [sendKey]: true }));
          if (convId && apiAvailable !== false) addMessage(convId, "user", trimmed).catch(() => {});
          if (convId) markConversationRead(convId);
          try {
            if (agentMode) await handleSendAgent(trimmed, convId);
            else await handleSendChat(trimmed, convId);
          } catch {
            setIsTypingMap((prev) => ({ ...prev, [sendKey]: false }));
            setAgentRunningMap((prev) => ({ ...prev, [sendKey]: false }));
          }
        })();
      }, 200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentRunning, isTyping, queue.length]);

  // ── Smart auto-scroll (respects user scroll position) ───────────────

  const scrollToBottom = useCallback(() => {
    if (!userScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  // Track when user scrolls up — don't auto-scroll if they have
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Consider "scrolled up" if more than 100px from bottom
      userScrolledUpRef.current = (scrollHeight - scrollTop - clientHeight) > 100;
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, agentToolCalls, scrollToBottom]);

  // ── Check channels ────────────────────────────────────────────────────

  useEffect(() => {
    const checkChannels = async () => {
      try {
        const status = await safeInvoke<ChannelStatus>("get_channel_status");
        setChannels(status);
      } catch {
        // Channel status not available
      }
    };
    checkChannels();
    const interval = setInterval(checkChannels, 30000);
    return () => clearInterval(interval);
  }, []);

  // ── Load conversation when selected ───────────────────────────────────

  const loadConversation = useCallback(
    async (id: string) => {
      setConversationLoading(true);
      try {
        const conv = await getConversation(id);
        setActiveConversationId(id);
        setMessagesMap((prev) => ({ ...prev, [id]: conv.messages.map(apiToLocal) }));
        setApiAvailable(true);
        // Mark as read when loading conversation
        markConversationRead(id);
      } catch {
        setApiAvailable(false);
        toast.error("Could not load conversation — API may be offline");
      } finally {
        setConversationLoading(false);
      }
    },
    []
  );

  // ── Persist active conversation ID to survive navigation ────────────

  useEffect(() => {
    if (activeConversationId) {
      localSet("active_conversation_id", activeConversationId);
    }
  }, [activeConversationId]);

  // ── Auto-reload last conversation on mount ──────────────────────────

  useEffect(() => {
    if (activeConversationId && messages.length === 0) {
      loadConversation(activeConversationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fleet agent selection ─────────────────────────────────────────────

  const handleSelectFleetAgent = useCallback(
    async (agent: FleetAgent | null) => {
      if (agent === null) {
        setActiveFleetAgent(null);
        const mainConvId = localGet<string | null>("active_conversation_id", null);
        if (mainConvId) {
          loadConversation(mainConvId);
        }
        return;
      }

      setActiveFleetAgent(agent);

      if (agent.conversation_id) {
        try {
          const conv = await getConversation(agent.conversation_id);
          if (conv && conv.messages) {
            setMessagesMap((prev) => ({ ...prev, [agent.conversation_id!]: conv.messages.map(apiToLocal) }));
          }
          // Mark as read
          markConversationRead(agent.conversation_id);
        } catch {
          // Conversation might not have messages yet
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadConversation]
  );

  // ── Create new conversation ───────────────────────────────────────────

  const handleNewConversation = useCallback(async (agentId?: string | null) => {
    try {
      const conv = await createConversation(undefined, agentId || undefined);
      setActiveConversationId(conv.id);
      setMessagesMap((prev) => ({ ...prev, [conv.id]: [] }));
      setApiAvailable(true);
      userScrolledUpRef.current = false;
      // Mark new conversation as read immediately
      markConversationRead(conv.id);
      return conv;
    } catch {
      setActiveConversationId(null);
      setApiAvailable(false);
      return null;
    }
  }, []);

  // ── Auto-resize textarea ──────────────────────────────────────────────

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + "px";
  };

  // ── Stop agent ────────────────────────────────────────────────────────

  const handleStopAgent = () => {
    const key = convKey;
    if (abortControllerMapRef.current[key]) {
      abortControllerMapRef.current[key].abort();
      delete abortControllerMapRef.current[key];
    }
    setAgentRunningMap((prev) => ({ ...prev, [key]: false }));
    setIsTypingMap((prev) => ({ ...prev, [key]: false }));
  };

  // ── Send message (Agent Mode) ─────────────────────────────────────────

  const handleSendAgent = async (trimmed: string, convId: string | null) => {
    // Capture the conversation key at send time so callbacks always target the right conversation
    const sendKey = activeFleetAgent?.conversation_id ?? convId ?? "__none__";

    setAgentRunningMap((prev) => ({ ...prev, [sendKey]: true }));
    setAgentIterationMap((prev) => ({ ...prev, [sendKey]: 0 }));
    setAgentToolCallsMap((prev) => ({ ...prev, [sendKey]: [] }));
    setAgentThinkingMap((prev) => ({ ...prev, [sendKey]: "" }));

    const abortController = new AbortController();
    abortControllerMapRef.current[sendKey] = abortController;

    const history = messages
      .filter((m) => m.id !== "welcome")
      .slice(-20)
      .map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      }));

    const collectedToolCalls: AgentToolCall[] = [];
    let thinkingText = "";

    const effectiveConvId = activeFleetAgent
      ? activeFleetAgent.conversation_id
      : convId;

    const fleetOverrides = activeFleetAgent
      ? {
          system_prompt: activeFleetAgent.system_prompt,
          model: activeFleetAgent.model,
          fleet_agent_id: activeFleetAgent.id,
        }
      : undefined;

    try {
      const finalMessage = await chatWithAgent(
        trimmed,
        effectiveConvId,
        history,
        {
          onStatus: (iteration) => {
            resetStaleTimer();
            setAgentIterationMap((prev) => ({ ...prev, [sendKey]: iteration }));
          },
          onThinking: (text) => {
            resetStaleTimer();
            thinkingText += text;
            setAgentThinkingMap((prev) => ({ ...prev, [sendKey]: thinkingText }));
          },
          onToolCall: (id, tool, input) => {
            resetStaleTimer();
            const newCall: AgentToolCall = { id, tool, input, status: 'running' };
            collectedToolCalls.push(newCall);
            setAgentToolCallsMap((prev) => ({ ...prev, [sendKey]: [...collectedToolCalls] }));
          },
          onToolResult: (id, _tool, output, durationMs) => {
            resetStaleTimer();
            const call = collectedToolCalls.find(c => c.id === id);
            if (call) {
              call.output = output;
              call.status = (output as Record<string, unknown>).error ? 'error' : 'completed';
              call.duration_ms = durationMs;
              setAgentToolCallsMap((prev) => ({ ...prev, [sendKey]: [...collectedToolCalls] }));
            }
          },
          onMessage: (text) => {
            resetStaleTimer();
            const agentMsg: ChatMessage = {
              id: `agent-${Date.now()}`,
              role: "agent",
              content: text,
              timestamp: new Date(),
              status: "sent",
              toolCalls: collectedToolCalls.length > 0 ? [...collectedToolCalls] : undefined,
              thinking: thinkingText || undefined,
            };

            setIsTypingMap((prev) => ({ ...prev, [sendKey]: false }));
            setAgentRunningMap((prev) => ({ ...prev, [sendKey]: false }));
            setAgentToolCallsMap((prev) => ({ ...prev, [sendKey]: [] }));
            setAgentThinkingMap((prev) => ({ ...prev, [sendKey]: "" }));
            setMessagesMap((prev) => ({ ...prev, [sendKey]: [...(prev[sendKey] ?? []), agentMsg] }));
            delete abortControllerMapRef.current[sendKey];

            if (convId && apiAvailable !== false) {
              addMessage(convId, "agent", text).catch(() => {});
            }

            // Play notification ding — the agent just finished responding
            playNotificationDing();
          },
          onError: (error) => {
            toast.error(`Agent error: ${error}`, { duration: 5000 });
          },
          onDone: () => {
            setAgentRunningMap((prev) => ({ ...prev, [sendKey]: false }));
            setIsTypingMap((prev) => ({ ...prev, [sendKey]: false }));
            delete abortControllerMapRef.current[sendKey];
          },
        },
        abortController.signal,
        fleetOverrides
      );

      if (llmAvailable === false || llmAvailable === null) {
        setLlmAvailable(true);
      }

      if (finalMessage && !messages.find(m => m.content === finalMessage)) {
        // The onMessage callback should have handled this
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        toast('Agent stopped', { icon: '🛑' });
      } else {
        const errMsg = (err as Error).message || 'Unknown error';
        toast.error(`Agent error: ${errMsg}`, { duration: 5000 });
      }
    } finally {
      setAgentRunningMap((prev) => ({ ...prev, [sendKey]: false }));
      setIsTypingMap((prev) => ({ ...prev, [sendKey]: false }));
      delete abortControllerMapRef.current[sendKey];
    }
  };

  // ── Send message (Chat Mode — original behavior) ──────────────────────

  const handleSendChat = async (trimmed: string, convId: string | null) => {
    const sendKey = activeFleetAgent?.conversation_id ?? convId ?? "__none__";

    const abortController = new AbortController();
    abortControllerMapRef.current[sendKey] = abortController;

    const history = messages
      .filter((m) => m.id !== "welcome")
      .slice(-20)
      .map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      }));

    const response = await chatWithAI(trimmed, history, abortController.signal);

    const agentMsg: ChatMessage = {
      id: `agent-${Date.now()}`,
      role: "agent",
      content: response,
      timestamp: new Date(),
      status: "sent",
    };

    setIsTypingMap((prev) => ({ ...prev, [sendKey]: false }));
    setMessagesMap((prev) => ({ ...prev, [sendKey]: [...(prev[sendKey] ?? []), agentMsg] }));
    delete abortControllerMapRef.current[sendKey];

    if (convId && apiAvailable !== false) {
      addMessage(convId, "agent", response).catch(() => {});
    }

    if (llmAvailable === false || llmAvailable === null) {
      setLlmAvailable(true);
    }
  };

  // ── Send message (unified entry point) ────────────────────────────────

  // ── Interrupt: stop current + queue the new message first ─────────────
  const handleInterrupt = () => {
    const trimmed = input.trim();
    handleStopAgent();
    if (trimmed) {
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
      setQueue((prev) => [
        { id: `q-${Date.now()}`, content: trimmed, timestamp: Date.now() },
        ...prev,
      ]);
    }
  };

  // ── Queue a message while agent is running ──────────────────────────
  const handleQueueMessage = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setQueue((prev) => [
      ...prev,
      { id: `q-${Date.now()}`, content: trimmed, timestamp: Date.now() },
    ]);
    toast(`Queued: "${trimmed.slice(0, 40)}${trimmed.length > 40 ? '...' : ''}"`, { icon: '📋', duration: 2000 });
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    if (agentRunning) {
      handleQueueMessage();
      return;
    }

    // Create conversation on first message if none active
    let convId = activeConversationId;
    if (!convId && apiAvailable !== false) {
      try {
        const conv = await createConversation();
        convId = conv.id;
        setActiveConversationId(conv.id);
        setApiAvailable(true);
      } catch {
        setApiAvailable(false);
      }
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: new Date(),
      status: "sent",
    };

    const sendKey = activeFleetAgent?.conversation_id ?? convId ?? "__none__";
    setMessagesMap((prev) => ({ ...prev, [sendKey]: [...(prev[sendKey] ?? []), userMsg] }));
    setInput("");
    setIsTypingMap((prev) => ({ ...prev, [sendKey]: true }));

    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    // Persist user message
    if (convId && apiAvailable !== false) {
      addMessage(convId, "user", trimmed).catch(() => {});
    }

    // Mark conversation as read since user is actively interacting
    if (convId) {
      markConversationRead(convId);
    }

    try {
      if (agentMode) {
        await handleSendAgent(trimmed, convId);
      } else {
        await handleSendChat(trimmed, convId);
      }
    } catch (err) {
      setIsTypingMap((prev) => ({ ...prev, [sendKey]: false }));
      setAgentRunningMap((prev) => ({ ...prev, [sendKey]: false }));

      // Fallback to Tauri backend
      try {
        const tauriResponse = await safeInvoke<string>("chat_with_agent", {
          message: trimmed,
        });
        const agentMsg: ChatMessage = {
          id: `agent-${Date.now()}`,
          role: "agent",
          content: tauriResponse,
          timestamp: new Date(),
          status: "sent",
        };
        setMessagesMap((prev) => ({ ...prev, [sendKey]: [...(prev[sendKey] ?? []), agentMsg] }));
        if (convId && apiAvailable !== false) {
          addMessage(convId, "agent", tauriResponse).catch(() => {});
        }
        return;
      } catch {
        // Both failed
      }

      // Re-check health — the backend may have recovered
      const stillDown = !(await recheckHealth());

      if (stillDown) {
        const errorMsg: ChatMessage = {
          id: `error-${Date.now()}`,
          role: "agent",
          content: `I can't respond right now — the AI backend isn't reachable.\n\nTo fix this:\n1. Make sure Docker Desktop is running\n2. Check that the Sovereign Stack is started: \`docker compose up -d\`\n3. Verify LiteLLM is healthy at http://127.0.0.1:4000/health/liveliness\n\nI'll automatically retry when the backend comes back online. You can also click "Retry Connection" below.`,
          timestamp: new Date(),
          status: "error",
        };
        setMessagesMap((prev) => ({ ...prev, [sendKey]: [...(prev[sendKey] ?? []), errorMsg] }));
        toast.error("AI not connected — will auto-retry in 15 seconds", {
          duration: 5000,
        });
      } else {
        toast("Backend reconnected — retrying your message...", { icon: "🔄" });
        try {
          if (agentMode) {
            await handleSendAgent(trimmed, convId);
          } else {
            await handleSendChat(trimmed, convId);
          }
        } catch {
          const errorMsg: ChatMessage = {
            id: `error-${Date.now()}`,
            role: "agent",
            content: `Something went wrong with that request. The backend is online but the request failed. Please try again.`,
            timestamp: new Date(),
            status: "error",
          };
          setMessagesMap((prev) => ({ ...prev, [sendKey]: [...(prev[sendKey] ?? []), errorMsg] }));
          toast.error("Request failed — please try again");
        }
      }
    }
  };

  // ── Key handler ───────────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape" && agentRunning) {
      e.preventDefault();
      handleStopAgent();
    }
  };

  // ── Format time ───────────────────────────────────────────────────────

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // ── Enhanced content rendering ───────────────────────────────────────

  const renderContent = (content: string) => {
    // Check for :::canvas blocks (rich visual content)
    if (content.includes(":::canvas")) {
      const segments = parseRichContent(content);
      return segments.map((segment, i) => {
        if (segment.type === "canvas") {
          return <RichMessageBlock key={`canvas-${i}`} jsonlContent={segment.content} />;
        }
        return <span key={`text-${i}`}>{renderMarkdown(segment.content)}</span>;
      });
    }
    return renderMarkdown(content);
  };

  const renderMarkdown = (content: string) => {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Inline images
          img: ({ src, alt }) => {
            if (!src) return null;
            return <InlineImage src={src} alt={alt} />;
          },
          // Code blocks with language label
          code: ({ node, className, children, ...props }: any) => {
            const match = /language-(\w+)/.exec(className || "");
            const lang = match ? match[1] : "";
            const inline = !className;
            
            if (lang === "json" && !inline) {
              try {
                const jsonData = JSON.parse(String(children));
                return <JsonBlock data={jsonData} />;
              } catch {
                // Fall through to regular code block if JSON parsing fails
              }
            }

            if (!inline && lang) {
              return (
                <div className="my-3 rounded-lg overflow-hidden">
                  <div className="bg-slate-900 px-3 py-1 text-xs text-slate-400 font-mono border-b border-slate-700">
                    {lang}
                  </div>
                  <pre className="bg-slate-900/80 p-3 text-sm font-mono text-green-300 overflow-x-auto">
                    <code className={className} {...props}>
                      {children}
                    </code>
                  </pre>
                </div>
              );
            }
            
            return inline ? (
              <code className="bg-slate-800 px-1.5 py-0.5 rounded text-xs font-mono text-blue-300" {...props}>
                {children}
              </code>
            ) : (
              <pre className="bg-slate-900/80 p-3 text-sm font-mono text-green-300 overflow-x-auto rounded-lg my-3">
                <code {...props}>{children}</code>
              </pre>
            );
          },
          // Tables
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="min-w-full border border-slate-700 rounded-lg overflow-hidden">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-slate-800 border-b border-slate-700">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-300 border-r border-slate-700 last:border-r-0">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-xs text-slate-400 border-r border-slate-700 border-b border-slate-800 last:border-r-0">
              {children}
            </td>
          ),
          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline transition-colors"
            >
              {children}
            </a>
          ),
          // Bold
          strong: ({ children }) => (
            <strong className="font-semibold text-white">{children}</strong>
          ),
          // Italic
          em: ({ children }) => (
            <em className="italic text-slate-300">{children}</em>
          ),
          // Lists
          ul: ({ children }) => (
            <ul className="list-disc list-inside space-y-1 my-2">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside space-y-1 my-2">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-sm text-slate-300">{children}</li>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    );
  };

  // ── Messages to display (include welcome if empty) ────────────────────

  const displayMessages = messages.length > 0 ? messages : [welcomeMessage];

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      {/* Sidebar: Conversations grouped by agent */}
      <ConversationSidebar
        activeConversationId={activeConversationId}
        onSelectConversation={(id, agentId) => {
          if (agentId) {
            // Selecting a fleet agent conversation — update fleet agent too
            // The activeFleetAgent will be updated by the sidebar's onSelectFleetAgent
          } else {
            setActiveFleetAgent(null);
          }
          loadConversation(id);
          userScrolledUpRef.current = false;

          markConversationRead(id);
        }}
        onNewConversation={async (agentId) => {
          if (!agentId) {
            setActiveFleetAgent(null);
          }
          const conv = await handleNewConversation(agentId);
          if (conv && agentId && activeFleetAgent) {
            setActiveFleetAgent({ ...activeFleetAgent, conversation_id: conv.id });
          }
        }}
        onSelectFleetAgent={handleSelectFleetAgent}
        activeFleetAgentId={activeFleetAgent?.id ?? null}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onShowLaunchAgent={() => setShowLaunchAgent(true)}
      />
      {/* Fleet Launch Dialog (rendered by FleetPanel) */}
      <FleetPanel
        activeAgentId={activeFleetAgent?.id ?? null}
        onSelectAgent={handleSelectFleetAgent}
        showLaunchDialog={showLaunchAgent}
        onCloseLaunchDialog={() => setShowLaunchAgent(false)}
      />

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Fleet agent context banner */}
        {activeFleetAgent && (
          <div className="flex items-center justify-between px-4 py-1.5 border-b border-blue-800/50 bg-blue-900/20">
            <div className="flex items-center gap-2">
              <span className="text-base">{activeFleetAgent.icon}</span>
              <span className="text-sm font-medium text-blue-300">{activeFleetAgent.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400 border border-blue-800/50">
                {activeFleetAgent.template.replace('_', ' ')}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500">
                {activeFleetAgent.model}
              </span>
            </div>
            <button
              onClick={() => handleSelectFleetAgent(null)}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
            >
              ← Back to Main Agent
            </button>
          </div>
        )}
        {/* Channel status bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400">Connected:</span>
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
            {/* Agent Mode Toggle */}
            <button
              onClick={() => setAgentMode(!agentMode)}
              disabled={agentRunning}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                agentMode
                  ? "bg-emerald-900/30 text-emerald-400 border-emerald-800 hover:bg-emerald-900/50"
                  : "bg-slate-800 text-slate-500 border-slate-700 hover:bg-slate-700"
              } ${agentRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              title={agentMode ? "Agent Mode: AI can execute commands" : "Chat Mode: Text-only conversation"}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${agentMode ? "bg-emerald-400" : "bg-slate-600"}`} />
              {agentMode ? "⚡ Agent" : "💬 Chat"}
            </button>

            {/* Launch Agent Button */}
            <button
              onClick={() => setShowLaunchAgent(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-blue-800 bg-blue-900/30 text-blue-400 hover:bg-blue-900/50 transition-all cursor-pointer"
              title="Launch a new agent"
            >
              <span className="text-sm leading-none">+</span>
              New Agent
            </button>

            {/* Sound Settings Button */}
            <button
              onClick={() => setShowSoundSettings(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white transition-all cursor-pointer"
              title="Sound settings"
            >
              🔔
            </button>

            {llmAvailable === false && (
              <button
                onClick={async () => {
                  toast("Checking AI backend...", { icon: "🔄" });
                  const ok = await recheckHealth();
                  if (ok) {
                    toast.success("AI backend reconnected!");
                  } else {
                    toast.error("Still disconnected — check Docker stack");
                  }
                }}
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
            <span className="text-xs text-slate-600">
              {messages.length} messages
            </span>
          </div>
        </div>

        {/* Conversation loading overlay */}
        {conversationLoading && (
          <div className="flex items-center justify-center py-4 bg-slate-900/50 border-b border-slate-800">
            <span className="animate-spin w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full mr-2" />
            <span className="text-xs text-slate-500">Loading conversation...</span>
          </div>
        )}

        {/* Messages area */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-4 scrollbar-thin">
          {displayMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.role === "user" ? "justify-end" : "justify-start"
              } animate-fadeIn`}
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
                    <span className="text-xs font-semibold text-slate-400">
                      {agentName}
                    </span>
                    {msg.toolCalls && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-400 border border-emerald-800/50">
                        {msg.toolCalls.length} tool{msg.toolCalls.length !== 1 ? 's' : ''} used
                      </span>
                    )}
                  </div>
                )}

                {/* Thinking text (before tool calls) */}
                {msg.thinking && (
                  <div className="text-sm text-slate-400 italic mb-2">
                    {renderContent(msg.thinking)}
                  </div>
                )}

                {/* Tool call blocks — scrollable, last 5 visible by default */}
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

                {/* Main content */}
                <div className="text-sm leading-relaxed text-slate-100 prose prose-invert prose-sm max-w-none">
                  {renderContent(msg.content)}
                </div>
                <div
                  className={`flex items-center gap-2 text-[10px] mt-2 ${
                    msg.role === "user" ? "text-blue-200" : "text-slate-500"
                  }`}
                >
                  {formatTime(msg.timestamp)}
                  {msg.role === "agent" && msg.content.length > 10 && (
                    <SpeakButton text={msg.content} />
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Agent running indicator — shows live tool calls */}
          {agentRunning && (
            <div className="flex justify-start animate-fadeIn">
              <div className="max-w-[80%] bg-slate-800/90 border border-slate-700 rounded-2xl rounded-bl-md px-4 py-3 shadow-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm">⚡</span>
                  <span className="text-xs font-semibold text-slate-400">{agentName}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-800/50 animate-pulse">
                    Step {agentIteration}
                  </span>
                </div>

                {/* Thinking text */}
                {agentThinking && (
                  <div className="text-sm text-slate-400 italic mb-2">
                    {renderContent(agentThinking)}
                  </div>
                )}

                {/* Live tool calls — scrollable, last 5 visible */}
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

                {/* Spinner + elapsed time */}
                <div className="flex items-center gap-2 mt-2">
                  <span className="animate-spin w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full" />
                  <span className="text-[10px] text-slate-500">Working...</span>
                  <span className="text-[10px] text-slate-600 tabular-nums ml-auto">{formatElapsed(loadingElapsed)}</span>
                </div>

                {/* Stale warning */}
                {showStaleWarning && (
                  <div className="flex items-center gap-2 mt-2 px-2.5 py-1.5 rounded-lg bg-amber-900/20 border border-amber-800/40 animate-fadeIn">
                    <span className="flex items-center justify-center w-4 h-4 min-w-[16px] rounded-full bg-amber-500 text-[10px] font-bold text-black">!</span>
                    <span className="text-[11px] text-amber-400">No progress for {formatElapsed(loadingElapsed)}</span>
                    <div className="flex gap-1.5 ml-auto">
                      <button
                        onClick={() => {
                          handleStopAgent();
                          const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
                          if (lastUserMsg) {
                            setTimeout(() => {
                              setInput(lastUserMsg.content);
                              handleSend();
                            }, 300);
                          }
                        }}
                        className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                      >
                        Retry
                      </button>
                      <button
                        onClick={handleStopAgent}
                        className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-900/40 hover:bg-red-900/60 text-red-400 border border-red-800/50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Simple typing indicator (chat mode only) */}
          {isTyping && !agentRunning && (
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
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Queue display */}
        {queue.length > 0 && (
          <div className="border-t border-slate-800 bg-slate-850/60 px-4 py-2 max-h-[120px] overflow-y-auto">
            <div className="max-w-4xl mx-auto">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  Queued ({queue.length})
                </span>
                <button
                  onClick={() => setQueue([])}
                  className="text-[10px] text-slate-600 hover:text-red-400 transition-colors"
                >
                  Clear all
                </button>
              </div>
              {queue.map((item, idx) => (
                <div key={item.id} className="flex items-center gap-2 py-1 px-2 mb-1 rounded bg-slate-800/60 border border-slate-700/50">
                  <span className="text-[10px] font-bold text-blue-400 min-w-[14px] text-center">{idx + 1}</span>
                  <span className="text-xs text-slate-400 flex-1 truncate">{item.content}</span>
                  <button
                    onClick={() => setQueue((prev) => prev.filter((q) => q.id !== item.id))}
                    className="text-[10px] text-slate-600 hover:text-red-400 transition-colors px-1"
                    title="Remove"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Input area */}
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
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={
                  agentRunning
                    ? "Type to queue next message..."
                    : agentMode
                    ? "Ask me to do something..."
                    : "Type a message..."
                }
                rows={1}
                className={`w-full bg-slate-800 border rounded-xl px-4 py-3 pr-12 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 resize-none transition-all duration-200 ${
                  agentRunning && input.trim()
                    ? 'border-amber-600/50'
                    : 'border-slate-700'
                }`}
                style={{ minHeight: "44px", maxHeight: "150px" }}
              />
            </div>

            {/* Create visual button (✨) */}
            {!agentRunning && (
              <div className="relative flex-shrink-0">
                <button
                  onClick={() => setShowCreateMenu(prev => !prev)}
                  className="w-11 h-11 rounded-xl flex items-center justify-center bg-slate-800 hover:bg-indigo-600/20 border border-slate-700 hover:border-indigo-500/30 text-slate-400 hover:text-indigo-400 transition-all duration-200"
                  title="Create visual content"
                  aria-label="Create visual"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-4 h-4">
                    <path d="M12 2L9 12l-7 3 7 3 3 10 3-10 7-3-7-3z" />
                  </svg>
                </button>

                {showCreateMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowCreateMenu(false)} />
                    <div className="absolute bottom-14 right-0 w-64 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-50">
                      <div className="px-3 py-2 border-b border-slate-700">
                        <span className="text-xs font-semibold text-slate-400">Create Visual</span>
                      </div>
                      {[
                        { icon: "📊", label: "Dashboard", prompt: "Create a dashboard showing " },
                        { icon: "📈", label: "Chart / Metrics", prompt: "Build a visual with charts and metrics for " },
                        { icon: "📋", label: "Report", prompt: "Generate a visual report about " },
                        { icon: "🎨", label: "Mockup", prompt: "Design a UI mockup for " },
                      ].map((item) => (
                        <button
                          key={item.label}
                          onClick={() => {
                            setInput(item.prompt);
                            setShowCreateMenu(false);
                            inputRef.current?.focus();
                          }}
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
                )}
              </div>
            )}

            {/* Voice mic button */}
            {!agentRunning && (
              <VoiceMicButton
                onTranscription={(text) => {
                  setInput((prev) => (prev ? prev + " " + text : text));
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
                    onClick={handleInterrupt}
                    className="h-11 px-3 rounded-xl flex items-center justify-center bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 active:scale-95 transition-all duration-200"
                    aria-label="Interrupt and send"
                    title="Stop current and send this message"
                  >
                    Interrupt
                  </button>
                )}
                <button
                  onClick={input.trim() ? handleQueueMessage : handleStopAgent}
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
                onClick={handleSend}
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
                : agentMode
                ? "⚡ Agent Mode — Shift+Enter for new line"
                : "Shift+Enter for new line"}
            </span>
            {agentRunning && (
              <span className="text-[10px] text-amber-400 animate-pulse">
                Step {agentIteration} · {formatElapsed(loadingElapsed)}
              </span>
            )}
            {queue.length > 0 && (
              <span className="text-[10px] text-blue-400">
                {queue.length} queued
              </span>
            )}
            {!agentRunning && anyAgentRunning && (
              <span className="text-[10px] text-blue-400/60">
                Other agents working...
              </span>
            )}
          </div>
        </div>
      </div>

    </div>
  );
      {/* Sound Settings Modal */}
      {showSoundSettings && (
        <SoundSettings onClose={() => setShowSoundSettings(false)} />
      )}

}
