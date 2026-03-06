/**
 * RichMessageBlock — Renders json-render specs inline in chat messages
 *
 * When the agent includes a :::canvas block in its response, this component
 * renders it as an interactive visual using json-render's shadcn components.
 *
 * Format in message content:
 * :::canvas
 * {"key":"root","type":"Stack","props":{"direction":"vertical"},"children":["m1"]}
 * {"key":"m1","type":"Card","props":{"title":"Revenue"},"children":["v1"]}
 * {"key":"v1","type":"Text","props":{"text":"$1,234","variant":"lead"}}
 * :::
 */
import { useState, useMemo } from "react";
import { Renderer, JSONUIProvider } from "@json-render/react";
import { canvasRegistry, elementsToSpec, type SpecElement } from "@/lib/canvas-catalog";
import type { Spec } from "@json-render/core";

interface RichMessageBlockProps {
  /** Raw JSONL content between :::canvas markers */
  jsonlContent: string;
}

export function RichMessageBlock({ jsonlContent }: RichMessageBlockProps) {
  const [expanded, setExpanded] = useState(true);

  const spec = useMemo<Spec | null>(() => {
    try {
      const lines = jsonlContent
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const elements: SpecElement[] = [];
      for (const line of lines) {
        try {
          const el = JSON.parse(line);
          if (el.key && el.type) {
            elements.push(el);
          }
        } catch {
          // Skip malformed lines
        }
      }

      return elementsToSpec(elements);
    } catch {
      return null;
    }
  }, [jsonlContent]);

  if (!spec) {
    return (
      <div className="my-2 p-3 rounded-lg bg-red-900/20 border border-red-800/30 text-xs text-red-400">
        Failed to render visual block
      </div>
    );
  }

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-indigo-500/20 bg-slate-900/50">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-indigo-500/5 border-b border-indigo-500/10">
        <div className="flex items-center gap-1.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3 h-3 text-indigo-400">
            <path d="M12 2L9 12l-7 3 7 3 3 10 3-10 7-3-7-3z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[10px] font-medium text-indigo-400/80">Visual</span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>

      {/* Rendered content */}
      {expanded && (
        <div className="p-4">
          <JSONUIProvider registry={canvasRegistry}>
            <Renderer spec={spec} registry={canvasRegistry} />
          </JSONUIProvider>
        </div>
      )}
    </div>
  );
}

/**
 * Parse a message content string and split it into text parts and canvas blocks.
 * Returns an array of segments: { type: "text", content: string } | { type: "canvas", content: string }
 */
export interface MessageSegment {
  type: "text" | "canvas";
  content: string;
}

export function parseRichContent(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const regex = /:::canvas\n([\s\S]*?):::/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // Text before the canvas block
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim();
      if (text) segments.push({ type: "text", content: text });
    }

    // Canvas block
    segments.push({ type: "canvas", content: match[1] });
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last canvas block
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim();
    if (text) segments.push({ type: "text", content: text });
  }

  // If no canvas blocks found, return the whole thing as text
  if (segments.length === 0) {
    segments.push({ type: "text", content });
  }

  return segments;
}
