import { useState, useEffect, useRef, useCallback } from "react";
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
import type { FleetAgent } from "@/lib/fleet";
import toast from "react-hot-toast";

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
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

  // Agent mode state
  const [agentMode, setAgentMode] = useState(true); // Default: agent mode ON
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentIteration, setAgentIteration] = useState(0);
  const [agentToolCalls, setAgentToolCalls] = useState<AgentToolCall[]>([]);
  const [agentThinking, setAgentThinking] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const [showLaunchAgent, setShowLaunchAgent] = useState(false);

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
        setMessages(conv.messages.map(apiToLocal));
        setApiAvailable(true);
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
        // Switch back to main agent
        setActiveFleetAgent(null);
        setMessages([]);
        // Restore the main conversation
        const mainConvId = localGet<string | null>("active_conversation_id", null);
        if (mainConvId) {
          loadConversation(mainConvId);
        }
        return;
      }

      setActiveFleetAgent(agent);
      setMessages([]);

      // Load fleet agent's conversation
      if (agent.conversation_id) {
        try {
          const conv = await getConversation(agent.conversation_id);
          if (conv && conv.messages) {
            setMessages(conv.messages.map(apiToLocal));
          }
        } catch {
          // Conversation might not have messages yet — that's fine
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
      setMessages([]);
      setApiAvailable(true);
      // Reset scroll tracking on new conversation
      userScrolledUpRef.current = false;
    } catch {
      setActiveConversationId(null);
      setMessages([]);
      setApiAvailable(false);
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
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setAgentRunning(false);
    setIsTyping(false);
  };

  // ── Send message (Agent Mode) ─────────────────────────────────────────

  const handleSendAgent = async (trimmed: string, convId: string | null) => {
    setAgentRunning(true);
    setAgentIteration(0);
    setAgentToolCalls([]);
    setAgentThinking("");

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const history = messages
      .filter((m) => m.id !== "welcome")
      .slice(-20)
      .map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      }));

    const collectedToolCalls: AgentToolCall[] = [];
    let thinkingText = "";

    // Fleet Mode: use fleet agent's conversation and system prompt
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
            setAgentIteration(iteration);
          },
          onThinking: (text) => {
            thinkingText += text;
            setAgentThinking(thinkingText);
          },
          onToolCall: (id, tool, input) => {
            const newCall: AgentToolCall = { id, tool, input, status: 'running' };
            collectedToolCalls.push(newCall);
            setAgentToolCalls([...collectedToolCalls]);
          },
          onToolResult: (id, _tool, output, durationMs) => {
            const call = collectedToolCalls.find(c => c.id === id);
            if (call) {
              call.output = output;
              call.status = (output as Record<string, unknown>).error ? 'error' : 'completed';
              call.duration_ms = durationMs;
              setAgentToolCalls([...collectedToolCalls]);
            }
          },
          onMessage: (text) => {
            const agentMsg: ChatMessage = {
              id: `agent-${Date.now()}`,
              role: "agent",
              content: text,
              timestamp: new Date(),
              status: "sent",
              toolCalls: collectedToolCalls.length > 0 ? [...collectedToolCalls] : undefined,
              thinking: thinkingText || undefined,
            };

            setIsTyping(false);
            setAgentRunning(false);
            setAgentToolCalls([]);
            setAgentThinking("");
            setMessages((prev) => [...prev, agentMsg]);

            // Persist agent response
            if (convId && apiAvailable !== false) {
              addMessage(convId, "agent", text).catch(() => {});
            }
          },
          onError: (error) => {
            toast.error(`Agent error: ${error}`, { duration: 5000 });
          },
          onDone: () => {
            setAgentRunning(false);
            setIsTyping(false);
          },
        },
        abortController.signal,
        fleetOverrides
      );

      if (llmAvailable === false || llmAvailable === null) {
        setLlmAvailable(true);
      }

      // If onMessage wasn't called but we got a final message from the promise
      if (finalMessage && !messages.find(m => m.content === finalMessage)) {
        // The onMessage callback should have handled this, but just in case
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        toast('Agent stopped', { icon: '🛑' });
      } else {
        throw err; // Let the outer handler deal with it
      }
    }
  };

  // ── Send message (Chat Mode — original behavior) ──────────────────────

  const handleSendChat = async (trimmed: string, convId: string | null) => {
    const history = messages
      .filter((m) => m.id !== "welcome")
      .slice(-20)
      .map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      }));

    const response = await chatWithAI(trimmed, history);

    const agentMsg: ChatMessage = {
      id: `agent-${Date.now()}`,
      role: "agent",
      content: response,
      timestamp: new Date(),
      status: "sent",
    };

    setIsTyping(false);
    setMessages((prev) => [...prev, agentMsg]);

    if (convId && apiAvailable !== false) {
      addMessage(convId, "agent", response).catch(() => {});
    }

    if (llmAvailable === false || llmAvailable === null) {
      setLlmAvailable(true);
    }
  };

  // ── Send message (unified entry point) ────────────────────────────────

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || agentRunning) return;

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

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    // Persist user message
    if (convId && apiAvailable !== false) {
      addMessage(convId, "user", trimmed).catch(() => {});
    }

    try {
      if (agentMode) {
        await handleSendAgent(trimmed, convId);
      } else {
        await handleSendChat(trimmed, convId);
      }
    } catch (err) {
      setIsTyping(false);
      setAgentRunning(false);

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
        setMessages((prev) => [...prev, agentMsg]);
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
        setMessages((prev) => [...prev, errorMsg]);
        toast.error("AI not connected — will auto-retry in 15 seconds", {
          duration: 5000,
        });
      } else {
        // Backend recovered between the failed call and our re-check — retry the send
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
          setMessages((prev) => [...prev, errorMsg]);
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
  };

  // ── Format time ───────────────────────────────────────────────────────

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // ── Render code blocks ────────────────────────────────────────────────

  const renderContent = (content: string) => {
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (part.startsWith("```") && part.endsWith("```")) {
        const code = part.slice(3, -3);
        const firstLine = code.indexOf("\n");
        const lang = firstLine > 0 ? code.slice(0, firstLine).trim() : "";
        const codeBody = lang ? code.slice(firstLine + 1) : code;
        return (
          <div key={i} className="my-3 rounded-lg overflow-hidden">
            {lang && (
              <div className="bg-slate-900 px-3 py-1 text-xs text-slate-400 font-mono border-b border-slate-700">
                {lang}
              </div>
            )}
            <pre className="bg-slate-900/80 p-3 text-sm font-mono text-green-300 overflow-x-auto whitespace-pre-wrap">
              {codeBody}
            </pre>
          </div>
        );
      }
      return (
        <span key={i} className="whitespace-pre-wrap">
          {part}
        </span>
      );
    });
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
        }}
        onNewConversation={(agentId) => {
          if (!agentId) {
            setActiveFleetAgent(null);
          }
          handleNewConversation(agentId);
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
                className={`max-w-[80%] ${
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

                {/* Tool call blocks */}
                {msg.toolCalls && msg.toolCalls.map((tc) => (
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

                {/* Main content */}
                <div className="text-sm leading-relaxed text-slate-100">
                  {renderContent(msg.content)}
                </div>
                <div
                  className={`text-[10px] mt-2 ${
                    msg.role === "user" ? "text-blue-200" : "text-slate-500"
                  }`}
                >
                  {formatTime(msg.timestamp)}
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

                {/* Live tool calls */}
                {agentToolCalls.map((tc) => (
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

                {/* Spinner at the bottom */}
                <div className="flex items-center gap-2 mt-2">
                  <span className="animate-spin w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full" />
                  <span className="text-[10px] text-slate-500">Working...</span>
                </div>
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

        {/* Input area */}
        <div className="border-t border-slate-800 bg-slate-900/80 backdrop-blur p-4">
          <div className="flex items-end gap-3 max-w-4xl mx-auto">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={agentMode ? "Ask me to do something..." : "Type a message..."}
                rows={1}
                disabled={agentRunning}
                className={`w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 pr-12 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 resize-none transition-all duration-200 ${
                  agentRunning ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                style={{ minHeight: "44px", maxHeight: "150px" }}
              />
            </div>

            {/* Send or Stop button */}
            {agentRunning ? (
              <button
                onClick={handleStopAgent}
                className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20 active:scale-95 transition-all duration-200"
                aria-label="Stop agent"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
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
              {agentMode ? "⚡ Agent Mode — Shift+Enter for new line" : "Shift+Enter for new line"}
            </span>
            {agentRunning && (
              <span className="text-[10px] text-amber-400 animate-pulse">
                Working on step {agentIteration}...
              </span>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
