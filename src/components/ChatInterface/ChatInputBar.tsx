import { useState, useCallback, useRef } from "react";
import { VoiceMicButton } from "../VoiceControls";
import { uploadFiles, type UploadedFile } from "@/lib/overmind";
import type { QueuedMessage } from "./types";
import { formatElapsed } from "./types";
import toast from "react-hot-toast";

// ─── @ Mention Autocomplete ─────────────────────────────────────────────

const AT_MENTIONS = [
  { id: "playbooks", label: "@playbooks", description: "Manage playbooks", icon: "📋" },
  { id: "skills", label: "@skills", description: "Browse & create skills", icon: "🧩" },
  { id: "fleets", label: "@fleets", description: "Fleet status & workers", icon: "🌐" },
  { id: "rules", label: "@rules", description: "View & edit rules", icon: "📏" },
] as const;

function AtMentionDropdown({
  filter,
  onSelect,
  onClose,
  selectedIndex,
}: {
  filter: string;
  onSelect: (mention: string) => void;
  onClose: () => void;
  selectedIndex: number;
}) {
  const filtered = AT_MENTIONS.filter((m) =>
    m.id.startsWith(filter.toLowerCase())
  );

  if (filtered.length === 0) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full left-0 mb-2 w-64 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-50">
        <div className="px-3 py-1.5 border-b border-slate-700">
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Mention</span>
        </div>
        {filtered.map((item, idx) => (
          <button
            key={item.id}
            onClick={() => onSelect(item.label)}
            className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
              idx === selectedIndex ? "bg-indigo-600/20 text-white" : "hover:bg-white/[0.04] text-slate-300"
            }`}
          >
            <span className="text-base">{item.icon}</span>
            <div>
              <span className="text-sm font-medium block">{item.label}</span>
              <span className="text-[10px] text-slate-500">{item.description}</span>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

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

export interface AttachedImage {
  file: File;
  preview: string;
  uploadedUrl?: string;
}

interface ChatInputBarProps {
  input: string;
  agentRunning: boolean;
  agentIteration: number;
  anyAgentRunning: boolean;
  loadingElapsed: number;
  queue: QueuedMessage[];
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  showCreateMenu: boolean;
  attachedImages: AttachedImage[];
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
  onAttachImages: (images: AttachedImage[]) => void;
  onRemoveImage: (index: number) => void;
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
  attachedImages,
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
  onAttachImages,
  onRemoveImage,
}: ChatInputBarProps) {
  const [showAtMenu, setShowAtMenu] = useState(false);
  const [atFilter, setAtFilter] = useState("");
  const [atSelectedIndex, setAtSelectedIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(f =>
      f.type.startsWith('image/') || f.type === 'application/pdf'
    );
    if (imageFiles.length === 0) {
      toast.error("Only images and PDFs are supported");
      return;
    }

    const newImages: AttachedImage[] = imageFiles.map(file => ({
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
    }));

    onAttachImages(newImages);

    try {
      const results = await uploadFiles(imageFiles);
      const updated = newImages.map((img, i) => ({
        ...img,
        uploadedUrl: results[i]?.url,
      }));
      onAttachImages(updated);
    } catch (err) {
      toast.error(`Upload failed: ${(err as Error).message}`);
    }
  }, [onAttachImages]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const detectAtMention = useCallback((value: string) => {
    const match = value.match(/@(\w*)$/);
    if (match) {
      setAtFilter(match[1]);
      setShowAtMenu(true);
      setAtSelectedIndex(0);
    } else {
      setShowAtMenu(false);
    }
  }, []);

  const handleInputChangeWrapped = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onInputChange(e);
    detectAtMention(e.target.value);
  };

  const handleAtSelect = (mention: string) => {
    const newValue = input.replace(/@\w*$/, mention + " ");
    onSetInput(newValue);
    setShowAtMenu(false);
    inputRef.current?.focus();
  };

  const handleKeyDownWrapped = (e: React.KeyboardEvent) => {
    if (showAtMenu) {
      const filtered = AT_MENTIONS.filter((m) => m.id.startsWith(atFilter.toLowerCase()));
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAtSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAtSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        if (filtered[atSelectedIndex]) {
          e.preventDefault();
          handleAtSelect(filtered[atSelectedIndex].label);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowAtMenu(false);
        return;
      }
    }
    onKeyDown(e);
  };

  return (
    <>
      <QueueDisplay queue={queue} onClearAll={onClearQueue} onRemove={onRemoveFromQueue} />

      <div
        className={`border-t bg-slate-900/80 backdrop-blur p-4 transition-colors ${
          isDragging ? "border-blue-500 bg-blue-900/10" : "border-slate-800"
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {isDragging && (
          <div className="flex items-center justify-center py-3 mb-2 rounded-xl border-2 border-dashed border-blue-500/50 bg-blue-900/10">
            <span className="text-sm text-blue-400">Drop images here</span>
          </div>
        )}

        {/* Image preview strip */}
        {attachedImages.length > 0 && (
          <div className="flex gap-2 mb-2 max-w-4xl mx-auto overflow-x-auto pb-1">
            {attachedImages.map((img, idx) => (
              <div key={idx} className="relative flex-shrink-0 group">
                {img.preview ? (
                  <img
                    src={img.preview}
                    alt={img.file.name}
                    className={`w-16 h-16 rounded-lg object-cover border ${
                      img.uploadedUrl ? "border-emerald-600/50" : "border-slate-600 animate-pulse"
                    }`}
                  />
                ) : (
                  <div className={`w-16 h-16 rounded-lg flex items-center justify-center border text-[10px] text-slate-400 ${
                    img.uploadedUrl ? "border-emerald-600/50 bg-slate-800" : "border-slate-600 bg-slate-800 animate-pulse"
                  }`}>
                    PDF
                  </div>
                )}
                <button
                  onClick={() => onRemoveImage(idx)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  &times;
                </button>
                {!img.uploadedUrl && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="animate-spin w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {agentRunning && (
          <div className="text-[10px] text-slate-600 mb-1.5 max-w-4xl mx-auto px-1">
            Type to queue a message — press Esc to stop
          </div>
        )}
        <div className="flex items-end gap-3 max-w-4xl mx-auto">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFileSelect(e.target.files);
              e.target.value = '';
            }}
          />

          <div className="flex-1 relative">
            {showAtMenu && (
              <AtMentionDropdown
                filter={atFilter}
                onSelect={handleAtSelect}
                onClose={() => setShowAtMenu(false)}
                selectedIndex={atSelectedIndex}
              />
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChangeWrapped}
              onKeyDown={handleKeyDownWrapped}
              placeholder={
                agentRunning
                  ? "Type to queue next message..."
                  : "Ask Overmind anything... (type @ for mentions)"
              }
              rows={1}
              className={`w-full bg-slate-800 border rounded-xl px-4 py-3 pr-12 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 resize-none transition-all duration-200 ${
                agentRunning && input.trim() ? "border-amber-600/50" : "border-slate-700"
              }`}
              style={{ minHeight: "44px", maxHeight: "150px" }}
            />
          </div>

          {/* Attach button */}
          {!agentRunning && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 text-slate-400 hover:text-slate-300 transition-all duration-200"
              title="Attach image"
              aria-label="Attach image"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
          )}

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
