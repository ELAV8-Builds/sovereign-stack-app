import { useState, useEffect, useRef, useCallback } from "react";
import { safeInvoke, localGet } from "@/lib/tauri";
import { chatWithAI, checkLLMHealth } from "@/lib/ai";
import toast from "react-hot-toast";

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: Date;
  status?: "sending" | "sent" | "error";
}

interface ChannelStatus {
  whatsapp: boolean;
  slack: boolean;
}

export function ChatInterface() {
  const agentName = localGet('agent_name', 'Sovereign Agent');
  const [llmAvailable, setLlmAvailable] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "agent",
      content:
        `Hey! I'm ${agentName}. I can manage your services, answer questions, run tasks — whatever you need. What are we working on?`,
      timestamp: new Date(),
      status: "sent",
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [channels, setChannels] = useState<ChannelStatus>({
    whatsapp: false,
    slack: false,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Check LLM availability on mount
  useEffect(() => {
    checkLLMHealth().then(setLlmAvailable);
  }, []);

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  // Check connected channels
  useEffect(() => {
    const checkChannels = async () => {
      try {
        const status = await safeInvoke<ChannelStatus>("get_channel_status");
        setChannels(status);
      } catch {
        // Mock: no channels connected yet
      }
    };
    checkChannels();
    const interval = setInterval(checkChannels, 30000);
    return () => clearInterval(interval);
  }, []);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + "px";
  };

  // Send message
  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

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

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    try {
      // Build conversation history for context (last 20 messages)
      const history = messages
        .filter((m) => m.id !== "welcome")
        .slice(-20)
        .map((m) => ({
          role: m.role === "user" ? "user" as const : "assistant" as const,
          content: m.content,
        }));

      // Try real AI via LiteLLM proxy first
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

      // Update LLM status if this is first success
      if (llmAvailable === false || llmAvailable === null) {
        setLlmAvailable(true);
      }
    } catch (err) {
      setIsTyping(false);

      // If LiteLLM is down, try direct Tauri backend
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
        return;
      } catch {
        // Both LiteLLM and Tauri failed — show error + mock fallback
      }

      // Show connection warning only once
      if (llmAvailable !== false) {
        setLlmAvailable(false);
        toast.error(
          "AI not connected — LiteLLM is not running. Showing preview responses.",
          { duration: 5000 }
        );
      }

      const mockMsg: ChatMessage = {
        id: `agent-${Date.now()}`,
        role: "agent",
        content: getMockResponse(trimmed),
        timestamp: new Date(),
        status: "sent",
      };
      setMessages((prev) => [...prev, mockMsg]);
    }
  };

  // Handle Enter to send (Shift+Enter for newline)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Format timestamp
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // Render message content with code blocks
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
      // Regular text — preserve newlines
      return (
        <span key={i} className="whitespace-pre-wrap">
          {part}
        </span>
      );
    });
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
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
          {llmAvailable === false && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-900/30 text-yellow-400 border border-yellow-800">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
              Preview Mode
            </span>
          )}
          {llmAvailable === true && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/30 text-green-400 border border-green-800">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              AI Connected
            </span>
          )}
          <span className="text-xs text-slate-600">
            {messages.length - 1} messages
          </span>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 scrollbar-thin">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-fadeIn`}
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
                  <span className="text-sm">🤖</span>
                  <span className="text-xs font-semibold text-slate-400">
                    {agentName}
                  </span>
                </div>
              )}
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

        {/* Typing indicator */}
        {isTyping && (
          <div className="flex justify-start animate-fadeIn">
            <div className="bg-slate-800/90 border border-slate-700 rounded-2xl rounded-bl-md px-4 py-3 shadow-lg">
              <div className="flex items-center gap-2">
                <span className="text-sm">🤖</span>
                <div className="flex gap-1">
                  <span
                    className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
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
              placeholder="Type a message..."
              rows={1}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 pr-12 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 resize-none transition-all duration-200"
              style={{ minHeight: "44px", maxHeight: "150px" }}
            />
          </div>
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
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
        <div className="flex items-center gap-4 mt-2 max-w-4xl mx-auto px-1">
          <span className="text-[10px] text-slate-600">
            Shift+Enter for new line
          </span>
        </div>
      </div>
    </div>
  );
}

// Mock responses for development
function getMockResponse(input: string): string {
  const lower = input.toLowerCase();

  if (lower.includes("service") || lower.includes("status") || lower.includes("running")) {
    return `All services are looking good! Here's the rundown:

● *nanoclaw* — Running (port 18789)
● *litellm* — Running (port 4000)
● *ollama* — Running (port 11434)
● *memu* — Running (port 8090)
● *postgresql* — Running (port 5432)
○ *temporal* — Stopped (port 7233)
● *anythingllm* — Running (port 3001)

6/7 running. Temporal is stopped — want me to start it?`;
  }

  if (lower.includes("start") || lower.includes("restart")) {
    return `Done! Service restarted successfully. ✅

It took about 3 seconds to come back up. Health check passed — all endpoints responding.`;
  }

  if (lower.includes("cost") || lower.includes("spend") || lower.includes("money")) {
    return `Here's your usage today:

💰 *Today:* $3.47
📊 *This week:* $18.92
📅 *This month:* $67.34

Breakdown by model:
• Opus 4.6: $2.10 (45 requests)
• Sonnet 4.5: $0.89 (23 requests)
• Haiku: $0.48 (234 requests)

You're well within normal range. ☕ Less than a coffee.`;
  }

  if (lower.includes("help") || lower.includes("what can")) {
    return `I can help with:

• *Check services* — "Are all services running?"
• *Manage services* — "Restart litellm" / "Stop temporal"
• *View logs* — "Show me nanoclaw logs"
• *Check costs* — "How much have I spent today?"
• *Run commands* — "Run a health check"
• *Answer questions* — Anything about your stack

Just ask naturally — I'll figure it out.`;
  }

  return `Got it! I'm working on that now. Give me a moment...

I've processed your request. The task completed successfully. Let me know if you need anything else!`;
}
