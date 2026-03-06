import { useState } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────

interface ToolCallBlockProps {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
}

// ─── Tool Display Config ─────────────────────────────────────────────────

const TOOL_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  run_terminal_command: { icon: '⚡', label: 'Terminal', color: 'text-green-400 border-green-800/50 bg-green-900/20' },
  read_file:           { icon: '📄', label: 'Read File', color: 'text-blue-400 border-blue-800/50 bg-blue-900/20' },
  write_file:          { icon: '✏️', label: 'Write File', color: 'text-amber-400 border-amber-800/50 bg-amber-900/20' },
  list_directory:      { icon: '📁', label: 'List Dir', color: 'text-slate-400 border-slate-700/50 bg-slate-800/40' },
  search_files:        { icon: '🔍', label: 'Search', color: 'text-purple-400 border-purple-800/50 bg-purple-900/20' },
  git_clone:           { icon: '📥', label: 'Git Clone', color: 'text-orange-400 border-orange-800/50 bg-orange-900/20' },
  git_status:          { icon: '📊', label: 'Git Status', color: 'text-cyan-400 border-cyan-800/50 bg-cyan-900/20' },
  git_commit_and_push: { icon: '🚀', label: 'Git Commit', color: 'text-pink-400 border-pink-800/50 bg-pink-900/20' },
};

const DEFAULT_CONFIG = { icon: '🔧', label: 'Tool', color: 'text-slate-400 border-slate-700/50 bg-slate-800/40' };

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getCommandPreview(tool: string, input: Record<string, unknown>): string {
  if (tool === 'run_terminal_command') return String(input.command || '');
  if (tool === 'read_file') return String(input.path || '');
  if (tool === 'write_file') return String(input.path || '');
  if (tool === 'list_directory') return String(input.path || '/');
  if (tool === 'search_files') return `${input.type}: "${input.query}"`;
  if (tool === 'git_clone') return String(input.url || '');
  if (tool === 'git_status') return String(input.project || '');
  if (tool === 'git_commit_and_push') return String(input.message || '').slice(0, 60);
  return JSON.stringify(input).slice(0, 80);
}

function formatOutput(tool: string, output: Record<string, unknown>): string {
  if (output.error) return `Error: ${output.error}`;

  if (tool === 'run_terminal_command') {
    const parts: string[] = [];
    if (output.stdout) parts.push(String(output.stdout).trim());
    if (output.stderr) parts.push(String(output.stderr).trim());
    if (output.exitCode !== 0) parts.push(`Exit code: ${output.exitCode}`);
    return parts.join('\n') || '(no output)';
  }

  if (tool === 'read_file') {
    const content = String(output.content || '');
    if (content.length > 500) return content.slice(0, 500) + `\n... (${output.size} bytes total)`;
    return content;
  }

  if (tool === 'write_file') {
    return `Written ${output.bytes_written} bytes to ${output.path}`;
  }

  if (tool === 'list_directory') {
    const items = output.items as any[] || [];
    if (items.length === 0) return '(empty directory)';
    return items.slice(0, 20).map(i => `${i.type === 'directory' ? '📁' : '📄'} ${i.name}`).join('\n')
      + (items.length > 20 ? `\n... and ${items.length - 20} more` : '');
  }

  if (tool === 'search_files') {
    const results = output.results as string[] || [];
    if (results.length === 0) return 'No matches found';
    return results.slice(0, 15).join('\n') + (results.length > 15 ? `\n... and ${(output.count as number) - 15} more` : '');
  }

  if (tool === 'git_clone') {
    return output.success ? `Cloned to ${output.name}/` : String(output.error);
  }

  if (tool === 'git_status') {
    const files = output.files as any[] || [];
    if (files.length === 0) return `Branch: ${output.branch} — clean`;
    return `Branch: ${output.branch}\n${files.slice(0, 10).map((f: any) => `${f.status} ${f.path}`).join('\n')}`;
  }

  if (tool === 'git_commit_and_push') {
    return output.success
      ? `Committed${output.pushed ? ' and pushed' : ''}\n${output.commit_output || ''}`
      : String(output.error);
  }

  return JSON.stringify(output, null, 2).slice(0, 500);
}

// ─── Component ───────────────────────────────────────────────────────────

export function ToolCallBlock({ tool, input, output, status, durationMs }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const config = TOOL_CONFIG[tool] || DEFAULT_CONFIG;
  const preview = getCommandPreview(tool, input);

  return (
    <div className={`my-2 rounded-lg border ${config.color} overflow-hidden transition-all`}>
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
      >
        {/* Status indicator */}
        <span className="flex-shrink-0 text-sm">
          {status === 'running' && (
            <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          )}
          {status === 'completed' && '✅'}
          {status === 'error' && '❌'}
        </span>

        {/* Tool icon + label */}
        <span className="text-xs font-medium flex-shrink-0">{config.icon} {config.label}</span>

        {/* Command preview */}
        <code className="text-[11px] text-slate-400 truncate flex-1 font-mono">{preview}</code>

        {/* Duration */}
        {durationMs !== undefined && (
          <span className="text-[10px] text-slate-600 flex-shrink-0">{formatDuration(durationMs)}</span>
        )}

        {/* Expand indicator */}
        <span className={`text-[10px] text-slate-600 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}>
          ▸
        </span>
      </button>

      {/* Expanded output */}
      {expanded && output && (
        <div className="border-t border-slate-700/30 px-3 py-2">
          <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap overflow-x-auto max-h-60 overflow-y-auto scrollbar-thin">
            {formatOutput(tool, output)}
          </pre>
        </div>
      )}

      {/* Running state — show skeleton */}
      {expanded && status === 'running' && !output && (
        <div className="border-t border-slate-700/30 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="animate-spin w-3 h-3 border border-slate-500 border-t-transparent rounded-full" />
            <span className="text-[10px] text-slate-500">Executing...</span>
          </div>
        </div>
      )}
    </div>
  );
}
