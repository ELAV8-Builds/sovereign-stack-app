# Agent Engine — Phase 0 Spec

**Version**: 1.0
**Status**: Approved for development
**Date**: 2026-03-06
**Priority**: Critical — prerequisite for Fleet Mode and all agentic capabilities

---

## Problem

The Sovereign Stack chat is currently a **chatbot**, not an **agent**. When a user asks "clone this repo" or "install dependencies", the AI can only *describe* the commands — it can't execute them. The infrastructure for execution exists (sandboxed terminal, file operations, git integration), but it's not connected to the chat.

This is the single biggest gap between what users expect and what the app delivers.

---

## What Exists Today

| Component | Status | Location |
|-----------|--------|----------|
| Chat UI + conversation history | ✅ Working | `src/components/ChatInterface.tsx` |
| LiteLLM routing (9 tiers, 3 providers) | ✅ Working | `api/src/services/litellm.ts` |
| Terminal sandbox (48 commands, path sandboxing) | ✅ Working | `api/src/routes/code.ts` — `POST /terminal/exec` |
| File read/write/delete (sandboxed) | ✅ Working | `api/src/routes/code.ts` — `GET/PUT/DELETE /files` |
| Git operations (clone, commit, push, pull, etc.) | ✅ Working | `api/src/routes/code.ts` — `/git/*` |
| Creative tools (10 tools) | ✅ Working | `api/src/routes/tools.ts` — `POST /tools/run/:id` |
| Tool calling in LiteLLM request | ❌ Missing | `litellm.ts` sends no `tools` parameter |
| Agent loop (tool call → execute → resume) | ❌ Missing | Chat does single request → response |
| Frontend tool execution UI | ❌ Missing | Chat only renders text |
| Audit logging for AI actions | ❌ Missing | No record of what AI executed |
| User confirmation for destructive actions | ❌ Missing | No permission system |

**Bottom line**: All the execution infrastructure exists. We just need the orchestration layer to connect the AI's brain to the app's hands.

---

## Architecture

```
┌───────────────────────────────────────────────────────┐
│                    FRONTEND (App)                      │
│                                                        │
│  ChatInterface.tsx                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Message      │  │ Tool Call    │  │ Confirmation │ │
│  │ Renderer     │  │ Renderer     │  │ Dialog       │ │
│  └─────────────┘  └──────────────┘  └──────────────┘ │
│         │                │                  │          │
│         └────────────────┴──────────────────┘          │
│                          │                             │
│                   POST /api/chat/agent                 │
│                          │                             │
└──────────────────────────┼─────────────────────────────┘
                           │
┌──────────────────────────┼─────────────────────────────┐
│                    BACKEND (API)                        │
│                          │                             │
│  ┌───────────────────────┴────────────────────────┐   │
│  │              AGENT LOOP (new)                   │   │
│  │                                                 │   │
│  │  1. User message + history → LiteLLM (w/tools) │   │
│  │  2. Parse response                              │   │
│  │     ├─ text → return to user                    │   │
│  │     └─ tool_use → execute tool, loop to step 1  │   │
│  │  3. Max 20 iterations safety limit              │   │
│  │  4. Stream progress via SSE                     │   │
│  └─────────────────────────────────────────────────┘   │
│         │              │              │                 │
│  ┌──────┴─────┐ ┌──────┴─────┐ ┌─────┴──────┐        │
│  │ Terminal   │ │ File Ops   │ │ Git Ops    │        │
│  │ Sandbox    │ │ (existing) │ │ (existing) │        │
│  │ (existing) │ └────────────┘ └────────────┘        │
│  └────────────┘                                       │
└───────────────────────────────────────────────────────┘
```

---

## Tool Definitions

These are the tools the AI will have access to. Each maps to an existing API endpoint.

### 1. `run_terminal_command`

Execute a sandboxed terminal command.

```json
{
  "name": "run_terminal_command",
  "description": "Execute a terminal command in the workspace. Sandboxed to the workspace directory. Allowed commands: ls, cat, head, tail, grep, find, node, npm, npx, python, pip, git, curl, docker, tsc, eslint, prettier, jest, vitest, and more. Blocked: rm -rf /, device writes, fork bombs.",
  "input_schema": {
    "type": "object",
    "properties": {
      "command": {
        "type": "string",
        "description": "The command to execute"
      },
      "cwd": {
        "type": "string",
        "description": "Working directory relative to workspace root (optional, defaults to workspace root)"
      }
    },
    "required": ["command"]
  }
}
```

**Maps to**: `POST /api/code/terminal/exec`
**Security**: Existing allowlist + dangerous pattern detection + path sandbox

### 2. `read_file`

Read a file's contents.

```json
{
  "name": "read_file",
  "description": "Read the contents of a file. Returns the file content, extension, size, and modification date. Max file size: 5MB.",
  "input_schema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "File path relative to workspace root"
      }
    },
    "required": ["path"]
  }
}
```

**Maps to**: `GET /api/code/files?path=<path>`
**Security**: Path sandboxing to workspace root

### 3. `write_file`

Create or overwrite a file.

```json
{
  "name": "write_file",
  "description": "Write content to a file. Creates parent directories if needed. Cannot write to .env, .pem, .key, SSH keys, or credentials files.",
  "input_schema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "File path relative to workspace root"
      },
      "content": {
        "type": "string",
        "description": "The content to write"
      }
    },
    "required": ["path", "content"]
  }
}
```

**Maps to**: `PUT /api/code/files`
**Security**: Blocked patterns for sensitive files + path sandboxing

### 4. `list_directory`

List files and folders in a directory.

```json
{
  "name": "list_directory",
  "description": "List files and directories at the given path. Returns name, path, and type (file/directory) for each entry.",
  "input_schema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Directory path relative to workspace root (empty string for workspace root)"
      }
    },
    "required": ["path"]
  }
}
```

**Maps to**: `GET /api/code/files?path=<path>` (when path is a directory)

### 5. `search_files`

Search for files by name or content.

```json
{
  "name": "search_files",
  "description": "Search for files by name or by content (grep). Returns matching file paths.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Search query — filename pattern or content to search for"
      },
      "type": {
        "type": "string",
        "enum": ["filename", "content"],
        "description": "Search by filename or by file content"
      },
      "path": {
        "type": "string",
        "description": "Directory to search in (relative to workspace root, optional)"
      }
    },
    "required": ["query", "type"]
  }
}
```

**Maps to**: `POST /api/code/files/search`

### 6. `git_operation`

Perform git operations on a project.

```json
{
  "name": "git_operation",
  "description": "Perform a git operation (status, diff, log, clone, commit, push, pull, checkout, branch, stage, unstage). SSH keys are available for authenticated operations.",
  "input_schema": {
    "type": "object",
    "properties": {
      "operation": {
        "type": "string",
        "enum": ["status", "diff", "log", "clone", "commit", "push", "pull", "checkout", "branch", "stage", "unstage"],
        "description": "The git operation to perform"
      },
      "project": {
        "type": "string",
        "description": "Project directory relative to workspace root (for all operations except clone)"
      },
      "url": {
        "type": "string",
        "description": "Repository URL (for clone operation only)"
      },
      "message": {
        "type": "string",
        "description": "Commit message (for commit operation)"
      },
      "branch": {
        "type": "string",
        "description": "Branch name (for checkout/branch operations)"
      },
      "files": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Files to stage/unstage (optional — stages all if not specified)"
      },
      "create": {
        "type": "boolean",
        "description": "Create new branch (for checkout with -b)"
      }
    },
    "required": ["operation"]
  }
}
```

**Maps to**: Multiple `/api/code/git/*` endpoints depending on operation
**Security**: `GIT_TERMINAL_PROMPT=0`, read-only SSH keys, path sandboxing

### 7. `run_creative_tool`

Run one of the built-in creative tools.

```json
{
  "name": "run_creative_tool",
  "description": "Run a creative/design tool. Available tools: iteration-engine (3-cycle generate→critique→refine), creative-engine (multi-variant exploration), motion-builder (animation specs), design-audit (UI/UX audit), image-gen (image generation), component-library (component code gen), copy-generator (UI copy), color-palette (palette analysis), user-flow (journey mapping), responsive-preview (responsive specs).",
  "input_schema": {
    "type": "object",
    "properties": {
      "tool_id": {
        "type": "string",
        "enum": ["iteration-engine", "creative-engine", "motion-builder", "design-audit", "image-gen", "component-library", "copy-generator", "color-palette", "user-flow", "responsive-preview"],
        "description": "Which creative tool to run"
      },
      "input": {
        "type": "object",
        "description": "Tool-specific input (varies by tool)"
      }
    },
    "required": ["tool_id", "input"]
  }
}
```

**Maps to**: `POST /api/tools/run/:toolId`

---

## Agent Loop — Backend Implementation

### New Endpoint: `POST /api/chat/agent`

This replaces the current `POST /api/chat/send` for agentic interactions.

**Request:**
```json
{
  "message": "Clone the studio-brain repo and set it up",
  "conversation_id": "abc-123",
  "model": "coder",
  "history": [...]
}
```

**Response** (Server-Sent Events stream):
```
data: {"type": "thinking", "content": "I'll clone the repository and check what type of project it is."}

data: {"type": "tool_call", "tool": "git_operation", "input": {"operation": "clone", "url": "git@github.com:ELAV8-Builds/studio-brain.git"}}

data: {"type": "tool_result", "tool": "git_operation", "output": {"success": true, "name": "studio-brain"}}

data: {"type": "tool_call", "tool": "read_file", "input": {"path": "studio-brain/package.json"}}

data: {"type": "tool_result", "tool": "read_file", "output": {"content": "{...}", "extension": "json"}}

data: {"type": "tool_call", "tool": "run_terminal_command", "input": {"command": "npm install", "cwd": "studio-brain"}}

data: {"type": "tool_result", "tool": "run_terminal_command", "output": {"stdout": "added 847 packages...", "exitCode": 0}}

data: {"type": "message", "content": "Done! I cloned studio-brain and installed all dependencies. It's a Node.js project with 847 packages. Here's what I found:\n\n- **Framework**: React + Vite\n- **Language**: TypeScript\n- ..."}

data: {"type": "done"}
```

### Agent Loop Pseudocode

```typescript
async function agentLoop(userMessage, history, conversationId, onEvent) {
  const tools = getToolDefinitions();
  const messages = buildMessages(history, userMessage);

  let iterations = 0;
  const MAX_ITERATIONS = 20;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // Call LLM with tools
    const response = await litellmWithTools({
      model: 'coder',
      messages,
      tools,
    });

    // Check stop reason
    if (response.stop_reason === 'end_turn' || response.stop_reason === 'stop') {
      // AI is done — extract final text and return
      const text = extractText(response.content);
      onEvent({ type: 'message', content: text });
      onEvent({ type: 'done' });

      // Log to audit trail
      await logAgentRun(conversationId, iterations, messages);
      return;
    }

    if (response.stop_reason === 'tool_use') {
      // Process each tool call
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          onEvent({ type: 'tool_call', tool: block.name, input: block.input });

          // Check if this needs confirmation
          if (needsConfirmation(block.name, block.input)) {
            onEvent({ type: 'confirm_required', tool: block.name, input: block.input });
            // Wait for user confirmation (via separate endpoint)
            // For now in Layer 0: auto-approve with logging
          }

          // Execute the tool
          const result = await executeTool(block.name, block.input);
          onEvent({ type: 'tool_result', tool: block.name, output: result });

          // Add tool result to conversation
          messages.push({
            role: 'assistant',
            content: response.content,
          });
          messages.push({
            role: 'user',  // tool results go as user messages in Anthropic format
            content: [{
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            }],
          });
        }
      }
    }
  }

  // Safety limit reached
  onEvent({ type: 'message', content: 'I reached the maximum number of steps (20). Here\'s where I got to: ...' });
  onEvent({ type: 'done' });
}
```

### Tool Executor

Maps tool names to existing API endpoints:

```typescript
async function executeTool(name: string, input: any): Promise<any> {
  switch (name) {
    case 'run_terminal_command':
      return execTerminal(input.command, input.cwd);

    case 'read_file':
      return readWorkspaceFile(input.path);

    case 'write_file':
      return writeWorkspaceFile(input.path, input.content);

    case 'list_directory':
      return listWorkspaceDir(input.path);

    case 'search_files':
      return searchWorkspace(input.query, input.type, input.path);

    case 'git_operation':
      return execGitOp(input);

    case 'run_creative_tool':
      return runTool(input.tool_id, input.input);

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
```

These executor functions call the same internal functions used by the existing REST endpoints, but directly (no HTTP overhead).

---

## LiteLLM Service Changes

### Updated `chatCompletion` with Tool Support

```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: object;
}

export interface ChatCompletionWithToolsOptions extends ChatCompletionOptions {
  tools?: ToolDefinition[];
}

export interface ChatCompletionWithToolsResult {
  content: any[];       // Array of text blocks and tool_use blocks
  stop_reason: string;  // 'end_turn' | 'tool_use' | 'stop'
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function chatCompletionWithTools(
  options: ChatCompletionWithToolsOptions
): Promise<ChatCompletionWithToolsResult> {
  const model = options.model || 'coder';

  const body: any = {
    model,
    messages: options.messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 4096,
    stream: false,
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = 'auto';
  }

  const response = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LITELLM_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`LiteLLM ${model} failed (${response.status})`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];

  return {
    content: choice?.message?.content || [],
    stop_reason: choice?.finish_reason || 'stop',
    usage: data.usage,
  };
}
```

**Note**: LiteLLM already passes through OpenAI-format tool calling. Claude's native format is slightly different, but LiteLLM handles the translation. We just need to include the `tools` parameter.

---

## Frontend Changes

### 1. Agent-Aware Chat Messages

Messages can now have tool calls embedded:

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: Date;
  status?: 'sending' | 'sent' | 'error';
  // NEW: Agent execution metadata
  toolCalls?: ToolCallMessage[];
}

interface ToolCallMessage {
  id: string;
  tool: string;
  input: any;
  output?: any;
  status: 'running' | 'completed' | 'error';
  duration_ms?: number;
}
```

### 2. Tool Call Renderer Component

New component: `src/components/ToolCallBlock.tsx`

Renders inline tool execution blocks within agent messages:

```
┌─────────────────────────────────────────────────┐
│ 🤖 Sovereign Agent                              │
│                                                   │
│ I'll clone the repo and set it up.               │
│                                                   │
│ ┌─── 🔧 git clone ─────────────────────────────┐│
│ │ ✅ Cloned studio-brain (2.3s)                 ││
│ └───────────────────────────────────────────────┘│
│                                                   │
│ ┌─── 📄 read_file ─────────────────────────────┐│
│ │ ✅ Read package.json (0.1s)                   ││
│ └───────────────────────────────────────────────┘│
│                                                   │
│ ┌─── ⚡ npm install ──────────────────────────┐ │
│ │ ⏳ Running... (12s)                          │ │
│ │ ┌──────────────────────────────────────┐     │ │
│ │ │ added 847 packages in 11.2s          │     │ │
│ │ │ 43 packages are looking for funding  │     │ │
│ │ └──────────────────────────────────────┘     │ │
│ └──────────────────────────────────────────────┘ │
│                                                   │
│ Done! Here's what I found...                     │
└─────────────────────────────────────────────────┘
```

Each tool call block shows:
- Tool icon + name (collapsible)
- Status: ⏳ running / ✅ completed / ❌ error
- Duration
- Output (collapsed by default, expandable)
- For terminal commands: shows command text + output in a code block

### 3. Streaming Agent Response Handler

New function: `src/lib/agent.ts`

```typescript
export async function chatWithAgent(
  message: string,
  conversationId: string | null,
  history: ChatMessage[],
  callbacks: {
    onThinking: (text: string) => void;
    onToolCall: (tool: string, input: any) => void;
    onToolResult: (tool: string, output: any) => void;
    onMessage: (text: string) => void;
    onDone: () => void;
    onError: (error: string) => void;
  }
): Promise<void> {
  const response = await fetch('/api/sovereign/chat/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversation_id: conversationId, history }),
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  // Process SSE events...
}
```

### 4. ChatInterface Updates

- Replace `chatWithAI()` call with `chatWithAgent()` when agent mode is active
- Add toggle: "Agent Mode" (default on) vs "Chat Mode" (text-only, faster)
- Render `ToolCallBlock` components inline within agent messages
- Show iteration count badge during long agent runs
- Add "Stop" button to cancel a running agent loop

---

## Security Model

### Layer 0 Security (what we build now)

| Protection | Implementation |
|-----------|---------------|
| Command allowlist | Existing 48-command allowlist (code.ts) |
| Dangerous pattern detection | Existing 5 regex patterns (code.ts) |
| Path sandboxing | Existing `safePath()` — all ops under /workspace |
| Sensitive file blocking | Existing blocked patterns (.env, .pem, .key, etc.) |
| Iteration limit | Max 20 tool calls per agent turn |
| Timeout | 60s per command, 5-minute total per agent turn |
| Audit logging | New — every tool call logged to `agent_audit_log` table |
| Activity broadcast | Existing — all tool executions emit to WebSocket feed |

### Audit Log Table

```sql
CREATE TABLE IF NOT EXISTS agent_audit_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id TEXT,
  tool_name TEXT NOT NULL,
  tool_input JSONB NOT NULL,
  tool_output JSONB,
  status TEXT NOT NULL DEFAULT 'running',  -- running | completed | error
  duration_ms INT,
  iteration INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Future Security (Layer 1+)

| Protection | When |
|-----------|------|
| User confirmation for destructive ops | Layer 1 — "Allow git push?" dialog |
| Per-bot workspace scoping | Layer 1 — bots can only access their assigned directories |
| Rate limiting per bot | Layer 1 — max requests per minute |
| Read-only mode for some bots | Layer 2 — research bots can't write files |
| Network isolation per bot | Layer 2 — bots can't call arbitrary URLs |

---

## Implementation Plan

### Step 1: Backend Agent Loop (~1 hour)

**File: `api/src/routes/agent.ts`** (NEW)
1. Create `POST /api/chat/agent` endpoint with SSE streaming
2. Implement agent loop: LLM call → tool detection → execution → resume
3. Tool executor that calls existing code.ts/tools.ts functions directly
4. Audit logging to `agent_audit_log` table
5. Safety limits: 20 iterations, 5-minute timeout

**File: `api/src/services/litellm.ts`** (MODIFY)
1. Add `chatCompletionWithTools()` function
2. Include `tools` and `tool_choice` parameters in LiteLLM request
3. Parse `tool_use` blocks from response

**File: `api/src/index.ts`** (MODIFY)
1. Register `agentRouter` at `/api/chat/agent`

### Step 2: Frontend Agent Client (~1 hour)

**File: `src/lib/agent.ts`** (NEW)
1. SSE client for `POST /api/chat/agent`
2. Parse streaming events (thinking, tool_call, tool_result, message, done)
3. Callback-based interface for ChatInterface integration

**File: `src/components/ToolCallBlock.tsx`** (NEW)
1. Collapsible tool execution block UI
2. Status indicators (running, completed, error)
3. Output display with code formatting
4. Duration badge

### Step 3: ChatInterface Integration (~30 min)

**File: `src/components/ChatInterface.tsx`** (MODIFY)
1. Add agent mode toggle (Agent/Chat switch)
2. Replace `chatWithAI()` with `chatWithAgent()` when agent mode is on
3. Accumulate tool call messages during agent execution
4. Render ToolCallBlock components inline
5. Add "Stop" button during agent execution
6. Show iteration progress

### Step 4: System Prompt Enhancement (~15 min)

**File: `src/lib/ai.ts`** or new `api/src/services/agent-prompt.ts`
1. Enhanced system prompt that tells the AI about its tools
2. Guidelines: "Use tools when the user asks you to do something. Don't just describe the commands — execute them."
3. Safety guidelines: "Always check what a command does before running it. Show the user what you're about to do."

### Step 5: Verify + Polish (~15 min)

1. `tsc --noEmit` on both repos
2. `npm run build` on both repos
3. Test: Ask agent to clone a repo, read files, run npm install
4. Verify audit log records all tool calls
5. Verify SSE streaming works in the frontend

---

## System Prompt (Agent Mode)

```
You are {agent_name}, an AI agent running inside the Sovereign Stack. You have direct access to the user's workspace and can execute real actions.

CAPABILITIES:
- Execute terminal commands (npm, git, python, node, etc.)
- Read and write files in the workspace
- Search through codebases
- Perform git operations (clone, commit, push, pull)
- Run creative tools (iteration engine, design audit, etc.)

GUIDELINES:
1. When asked to DO something, use your tools — don't just describe the steps.
2. Before running a command, briefly explain what you're about to do.
3. After each tool call, check the output for errors before proceeding.
4. For multi-step tasks, work through them systematically.
5. If a command fails, diagnose the error and try an alternative approach.
6. Never modify .env files, SSH keys, or credentials.
7. For git push/pull operations, confirm the branch is correct.
8. Show relevant output to the user (don't hide everything behind tool calls).

WORKSPACE:
- Root: /workspace
- Projects are top-level directories
- Files are accessible via relative paths from workspace root
```

---

## What This Does NOT Include

- User confirmation dialogs (future — for now, all tools auto-execute within sandbox limits)
- Per-bot workspace scoping (Fleet Mode Layer 1)
- Streaming token output (we stream events, but the final text message comes in one chunk)
- Image display from image-gen tool (future — would need blob handling)
- WebSocket-based tool execution (we use SSE, simpler and sufficient)

---

## Success Criteria

Phase 0 (Agent Engine) is done when:
1. User says "clone repo X" → AI actually clones it
2. User says "install dependencies" → AI runs npm install and shows output
3. User says "what files are in this project?" → AI lists them
4. User says "create a new file called hello.ts with a hello world function" → AI creates it
5. User says "commit and push these changes" → AI does the git operations
6. All tool calls are visible in the chat as collapsible blocks
7. All tool calls are logged in `agent_audit_log`
8. Agent stops after 20 iterations (safety)
9. Build passes on both repos (Rule 10)
10. Agent mode has a visible toggle in the chat UI

---

## Migration Path

After Agent Engine is validated:

1. **Fleet Mode Layer 1**: Each bot profile defines which tools it has access to. Marketing bot gets creative tools only. Dev bot gets terminal + git + files. This is just filtering the `tools` array per bot.

2. **Fleet Mode Layer 2**: Remote workers proxy tool execution through the Overlord's agent endpoint. Worker sends tool request → Overlord executes → returns result. Same agent loop, different transport.

3. **Confirmation System**: Add `needs_confirmation` flag to destructive operations (git push, file delete, docker commands). Frontend shows dialog, user approves, execution continues.
