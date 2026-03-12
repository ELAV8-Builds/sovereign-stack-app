/**
 * Agent Engine — Agentic Chat with Tool Execution
 *
 * Turns the Sovereign Stack from a chatbot into an agent.
 * The AI can execute terminal commands, read/write files, perform git operations,
 * and run creative tools — all within the existing security sandbox.
 *
 * Uses Server-Sent Events (SSE) to stream progress to the frontend.
 */
import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  chatCompletionWithTools,
  type ChatMessage,
  type ToolDefinition,
  type ToolCall,
} from '../services/litellm';
import { query } from '../services/database';
import { logActivity } from '../services/activity-broadcaster';
import { registerAgentRunner, enqueueTask, getJob, type AgentJob } from '../services/task-queue';
import { queryWorkspace, ensureDefaultWorkspace } from '../services/anythingllm';
import { getCapabilitySummary } from '../services/capabilities';
import { memuRetrieve, memuMemorize } from '../services/memu';
import { browseUrl, browseAction, browseSnapshot, browseClose } from '../services/browser';
import {
  createScheduledTask,
  listScheduledTasks,
  pauseScheduledTask,
  resumeScheduledTask,
  deleteScheduledTask,
} from '../services/scheduler';
import {
  createRemotionProject,
  listRemotionProjects,
  startRender,
  getRenderJob,
  checkRemotionHealth,
} from '../services/remotion';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export const agentRouter = Router();

// ── Configuration ─────────────────────────────────────────
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/workspace';
const MAX_ITERATIONS = 100;
const MAX_AGENT_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes — no artificial ceiling on complex tasks
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB per command
const MAX_COMMAND_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes per command (large builds, clones)

// ── Blocked file patterns (same as code.ts) ───────────────
const BLOCKED_PATTERNS = [
  /\.env$/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /credentials\.json$/i,
  /\.secret$/i,
];

function isBlockedPath(filePath: string): boolean {
  return BLOCKED_PATTERNS.some(pattern => pattern.test(filePath));
}

// ── Path Sandboxing (same as code.ts) ─────────────────────
function safePath(userPath: string): string {
  const resolved = path.resolve(WORKSPACE_ROOT, userPath.replace(/^\/+/, ''));
  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    throw new Error(`Path escapes workspace sandbox: ${userPath}`);
  }
  return resolved;
}

// ── Command Allowlist (same as code.ts) ───────────────────
const ALLOWED_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'sort', 'uniq', 'grep', 'find', 'tree',
  'node', 'npm', 'npx', 'yarn', 'pnpm', 'bun',
  'python', 'python3', 'pip', 'pip3',
  'cargo', 'rustc', 'go',
  'make', 'cmake',
  'git', 'curl', 'wget',
  'docker', 'docker-compose',
  'tsc', 'tsx', 'eslint', 'prettier',
  'jest', 'vitest', 'mocha', 'pytest',
  'echo', 'date', 'whoami', 'pwd', 'du', 'df',
  'tar', 'zip', 'unzip', 'gzip', 'gunzip',
  'sed', 'awk', 'cut', 'tr', 'xargs',
  'mkdir', 'touch', 'cp', 'mv', 'rm',
  'agent-browser',
]);

const DANGEROUS_PATTERNS = [
  /rm\s+(-rf?|--recursive)\s+\//,
  />\s*\/dev\/sd/,
  /mkfs/,
  /dd\s+if=/,
  /:(){ :|:& };:/,
];

// ── Expensive Service Detection ───────────────────────────
const EXPENSIVE_SERVICES = new Set(['manus', 'heygen', 'kling', 'runway']);
const MODERATE_COST_SERVICES = new Set(['elevenlabs']);

function detectExpensiveServiceUsage(toolName: string, input: any): string | null {
  // Check run_terminal_command for curl calls to expensive services
  if (toolName === 'run_terminal_command' && input.command) {
    const cmd = input.command.toLowerCase();
    for (const service of EXPENSIVE_SERVICES) {
      if (cmd.includes(`vault/key/${service}`) || cmd.includes(service)) {
        const name = service.charAt(0).toUpperCase() + service.slice(1);
        return `HIGH_COST:${name}`;
      }
    }
    for (const service of MODERATE_COST_SERVICES) {
      if (cmd.includes(`vault/key/${service}`) || cmd.includes(service)) {
        const name = service.charAt(0).toUpperCase() + service.slice(1);
        return `MODERATE_COST:${name}`;
      }
    }
  }
  return null;
}

// ── Ensure audit log table ────────────────────────────────
let auditTableMigrated = false;

async function ensureAuditTable(): Promise<void> {
  if (auditTableMigrated) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS agent_audit_log (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        conversation_id TEXT,
        tool_name TEXT NOT NULL,
        tool_input JSONB NOT NULL,
        tool_output JSONB,
        status TEXT NOT NULL DEFAULT 'running',
        duration_ms INT,
        iteration INT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    auditTableMigrated = true;
  } catch {
    // DB might be down — continue without audit logging
  }
}

// ── Tool Definitions (OpenAI format for LiteLLM) ─────────

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: 'run_terminal_command',
        description: 'Execute a terminal command in the workspace. Sandboxed to the workspace directory. Allowed commands include: ls, cat, grep, find, node, npm, npx, python, pip, git, curl, docker, tsc, eslint, prettier, jest, mkdir, touch, cp, mv, rm, and more. Dangerous operations like rm -rf / are blocked.',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The shell command to execute',
            },
            cwd: {
              type: 'string',
              description: 'Working directory relative to workspace root (optional)',
            },
          },
          required: ['command'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the contents of a file in the workspace. Returns the file content as text. Max file size: 5MB.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'File path relative to workspace root',
            },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a file. Creates parent directories if needed. Cannot write to .env, .pem, .key, SSH keys, or credentials files.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'File path relative to workspace root',
            },
            content: {
              type: 'string',
              description: 'The content to write to the file',
            },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_directory',
        description: 'List files and directories at a given path. Returns names, types, and whether each entry is a git repository.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Directory path relative to workspace root (empty string for root)',
            },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_files',
        description: 'Search for files by name or by content (like grep). Returns matching file paths.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query — filename pattern or content to search for',
            },
            type: {
              type: 'string',
              enum: ['filename', 'content'],
              description: 'Search by filename or by file content',
            },
            path: {
              type: 'string',
              description: 'Directory to search in (relative to workspace root, optional)',
            },
          },
          required: ['query', 'type'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'git_clone',
        description: 'Clone a git repository into the workspace. Uses SSH keys if available.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Repository URL (HTTPS or SSH)',
            },
            name: {
              type: 'string',
              description: 'Target directory name (optional — defaults to repo name)',
            },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'git_status',
        description: 'Get the git status of a project — branch, modified files, staged changes.',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project directory relative to workspace root',
            },
          },
          required: ['project'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'git_commit_and_push',
        description: 'Stage all changes, commit with a message, and optionally push to remote.',
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project directory relative to workspace root',
            },
            message: {
              type: 'string',
              description: 'Commit message',
            },
            push: {
              type: 'boolean',
              description: 'Whether to push after committing (default: false)',
            },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific files to stage (optional — stages all if not specified)',
            },
          },
          required: ['project', 'message'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'rag_search',
        description: 'Search the knowledge base (AnythingLLM) using RAG. Queries embedded documents and returns relevant answers with source citations. Use this when the user asks about documents, uploaded files, or stored knowledge.',
        parameters: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'The question to search the knowledge base for',
            },
            workspace: {
              type: 'string',
              description: 'Workspace slug to search in (optional — defaults to "sovereign")',
            },
            mode: {
              type: 'string',
              enum: ['query', 'chat'],
              description: 'Search mode: "query" for document-only answers, "chat" for conversational with history (default: "query")',
            },
          },
          required: ['question'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_search',
        description: 'Search long-term semantic memory for prior context, decisions, learnings, and past interactions. Use this BEFORE starting non-trivial tasks to check for relevant prior context. Returns the most relevant memories ranked by similarity.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'What to search for in memory (natural language question or topic)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of memories to return (default: 5, max: 20)',
            },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_save',
        description: 'Save important information to long-term semantic memory. Use this to store key decisions, project context, user preferences, learnings, and milestone summaries. Memories persist across conversations and are searchable.',
        parameters: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The information to memorize (be specific and include context)',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional tags to categorize the memory (e.g., ["project:myapp", "decision", "architecture"])',
            },
          },
          required: ['content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_browse',
        description: 'Browse the web — open URLs, interact with pages, fill forms, click buttons, take screenshots, and extract data. Uses a real Chromium browser. Start by opening a URL, then use snapshot to see interactive elements (labeled with @e1, @e2, etc.), then use actions to interact.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['open', 'snapshot', 'click', 'fill', 'type', 'screenshot', 'scroll', 'get', 'wait', 'close'],
              description: 'The browser action to perform. "open" navigates to a URL. "snapshot" shows page state and interactive elements. "click" clicks an element. "fill" fills a form field. "type" types text. "screenshot" captures the page. "scroll" scrolls the page. "get" gets an element attribute. "wait" waits for an element. "close" ends the session.',
            },
            url: {
              type: 'string',
              description: 'URL to navigate to (required for "open" action)',
            },
            target: {
              type: 'string',
              description: 'Element reference (e.g., @e1, @e2) or CSS selector for actions that target an element (click, fill, type, get, wait)',
            },
            value: {
              type: 'string',
              description: 'Text to fill/type, scroll direction ("up"/"down"), or attribute name for "get"',
            },
            options: {
              type: 'object',
              properties: {
                interactive: {
                  type: 'boolean',
                  description: 'For snapshot: show interactive element labels (@e1, @e2, etc.)',
                },
                full: {
                  type: 'boolean',
                  description: 'For screenshot: capture full page instead of viewport',
                },
              },
              description: 'Optional flags for the action',
            },
          },
          required: ['action'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'schedule_task',
        description: 'Create, list, or manage scheduled tasks. Tasks run automatically at specified times using cron expressions, intervals, or one-time schedules. Each task sends a message to the agent when triggered.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['create', 'list', 'pause', 'resume', 'delete'],
              description: 'What to do with scheduled tasks',
            },
            name: { type: 'string', description: 'Task name (for create)' },
            message: { type: 'string', description: 'The message/instruction to execute when the task fires (for create)' },
            schedule_type: { type: 'string', enum: ['cron', 'interval', 'once'], description: 'Schedule type (for create)' },
            schedule_value: { type: 'string', description: 'Cron expression (e.g., "0 9 * * *"), interval in ms (e.g., "3600000"), or ISO datetime for once (e.g., "2025-01-15T09:00:00")' },
            task_id: { type: 'string', description: 'Task ID (for pause/resume/delete)' },
            max_runs: { type: 'number', description: 'Max times to run (optional, for create)' },
          },
          required: ['action'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'generate_video',
        description: 'Create motion graphics and animated videos using Remotion. You can create projects with compositions, customize them with props, and render to MP4/WebM/GIF. Available compositions: TextReveal (animated text), Counter (animated counter). You can also write custom compositions using React.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['create_project', 'list_projects', 'render', 'check_status', 'get_job'],
              description: 'Action to perform',
            },
            name: { type: 'string', description: 'Project name (for create_project)' },
            project_id: { type: 'string', description: 'Project ID (for render)' },
            composition: { type: 'string', description: 'Composition name to render (for render)' },
            props: { type: 'object', description: 'Props to pass to the composition (for render)' },
            output_format: {
              type: 'string',
              enum: ['mp4', 'webm', 'gif'],
              description: 'Output format (for render, default: mp4)',
            },
            job_id: { type: 'string', description: 'Render job ID (for get_job)' },
          },
          required: ['action'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delegate_to_fleet',
        description: 'Delegate a task to a fleet agent. Use this when a task would benefit from a specialist agent, when you are handling multiple requests and want to parallelize, or when the user asks you to assign work. Checks available fleet agents and submits the task as a background job. You can optionally specify which agent or template to use.',
        parameters: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'The task or message to send to the fleet agent. Be specific and include all necessary context.',
            },
            agent_id: {
              type: 'string',
              description: 'Specific fleet agent ID to assign to (optional — auto-selects if omitted)',
            },
            template: {
              type: 'string',
              enum: ['code_assistant', 'researcher', 'writer', 'analyst', 'devops'],
              description: 'Preferred agent template/specialty. If no agent of this type exists, one will be created.',
            },
            wait_for_result: {
              type: 'boolean',
              description: 'If true, polls until the job completes and returns the result (default: false — returns immediately with job ID)',
            },
          },
          required: ['task'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'scaffold_project',
        description: 'Create a new project from a template. Available templates: react-vite-ts (React + Vite + TypeScript), express-api (Express + TypeScript), static-site (HTML/CSS/JS), blank (empty project). Creates the project directory in the workspace, writes all template files, and runs npm install if applicable.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Project name (e.g., "my-awesome-app")' },
            template: { type: 'string', enum: ['react-vite-ts', 'express-api', 'static-site', 'blank'], description: 'Template to use' },
            description: { type: 'string', description: 'Optional project description' },
          },
          required: ['name', 'template'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'validate_build',
        description: 'Run build validation on a project. Auto-detects the project type (Node/TS, Rust, Python, Docker, etc.) and runs appropriate validation steps (type-checking, building, testing). Enforces BUILD RULES B5 (verify every change) and B6 (tiered verification). Always run this after making code changes.',
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Project directory relative to workspace root' },
            changed_files: { type: 'number', description: 'Number of files changed (determines validation tier: 1-2=small, 3-5=medium, 6+=large)' },
          },
          required: ['project'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'deploy_project',
        description: 'Deploy a project. Currently supports local preview (serves the built files on an available port). More deployment targets coming soon.',
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Project directory relative to workspace root' },
            target: { type: 'string', enum: ['local', 'docker', 'static'], description: 'Deployment target (default: local)' },
          },
          required: ['project'],
        },
      },
    },
  ];
}

// ── Tool Executors ────────────────────────────────────────

async function executeRunTerminalCommand(input: { command: string; cwd?: string }): Promise<any> {
  const baseCommand = input.command.trim().split(/\s+/)[0];
  if (!ALLOWED_COMMANDS.has(baseCommand)) {
    return { error: `Command '${baseCommand}' is not allowed. Permitted: ${Array.from(ALLOWED_COMMANDS).sort().join(', ')}` };
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(input.command)) {
      return { error: 'Dangerous command pattern detected and blocked.' };
    }
  }

  const cwd = input.cwd ? safePath(input.cwd) : WORKSPACE_ROOT;

  try {
    const { stdout, stderr } = await execAsync(input.command, {
      cwd,
      maxBuffer: MAX_OUTPUT_SIZE,
      timeout: MAX_COMMAND_TIMEOUT_MS,
      env: {
        ...process.env,
        HOME: process.env.HOME || '/root',
        PATH: process.env.PATH,
      },
    });
    return { stdout: stdout.slice(0, 10000), stderr: stderr.slice(0, 2000), exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: (err.stdout || '').slice(0, 10000),
      stderr: (err.stderr || err.message || '').slice(0, 2000),
      exitCode: err.code || 1,
    };
  }
}

async function executeReadFile(input: { path: string }): Promise<any> {
  try {
    const resolved = safePath(input.path);
    const stat = await fs.stat(resolved);

    if (stat.isDirectory()) {
      return { error: `'${input.path}' is a directory, not a file. Use list_directory instead.` };
    }

    if (stat.size > 5 * 1024 * 1024) {
      return { error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB > 5MB limit)` };
    }

    const content = await fs.readFile(resolved, 'utf-8');
    return {
      content: content.slice(0, 50000), // Cap at 50K chars for context window sanity
      size: stat.size,
      extension: path.extname(resolved).slice(1),
    };
  } catch (err: any) {
    if (err.code === 'ENOENT') return { error: `File not found: ${input.path}` };
    return { error: err.message };
  }
}

async function executeWriteFile(input: { path: string; content: string }): Promise<any> {
  if (!input.path) {
    return { error: 'Missing required parameter: path' };
  }
  if (input.content === undefined || input.content === null) {
    return { error: 'Missing required parameter: content. The file content was likely truncated due to output length limits. Try writing the file in smaller sections or use run_terminal_command with heredoc instead.' };
  }
  if (isBlockedPath(input.path)) {
    return { error: 'Cannot write to sensitive files (.env, .pem, .key, SSH keys, credentials)' };
  }

  try {
    const resolved = safePath(input.path);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, input.content, 'utf-8');
    return { success: true, path: input.path, bytes_written: Buffer.byteLength(input.content) };
  } catch (err: any) {
    return { error: err.message };
  }
}

async function executeListDirectory(input: { path: string }): Promise<any> {
  try {
    const resolved = safePath(input.path || '');
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const items = entries
      .filter(e => !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    return { path: input.path || '/', items, count: items.length };
  } catch (err: any) {
    if (err.code === 'ENOENT') return { error: `Directory not found: ${input.path}` };
    return { error: err.message };
  }
}

async function executeSearchFiles(input: { query: string; type: string; path?: string }): Promise<any> {
  const cwd = safePath(input.path || '');

  try {
    if (input.type === 'content') {
      const { stdout } = await execAsync(
        `grep -rn --include="*.{ts,tsx,js,jsx,py,rs,go,java,c,cpp,h,css,html,json,yaml,yml,toml,md,txt}" -l "${input.query.replace(/"/g, '\\"')}" .`,
        { cwd, maxBuffer: MAX_OUTPUT_SIZE, timeout: 60000 }
      );
      const files = stdout.trim().split('\n').filter(Boolean).map(f => f.replace(/^\.\//, ''));
      return { results: files.slice(0, 50), count: files.length };
    } else {
      const { stdout } = await execAsync(
        `find . -name "*${input.query.replace(/"/g, '\\"')}*" -not -path "*/node_modules/*" -not -path "*/.git/*" | head -50`,
        { cwd, maxBuffer: MAX_OUTPUT_SIZE, timeout: 60000 }
      );
      const files = stdout.trim().split('\n').filter(Boolean).map(f => f.replace(/^\.\//, ''));
      return { results: files, count: files.length };
    }
  } catch {
    return { results: [], count: 0 };
  }
}

async function executeGitClone(input: { url: string; name?: string }): Promise<any> {
  const targetName = input.name || input.url.split('/').pop()?.replace('.git', '') || 'repo';
  const targetPath = path.join(WORKSPACE_ROOT, targetName);

  try {
    await fs.access(targetPath);
    return { error: `Directory '${targetName}' already exists in workspace` };
  } catch { /* good — doesn't exist */ }

  try {
    const { stdout, stderr } = await execFileAsync('git', ['clone', input.url, targetPath], {
      maxBuffer: MAX_OUTPUT_SIZE,
      timeout: 120000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return { success: true, name: targetName, output: (stdout || stderr || '').slice(0, 2000) };
  } catch (err: any) {
    return { error: `Clone failed: ${err.stderr || err.message}` };
  }
}

async function executeGitStatus(input: { project: string }): Promise<any> {
  const cwd = safePath(input.project);
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-b'], {
      cwd, maxBuffer: MAX_OUTPUT_SIZE, timeout: 10000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const lines = stdout.trim().split('\n');
    const branchLine = lines[0] || '';
    const branchMatch = branchLine.match(/^## (.+?)(?:\.\.\.(.+))?$/);
    const branch = branchMatch ? branchMatch[1] : 'unknown';

    const files = lines.slice(1).filter(Boolean).map(line => ({
      status: line.substring(0, 2).trim(),
      path: line.substring(3),
    }));
    return { branch, files, clean: files.length === 0 };
  } catch (err: any) {
    return { error: err.message };
  }
}

async function executeGitCommitAndPush(input: {
  project: string; message: string; push?: boolean; files?: string[];
}): Promise<any> {
  const cwd = safePath(input.project);
  const gitOpts = {
    cwd, maxBuffer: MAX_OUTPUT_SIZE, timeout: 120000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  };

  try {
    // Stage
    const stageArgs = ['add'];
    if (input.files && input.files.length > 0) {
      stageArgs.push('--', ...input.files);
    } else {
      stageArgs.push('-A');
    }
    await execFileAsync('git', stageArgs, gitOpts);

    // Commit
    const { stdout: commitOut } = await execFileAsync('git', ['commit', '-m', input.message], gitOpts);

    let pushOutput = '';
    if (input.push) {
      const { stdout, stderr } = await execFileAsync('git', ['push'], {
        ...gitOpts,
        timeout: 60000,
      });
      pushOutput = stdout || stderr || '';
    }

    return {
      success: true,
      commit_output: commitOut.slice(0, 2000),
      push_output: pushOutput.slice(0, 2000),
      pushed: !!input.push,
    };
  } catch (err: any) {
    return { error: err.stderr || err.message };
  }
}

async function executeRAGSearch(input: { question: string; workspace?: string; mode?: 'query' | 'chat' }): Promise<any> {
  try {
    const slug = input.workspace || await ensureDefaultWorkspace();
    const mode = input.mode || 'query';
    const result = await queryWorkspace(slug, input.question, mode);

    if (result.error) {
      return { error: result.error };
    }

    return {
      answer: result.answer,
      sources: result.sources.map(s => ({
        title: s.title,
        excerpt: s.text.slice(0, 500),
        score: s.score,
      })),
      source_count: result.sources.length,
      workspace: slug,
    };
  } catch (err: any) {
    return { error: `RAG search failed: ${err.message}` };
  }
}

async function executeMemorySearch(input: { query: string; limit?: number }): Promise<any> {
  try {
    const limit = Math.min(Math.max(input.limit || 5, 1), 20);
    const results = await memuRetrieve(input.query, limit);

    if (results.length === 0) {
      return { results: [], count: 0, message: 'No relevant memories found.' };
    }

    return {
      results: results.map((r: any) => ({
        content: r.content || r.text || '',
        similarity: r.similarity || r.score || null,
        timestamp: r.created_at || r.timestamp || null,
      })),
      count: results.length,
    };
  } catch (err: any) {
    return { error: `Memory search failed: ${err.message}` };
  }
}

async function executeMemorySave(input: { content: string; tags?: string[] }): Promise<any> {
  try {
    const tagPrefix = input.tags && input.tags.length > 0
      ? `[${input.tags.join(', ')}] `
      : '';
    const fullContent = `${tagPrefix}${input.content}`;

    await memuMemorize(fullContent);

    return {
      success: true,
      message: 'Memory saved successfully.',
      content_length: fullContent.length,
      tags: input.tags || [],
    };
  } catch (err: any) {
    return { error: `Memory save failed: ${err.message}` };
  }
}

async function executeWebBrowse(input: {
  action: string;
  url?: string;
  target?: string;
  value?: string;
  options?: { interactive?: boolean; full?: boolean };
}): Promise<any> {
  try {
    switch (input.action) {
      case 'open': {
        if (!input.url) {
          return { error: 'The "open" action requires a "url" parameter.' };
        }
        const result = await browseUrl(input.url);
        if (result.error) return { error: result.error };
        return { output: result.output.slice(0, 30000) };
      }

      case 'snapshot': {
        const result = await browseSnapshot({
          interactive: input.options?.interactive ?? true,
        });
        if (result.error) return { error: result.error };
        return { output: result.output.slice(0, 30000) };
      }

      case 'click': {
        if (!input.target) {
          return { error: 'The "click" action requires a "target" parameter (e.g., @e1 or a CSS selector).' };
        }
        const result = await browseAction('click', [input.target]);
        if (result.error) return { error: result.error };
        return { output: result.output.slice(0, 30000) };
      }

      case 'fill': {
        if (!input.target || input.value === undefined) {
          return { error: 'The "fill" action requires both "target" and "value" parameters.' };
        }
        const result = await browseAction('fill', [input.target, input.value]);
        if (result.error) return { error: result.error };
        return { output: result.output.slice(0, 30000) };
      }

      case 'type': {
        if (!input.value) {
          return { error: 'The "type" action requires a "value" parameter (text to type).' };
        }
        const args = input.target ? [input.target, input.value] : [input.value];
        const result = await browseAction('type', args);
        if (result.error) return { error: result.error };
        return { output: result.output.slice(0, 30000) };
      }

      case 'screenshot': {
        const args: string[] = [];
        if (input.options?.full) {
          args.push('--full');
        }
        const result = await browseAction('screenshot', args);
        if (result.error) return { error: result.error };
        return { output: result.output.slice(0, 30000) };
      }

      case 'scroll': {
        const direction = input.value || 'down';
        const args = input.target ? [input.target, direction] : [direction];
        const result = await browseAction('scroll', args);
        if (result.error) return { error: result.error };
        return { output: result.output.slice(0, 30000) };
      }

      case 'get': {
        if (!input.target) {
          return { error: 'The "get" action requires a "target" parameter.' };
        }
        const args = [input.target];
        if (input.value) args.push(input.value);
        const result = await browseAction('get', args);
        if (result.error) return { error: result.error };
        return { output: result.output.slice(0, 30000) };
      }

      case 'wait': {
        if (!input.target) {
          return { error: 'The "wait" action requires a "target" parameter (element or selector to wait for).' };
        }
        const result = await browseAction('wait', [input.target]);
        if (result.error) return { error: result.error };
        return { output: result.output.slice(0, 30000) };
      }

      case 'close': {
        const result = await browseClose();
        if (result.error) return { error: result.error };
        return { output: result.output };
      }

      default:
        return { error: `Unknown browser action: "${input.action}". Valid actions: open, snapshot, click, fill, type, screenshot, scroll, get, wait, close` };
    }
  } catch (err: any) {
    return { error: `Web browse failed: ${err.message}` };
  }
}

async function executeScheduleTask(input: {
  action: string;
  name?: string;
  message?: string;
  schedule_type?: 'cron' | 'interval' | 'once';
  schedule_value?: string;
  task_id?: string;
  max_runs?: number;
}): Promise<any> {
  try {
    switch (input.action) {
      case 'create': {
        if (!input.name || !input.message || !input.schedule_type || !input.schedule_value) {
          return { error: 'create requires: name, message, schedule_type, schedule_value' };
        }
        const task = await createScheduledTask({
          name: input.name,
          message: input.message,
          schedule_type: input.schedule_type,
          schedule_value: input.schedule_value,
          max_runs: input.max_runs,
        });
        return { success: true, task };
      }

      case 'list': {
        const tasks = await listScheduledTasks();
        return { tasks, count: tasks.length };
      }

      case 'pause': {
        if (!input.task_id) {
          return { error: 'pause requires: task_id' };
        }
        const task = await pauseScheduledTask(input.task_id);
        if (!task) return { error: 'Task not found' };
        return { success: true, task };
      }

      case 'resume': {
        if (!input.task_id) {
          return { error: 'resume requires: task_id' };
        }
        const task = await resumeScheduledTask(input.task_id);
        if (!task) return { error: 'Task not found' };
        return { success: true, task };
      }

      case 'delete': {
        if (!input.task_id) {
          return { error: 'delete requires: task_id' };
        }
        const deleted = await deleteScheduledTask(input.task_id);
        if (!deleted) return { error: 'Task not found' };
        return { success: true };
      }

      default:
        return { error: `Unknown schedule action: "${input.action}". Valid: create, list, pause, resume, delete` };
    }
  } catch (err: any) {
    return { error: `Schedule task failed: ${err.message}` };
  }
}

async function executeGenerateVideo(input: {
  action: string;
  name?: string;
  project_id?: string;
  composition?: string;
  props?: Record<string, any>;
  output_format?: 'mp4' | 'webm' | 'gif';
  job_id?: string;
}): Promise<any> {
  try {
    switch (input.action) {
      case 'create_project': {
        if (!input.name) {
          return { error: 'create_project requires: name' };
        }
        const project = await createRemotionProject(input.name);
        return { success: true, project };
      }

      case 'list_projects': {
        const projects = await listRemotionProjects();
        return { projects, count: projects.length };
      }

      case 'render': {
        if (!input.project_id || !input.composition) {
          return { error: 'render requires: project_id, composition' };
        }
        const job = await startRender({
          projectId: input.project_id,
          composition: input.composition,
          props: input.props,
          outputFormat: input.output_format,
        });
        return { success: true, job };
      }

      case 'check_status': {
        const health = await checkRemotionHealth();
        return health;
      }

      case 'get_job': {
        if (!input.job_id) {
          return { error: 'get_job requires: job_id' };
        }
        const job = await getRenderJob(input.job_id);
        if (!job) return { error: 'Render job not found' };
        return job;
      }

      default:
        return { error: `Unknown generate_video action: "${input.action}". Valid: create_project, list_projects, render, check_status, get_job` };
    }
  } catch (err: any) {
    return { error: `generate_video failed: ${err.message}` };
  }
}

// ── Fleet Delegation ──────────────────────────────────────

async function executeDelegateToFleet(input: {
  task: string;
  agent_id?: string;
  template?: string;
  wait_for_result?: boolean;
}): Promise<any> {
  try {
    // Step 1: Find or create a suitable fleet agent
    let agentId = input.agent_id;

    if (!agentId) {
      // Look for a running agent, preferring the requested template
      const agents = await query(
        `SELECT id, name, template, status FROM fleet_agents
         WHERE status = 'running'
         ORDER BY
           CASE WHEN template = $1 THEN 0 ELSE 1 END,
           created_at DESC
         LIMIT 1`,
        [input.template || 'code_assistant']
      );

      if (agents.rows.length > 0) {
        agentId = agents.rows[0].id;
        logActivity('agent', 'info', `Delegating to fleet agent "${agents.rows[0].name}" (${agents.rows[0].template})`);
      } else {
        // No running agent found — create one from template
        const template = input.template || 'code_assistant';
        const createResult = await query(
          `INSERT INTO fleet_agents (name, template, status, model, system_prompt, icon)
           VALUES ($1, $2, 'running', 'coder', $3, $4)
           RETURNING id, name`,
          [
            `Auto-${template}`,
            template,
            `You are a ${template} agent. Complete the tasks assigned to you efficiently and report back with results.`,
            template === 'researcher' ? '🔍' :
            template === 'writer' ? '✍️' :
            template === 'analyst' ? '📊' :
            template === 'devops' ? '🔧' : '👨‍💻',
          ]
        );
        agentId = createResult.rows[0].id;
        logActivity('agent', 'info', `Created fleet agent "${createResult.rows[0].name}" for delegation`);
      }
    }

    // Step 2: Submit the task
    if (!agentId) {
      return { error: 'No fleet agent available and could not create one' };
    }
    const job = await enqueueTask(agentId, `fleet-${agentId}`, input.task);

    logActivity('agent', 'info', `Task delegated → job ${job.id}`);

    // Step 3: Optionally wait for result
    if (input.wait_for_result) {
      const maxWait = 120000; // 2 minutes max
      const pollInterval = 2000;
      let elapsed = 0;

      while (elapsed < maxWait) {
        await new Promise(r => setTimeout(r, pollInterval));
        elapsed += pollInterval;

        const status = await getJob(job.id);
        if (!status) break;

        if (status.status === 'completed') {
          return {
            success: true,
            delegated_to: agentId,
            job_id: job.id,
            status: 'completed',
            result: status.result,
          };
        }

        if (status.status === 'failed') {
          return {
            success: false,
            delegated_to: agentId,
            job_id: job.id,
            status: 'failed',
            error: status.error || 'Task failed',
          };
        }
      }

      return {
        success: true,
        delegated_to: agentId,
        job_id: job.id,
        status: 'still_running',
        message: `Task is still running after ${maxWait / 1000}s. Check job status with the job ID.`,
      };
    }

    // Return immediately with job info
    return {
      success: true,
      delegated_to: agentId,
      job_id: job.id,
      status: 'queued',
      message: 'Task has been delegated to a fleet agent. It will run in the background.',
    };
  } catch (err: any) {
    return { error: `Fleet delegation failed: ${err.message}` };
  }
}

// ── Scaffold / Validate / Deploy Executors ────────────────

async function executeScaffoldProject(input: { name: string; template: string; description?: string }): Promise<any> {
  try {
    const { scaffoldProject } = await import('../services/scaffolder');
    const targetPath = path.join(WORKSPACE_ROOT, input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    const result = await scaffoldProject(input.template, input.name, targetPath);
    return result;
  } catch (err: any) {
    return { error: err.message };
  }
}

async function executeValidateBuild(input: { project: string; changed_files?: number }): Promise<any> {
  try {
    const { runValidation } = await import('../services/build-validator');
    const projectPath = safePath(input.project);
    const report = await runValidation(projectPath, input.changed_files);
    return report;
  } catch (err: any) {
    return { error: err.message };
  }
}

async function executeDeployProject(input: { project: string; target?: string }): Promise<any> {
  try {
    const projectPath = safePath(input.project);

    // Run build guard before deploying
    try {
      const { runBuildGuard } = await import('../services/build-guard');
      const guardReport = await runBuildGuard(projectPath);

      if (!guardReport.allowed) {
        return {
          error: `Deployment blocked by build guard: ${guardReport.summary}`,
          guard_report: {
            tier: guardReport.classification.tier,
            failed_checks: guardReport.checksRun.filter(c => !c.passed).map(c => ({
              name: c.name,
              output: c.output?.slice(0, 500),
            })),
          },
          suggestion: 'Fix the failing checks and try again. Use validate_build to see detailed errors.',
        };
      }
    } catch (guardErr: any) {
      // Build guard failed to run — log but don't block
      logActivity('build-guard', 'warning', `Build guard check failed: ${guardErr.message}. Proceeding with deploy.`);
    }

    const { deploy } = await import('../services/deployer');
    const result = await deploy(projectPath, input.target as any);
    return result;
  } catch (err: any) {
    return { error: err.message };
  }
}

// ── Tool Dispatcher ───────────────────────────────────────

async function executeTool(name: string, input: any): Promise<any> {
  switch (name) {
    case 'run_terminal_command': return executeRunTerminalCommand(input);
    case 'read_file': return executeReadFile(input);
    case 'write_file': return executeWriteFile(input);
    case 'list_directory': return executeListDirectory(input);
    case 'search_files': return executeSearchFiles(input);
    case 'git_clone': return executeGitClone(input);
    case 'git_status': return executeGitStatus(input);
    case 'git_commit_and_push': return executeGitCommitAndPush(input);
    case 'rag_search': return executeRAGSearch(input);
    case 'memory_search': return executeMemorySearch(input);
    case 'memory_save': return executeMemorySave(input);
    case 'web_browse': return executeWebBrowse(input);
    case 'schedule_task': return executeScheduleTask(input);
    case 'generate_video': return executeGenerateVideo(input);
    case 'delegate_to_fleet': return executeDelegateToFleet(input);
    case 'scaffold_project': return executeScaffoldProject(input);
    case 'validate_build': return executeValidateBuild(input);
    case 'deploy_project': return executeDeployProject(input);
    default: return { error: `Unknown tool: ${name}` };
  }
}

// ── SSE Helper ────────────────────────────────────────────

function sendSSE(res: Response, data: any): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  if (typeof (res as any).flush === 'function') {
    (res as any).flush();
  }
}

// ── System Prompt ─────────────────────────────────────────

const AGENT_SYSTEM_PROMPT = `You are a powerful AI agent running inside the Sovereign Stack desktop application. You have direct access to the user's workspace and can execute real actions using the tools provided.

CORE CAPABILITIES:
- Execute terminal commands (npm, git, python, node, docker, curl, wget, etc.)
- Read and write files in the workspace
- Search through codebases by filename or content
- Clone git repositories
- Check git status, commit changes, and push
- Search the knowledge base (AnythingLLM RAG) for answers from uploaded documents
- Search and save long-term semantic memory (memU) for persistent context across conversations
- Browse the web with a real Chromium browser — open URLs, click elements, fill forms, take screenshots, and extract data using the web_browse tool
- Generate motion graphics and animated videos using Remotion — create projects, customize compositions with props, and render to MP4/WebM/GIF
- Scaffold new projects from templates using scaffold_project — React+Vite, Express API, static sites, or blank projects
- Validate builds using validate_build — auto-detects project type and runs type-checking, building, and testing
- Deploy projects using deploy_project — serve locally, build Docker containers, or export static files

EXTENDED CAPABILITIES — Self-Extension:
You can extend yourself far beyond your built-in tools. You are NOT limited to file operations and git.

- WEB ACCESS: Use curl to fetch any URL, API endpoint, or web page content.
    Example: run_terminal_command({ command: "curl -s https://api.example.com/data" })
- WEB SEARCH: Fetch a Brave Search key from the vault, then search the web:
    run_terminal_command({ command: "curl -s http://localhost:3100/api/settings/vault/key/brave_search" })
    Then use the key with: curl -s "https://api.search.brave.com/res/v1/web/search?q=QUERY" -H "X-Subscription-Token: KEY"
- VOICE & MEDIA: Write Node.js scripts to call ElevenLabs, Runway, HeyGen, DeepGram APIs.
- INSTALL PACKAGES: Run "npm install <package>" to add any Node.js capability (axios, playwright, cheerio, etc.)
- PYTHON: Write and execute Python scripts for data analysis, scraping, ML, etc.
- ARBITRARY SCRIPTS: Write a .js or .py file, then execute it. You can build any tool you need on the fly.

API KEY VAULT:
When you need an API key for an external service, fetch it from the encrypted key vault:
  curl -s http://localhost:3100/api/settings/vault/key/SERVICE_ID
This returns JSON: { "keyId": "...", "value": "the-actual-key" }
Extract just the value: curl -s http://localhost:3100/api/settings/vault/key/SERVICE_ID | node -e "process.stdin.on('data',d=>process.stdout.write(JSON.parse(d).value))"

Available service IDs: anthropic, openai, gemini, grok, manus, elevenlabs, runway, heygen, deepgram, kling, slack_bot, slack_app, slack_signing, brave_search, x_api, anythingllm, litellm_master

To check which keys the user has configured (without seeing values):
  curl -s http://localhost:3100/api/settings/vault/available

IMPORTANT: Never expose API key values to the user. Never log them. Never write them to files. Only use them transiently in curl/script API calls.

COST AWARENESS — Expensive Services:
Some services have significant per-use costs. ALWAYS confirm with the user before using these:

HIGH COST (always confirm):
- Manus (manus) — $$$: Complex agent tasks, can run up large bills quickly
- HeyGen (heygen) — $$: Avatar video generation, ~$1-5 per video
- Kling (kling) — $$: AI video generation, significant per-video cost
- Runway (runway) — $$: AI video generation, credit-based pricing

MODERATE COST (mention the cost, proceed if user seems intentional):
- ElevenLabs (elevenlabs) — $: Voice generation, per-character pricing
- Brave Search (brave_search) — $: Per-query pricing, fine for occasional use

FREE / LOW COST (no confirmation needed):
- Anthropic, OpenAI, Gemini, Grok — already routed through LiteLLM with cost controls
- Slack, X/Twitter — typically free tier API calls
- DeepGram — low per-minute pricing

When you detect that a task will use a HIGH COST service:
1. Tell the user which service you plan to use
2. Explain what it will do and approximate cost range
3. Ask "Should I proceed?" before making the API call
4. NEVER auto-execute expensive service calls without confirmation

Example: "I'll use HeyGen to generate an avatar video of your script. This typically costs $2-5 per video. Should I proceed?"

KNOWLEDGE BASE (RAG):
Use the rag_search tool to query the knowledge base when:
- The user asks about documents, files, or knowledge they've uploaded
- You need background context, policies, procedures, or reference material
- The user asks "what do we know about X?" or "find info about X"
The knowledge base is powered by AnythingLLM. Documents must be uploaded and embedded first.
If rag_search returns no results, tell the user — don't make up answers.

SEMANTIC MEMORY (memU):
You have persistent long-term memory powered by memU. Use it wisely:
- RETRIEVE BEFORE PLANNING: At the start of any non-trivial task, use memory_search to check for prior context, decisions, and learnings about the topic.
- MEMORIZE AT MILESTONES: After completing significant work, use memory_save to store key decisions, progress, architecture choices, and learnings.
- MEMORIZE USER PREFERENCES: When the user tells you how they like things done, save it to memory so you remember next time.
- TAG YOUR MEMORIES: Use tags to categorize (e.g., ["project:myapp", "decision"], ["user-preference"], ["architecture"]).
Memory persists forever across conversations. Your future self will thank you for good notes.

CORE GUIDELINES:
1. When asked to DO something, use your tools — don't just describe the steps.
2. Before running a command, briefly explain what you're about to do.
3. After each tool call, check the output for errors before proceeding.
4. For multi-step tasks, work through them systematically.
5. If a command fails, diagnose the error and try an alternative approach.
6. Never modify .env files, SSH keys, or credentials directly — use the key vault API instead.
7. For git push operations, confirm the branch is correct first.
8. Keep explanations concise — focus on doing, not describing.
9. When reading large files, summarize the relevant parts.
10. If you need multiple commands, batch related operations efficiently.
11. If the user asks for something you don't have a built-in tool for, WRITE a script and execute it. You are not limited to the 8 tools listed below.

BUILD RULES (Non-Negotiable):
These rules exist because of real failures. Follow them exactly.

B1. NEVER call external APIs from browser JS — all API calls must go through a proxy, backend route, or HTTP abstraction layer. Never use AI SDKs (new Anthropic(), new OpenAI()) directly in browser code.

B2. Wire .env to the app, not just the file — creating a .env file is not enough. Verify the app actually READS those variables. If it uses a settings store (Zustand, Redux), confirm env vars are seeded as defaults.

B3. Every async action must have visible feedback — no "silent failures." Every button that triggers an async operation must: show a loading/spinner state, be disabled during the operation, show a toast on success, and show an error toast on failure. Never swallow errors with empty catch blocks.

B4. Never use mock data — show empty states with helpful messages, real error messages, loading/skeleton states, or disabled UI with tooltips. The user must always be able to distinguish "working" from "not connected."

B5. Verify every change before reporting done — after ANY code change, run the full build chain: tsc --noEmit + npm run build. For Docker projects, run the equivalent of verify-build.sh. Never say "fixed and done" without building first. Writing the fix is half the job — verifying it is the other half.

B6. Tiered verification based on change size:
  - Small (1-2 files): tsc + build + spot-check
  - Medium (3-5 files): + Docker build + launch guide + env wiring check + feedback audit
  - Large (6+ files or new systems): + full runtime test + no mock data audit
  Any new API endpoint or service = automatic Large tier.

B7. Test Docker builds if applicable — missing package-lock.json breaks npm ci in Docker even if npm install works locally. Type versions resolved in containers may differ from local.

B8. When deploying publicly (Vercel, etc.), warn that VITE_* keys are embedded in JS bundles. Use serverless functions instead.

B9. API Integration Preflight — before writing ANY code that calls a third-party API or SDK:
  a) Search the web for the provider's CURRENT developer documentation for the specific endpoint/method you plan to use. Never rely on training data for API parameters, auth methods, or SDK patterns.
  b) After installing any package, read its actual installed version from node_modules/[pkg]/package.json and verify your code matches that version's API, not the latest or your training data.
  c) Make a real test call to verify the response shape before wiring it into the app.
  d) Validate that the env var / API key is non-empty before reporting success.
  This rule exists because APIs change constantly — renamed parameters, deprecated endpoints, changed auth flows — and the model generates outdated patterns with full confidence.

B10. Port Reservation — these ports are reserved by Sovereign Stack and must NEVER be used for new projects:
  1420 (Tauri dev), 1421 (HMR), 3000 (web UI), 3100 (API), 4000 (LiteLLM), 5432 (PostgreSQL), 6379 (Redis), 8090 (memU), 11434 (Ollama), 18789 (NanoClaw), 3001 (AnythingLLM).
  When scaffolding new Tauri/Vite apps, use dev ports starting at 1425. When creating new backend services, use ports 5000-5999 or 8000-8999 (excluding reserved ones).

B11. ALWAYS validate after changes — after completing code changes on a project, call validate_build before reporting done. If validation fails, fix the errors and re-validate. Never skip this step.

WORKSPACE:
- Root: /workspace
- Projects are top-level directories under /workspace
- File paths are relative to workspace root`;

// ── Agent Loop Endpoint ───────────────────────────────────

agentRouter.post('/', async (req: Request, res: Response) => {
  const {
    message,
    conversation_id,
    model = 'coder',
    history = [],
    // Fleet Mode overrides
    system_prompt,
    workspace_root,
    // Overmind context injection (prepended to system prompt)
    system_prompt_prefix,
  } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  await ensureAuditTable();

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  const fleetAgentId = req.query.fleet_agent_id as string | undefined;
  const label = fleetAgentId ? `Fleet agent ${fleetAgentId}` : 'Agent';
  logActivity('agent', 'info', `${label} request: "${message.slice(0, 80)}..."`);

  const tools = getToolDefinitions();
  const startTime = Date.now();

  // Use fleet system prompt if provided, otherwise default
  const baseSystemPrompt = system_prompt || AGENT_SYSTEM_PROMPT;

  // Inject Overmind context prefix if provided (chat routed through Overmind)
  const prefixedPrompt = system_prompt_prefix
    ? `${system_prompt_prefix}\n\n---\n\n${baseSystemPrompt}`
    : baseSystemPrompt;

  // Inject live capability manifest into system prompt
  let effectiveSystemPrompt = prefixedPrompt;
  try {
    const capsSummary = await getCapabilitySummary();
    if (capsSummary && !capsSummary.includes('unavailable')) {
      effectiveSystemPrompt += `\n\n--- LIVE SYSTEM STATUS ---\n${capsSummary}\n--- END STATUS ---`;
    }
  } catch {
    // Capabilities check failed — continue with base prompt
  }

  // Build initial messages
  const messages: ChatMessage[] = [
    { role: 'system', content: effectiveSystemPrompt },
    ...history.slice(-20).map((m: any) => ({
      role: m.role === 'user' ? 'user' as const : 'assistant' as const,
      content: m.content,
    })),
    { role: 'user', content: message },
  ];

  let iteration = 0;

  try {
    while (iteration < MAX_ITERATIONS) {
      iteration++;

      // Check total timeout
      if (Date.now() - startTime > MAX_AGENT_TIMEOUT_MS) {
        sendSSE(res, { type: 'message', content: 'I reached the time limit (60 minutes). Here\'s where I got to — you can continue from here.' });
        break;
      }

      logActivity('agent', 'thinking', `Agent loop iteration ${iteration}/${MAX_ITERATIONS}`);
      sendSSE(res, { type: 'status', iteration, max_iterations: MAX_ITERATIONS });

      // Call LLM with tools
      const result = await chatCompletionWithTools({
        model,
        messages,
        tools,
        max_tokens: 16384,
        temperature: 0.5,
      });

      // Check if there are tool calls
      if (result.tool_calls && result.tool_calls.length > 0) {
        // There might also be text content before the tool calls
        if (result.content) {
          sendSSE(res, { type: 'thinking', content: result.content });
        }

        // Add assistant message with tool calls to conversation
        messages.push({
          role: 'assistant',
          content: result.content || '',
          tool_call_id: undefined, // assistant message doesn't have this
        } as any);

        // LiteLLM/OpenAI format: assistant message includes tool_calls
        const lastMsg = messages[messages.length - 1] as any;
        lastMsg.tool_calls = result.tool_calls;

        // Execute each tool call
        for (const toolCall of result.tool_calls) {
          let parsedInput: any;
          let parseError = false;
          try {
            parsedInput = JSON.parse(toolCall.function.arguments);
          } catch {
            parseError = true;
            parsedInput = { raw: toolCall.function.arguments };
          }

          const toolName = toolCall.function.name;
          sendSSE(res, { type: 'tool_call', id: toolCall.id, tool: toolName, input: parsedInput });

          const toolStart = Date.now();
          logActivity('agent', 'info', `Executing tool: ${toolName}`);

          let toolOutput: any;
          if (parseError) {
            toolOutput = { error: `Tool arguments were truncated or malformed (JSON parse failed). The output was too long. Try breaking the operation into smaller steps.` };
          } else {
            toolOutput = await executeTool(toolName, parsedInput);
          }
          const toolDuration = Date.now() - toolStart;

          sendSSE(res, {
            type: 'tool_result',
            id: toolCall.id,
            tool: toolName,
            output: toolOutput,
            duration_ms: toolDuration,
          });

          // Log to audit trail
          try {
            await query(
              `INSERT INTO agent_audit_log (conversation_id, tool_name, tool_input, tool_output, status, duration_ms, iteration)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                conversation_id || null,
                toolName,
                JSON.stringify(parsedInput),
                JSON.stringify(toolOutput),
                toolOutput.error ? 'error' : 'completed',
                toolDuration,
                iteration,
              ]
            );
          } catch { /* DB might be down */ }

          // Add tool result message (OpenAI format)
          messages.push({
            role: 'tool',
            content: JSON.stringify(toolOutput),
            tool_call_id: toolCall.id,
          });
        }

        // Continue the loop — AI will process tool results
        continue;
      }

      // No tool calls — AI is done, return the text response
      const finalContent = result.content || '';
      sendSSE(res, { type: 'message', content: finalContent });
      logActivity('agent', 'success', `Agent completed in ${iteration} iteration(s), ${Date.now() - startTime}ms`);
      break;
    }

    if (iteration >= MAX_ITERATIONS) {
      sendSSE(res, {
        type: 'message',
        content: `I reached the maximum step limit (${MAX_ITERATIONS}). Here\'s my progress so far — you can ask me to continue.`,
      });
    }
  } catch (err) {
    const errorMsg = (err as Error).message;
    logActivity('agent', 'error', `Agent failed: ${errorMsg}`);
    sendSSE(res, { type: 'error', content: `Agent error: ${errorMsg}` });
  }

  sendSSE(res, {
    type: 'done',
    iterations: iteration,
    duration_ms: Date.now() - startTime,
  });
  res.end();
});

// ── Health / Info ─────────────────────────────────────────

agentRouter.get('/capabilities', async (_req: Request, res: Response) => {
  try {
    const { buildCapabilityManifest } = await import('../services/capabilities');
    const manifest = await buildCapabilityManifest();
    res.json(manifest);
  } catch (err) {
    res.status(500).json({ error: `Failed to build capability manifest: ${(err as Error).message}` });
  }
});

agentRouter.get('/tools', (_req: Request, res: Response) => {
  const tools = getToolDefinitions();
  res.json({
    tools: tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
    })),
    count: tools.length,
  });
});

agentRouter.get('/audit', async (req: Request, res: Response) => {
  await ensureAuditTable();
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const result = await query(
      'SELECT * FROM agent_audit_log ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    res.json({ logs: result.rows });
  } catch {
    res.json({ logs: [] });
  }
});

// ── Background Agent Runner (for Task Queue) ─────────────

/**
 * Runs the agent loop without SSE — used by the task queue for background jobs.
 * Returns the final text response.
 */
async function runAgentBackground(
  job: AgentJob,
  abortSignal: AbortSignal,
  onProgress: (update: Partial<AgentJob>) => void
): Promise<string> {
  await ensureAuditTable();

  const tools = getToolDefinitions();
  const startTime = Date.now();

  // Load agent config from fleet_agents table
  let baseSystemPrompt = AGENT_SYSTEM_PROMPT;
  let model = 'coder';
  let conversationId: string | null = null;

  try {
    const agentResult = await query(
      `SELECT system_prompt, model, conversation_id FROM fleet_agents WHERE id = $1`,
      [job.agentId]
    );
    if (agentResult.rows.length > 0) {
      baseSystemPrompt = agentResult.rows[0].system_prompt || AGENT_SYSTEM_PROMPT;
      model = agentResult.rows[0].model || 'coder';
      conversationId = agentResult.rows[0].conversation_id;
    }
  } catch {
    // Use defaults
  }

  // Inject live capability manifest
  let systemPrompt = baseSystemPrompt;
  try {
    const capsSummary = await getCapabilitySummary();
    if (capsSummary && !capsSummary.includes('unavailable')) {
      systemPrompt += `\n\n--- LIVE SYSTEM STATUS ---\n${capsSummary}\n--- END STATUS ---`;
    }
  } catch {
    // Continue without capabilities
  }

  // Load conversation history
  let history: ChatMessage[] = [];
  if (conversationId) {
    try {
      const histResult = await query(
        `SELECT role, content FROM conversation_messages
         WHERE conversation_id = $1
         ORDER BY created_at DESC LIMIT 20`,
        [conversationId]
      );
      history = histResult.rows.reverse().map((m: any) => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content,
      }));
    } catch {
      // No history
    }
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: job.message },
  ];

  // Persist user message to conversation
  if (conversationId) {
    try {
      await query(
        `INSERT INTO conversation_messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
        [conversationId, 'user', job.message]
      );
    } catch { /* best effort */ }
  }

  let iteration = 0;
  let finalContent = '';

  while (iteration < MAX_ITERATIONS) {
    if (abortSignal.aborted) {
      throw new Error('Job cancelled');
    }

    iteration++;

    if (Date.now() - startTime > MAX_AGENT_TIMEOUT_MS) {
      finalContent = 'I reached the time limit (15 minutes). Here\'s where I got to — you can continue from here.';
      break;
    }

    onProgress({
      progress: { iteration, maxIterations: MAX_ITERATIONS },
    });

    logActivity('fleet', 'thinking', `Background agent ${job.agentName} — iteration ${iteration}/${MAX_ITERATIONS}`);

    const result = await chatCompletionWithTools({
      model,
      messages,
      tools,
      max_tokens: 16384,
      temperature: 0.5,
    });

    if (result.tool_calls && result.tool_calls.length > 0) {
      if (result.content) {
        onProgress({
          progress: { iteration, maxIterations: MAX_ITERATIONS, lastThinking: result.content.slice(0, 200) },
        });
      }

      messages.push({
        role: 'assistant',
        content: result.content || '',
      } as any);
      const lastMsg = messages[messages.length - 1] as any;
      lastMsg.tool_calls = result.tool_calls;

      for (const toolCall of result.tool_calls) {
        let parsedInput: any;
        let parseError = false;
        try {
          parsedInput = JSON.parse(toolCall.function.arguments);
        } catch {
          parseError = true;
          parsedInput = { raw: toolCall.function.arguments };
        }

        const toolName = toolCall.function.name;
        onProgress({
          progress: { iteration, maxIterations: MAX_ITERATIONS, currentTool: toolName },
        });

        let toolOutput: any;
        if (parseError) {
          toolOutput = { error: `Tool arguments were truncated or malformed (JSON parse failed). The output was too long. Try breaking the operation into smaller steps.` };
        } else {
          toolOutput = await executeTool(toolName, parsedInput);
        }

        // Audit trail
        try {
          await query(
            `INSERT INTO agent_audit_log (conversation_id, tool_name, tool_input, tool_output, status, duration_ms, iteration)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [conversationId, toolName, JSON.stringify(parsedInput), JSON.stringify(toolOutput),
             toolOutput.error ? 'error' : 'completed', 0, iteration]
          );
        } catch { /* best effort */ }

        messages.push({
          role: 'tool',
          content: JSON.stringify(toolOutput),
          tool_call_id: toolCall.id,
        });
      }

      continue;
    }

    // No tool calls — done
    finalContent = result.content || '';
    break;
  }

  if (iteration >= MAX_ITERATIONS) {
    finalContent = `I reached the maximum step limit (${MAX_ITERATIONS}). Here's my progress so far — you can ask me to continue.`;
  }

  // Persist agent response to conversation
  if (conversationId && finalContent) {
    try {
      await query(
        `INSERT INTO conversation_messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
        [conversationId, 'agent', finalContent]
      );
    } catch { /* best effort */ }
  }

  return finalContent;
}

// Register with task queue
registerAgentRunner(runAgentBackground);
