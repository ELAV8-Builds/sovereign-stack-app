import { useState } from "react";

interface JsonBlockProps {
  data: unknown;
}

/**
 * Collapsible, syntax-highlighted JSON viewer
 */
export function JsonBlock({ data }: JsonBlockProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  const jsonString = JSON.stringify(data, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Syntax highlighting for JSON
  const highlightJson = (json: string) => {
    return json
      .replace(/(".*?"):/g, '<span class="text-blue-400">$1</span>:')
      .replace(/: (".*?")/g, ': <span class="text-green-400">$1</span>')
      .replace(/: (true|false|null)/g, ': <span class="text-purple-400">$1</span>')
      .replace(/: (\d+)/g, ': <span class="text-amber-400">$1</span>');
  };

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-slate-700 bg-slate-900/80">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-xs text-slate-400 hover:text-slate-300 transition-colors"
          >
            {isCollapsed ? "▸" : "▾"} JSON
          </button>
          <span className="text-[10px] text-slate-600">
            {jsonString.split("\n").length} lines
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="text-[10px] text-slate-400 hover:text-slate-300 transition-colors px-2 py-0.5 rounded hover:bg-slate-800"
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>

      {/* Content */}
      {!isCollapsed && (
        <pre className="p-3 text-xs font-mono overflow-x-auto max-h-[400px] overflow-y-auto scrollbar-thin">
          <code dangerouslySetInnerHTML={{ __html: highlightJson(jsonString) }} />
        </pre>
      )}
    </div>
  );
}
