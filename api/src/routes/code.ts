/**
 * Code Tools API — File system + Git operations
 *
 * Provides REST endpoints for:
 * - File browsing, reading, writing, deleting
 * - Git operations (status, diff, commit, push, pull, branch, log)
 * - Terminal command execution (sandboxed to workspace dirs)
 *
 * Security: All operations are sandboxed to WORKSPACE_ROOT.
 * Paths are resolved and checked against the sandbox boundary.
 */
import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import { logActivity } from '../services/activity-broadcaster';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export const codeRouter = Router();

// ── Configuration ─────────────────────────────────────────
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/workspace';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_OUTPUT_SIZE = 512 * 1024; // 512KB for command output

// Allowed extensions for editing (safety filter)
const BLOCKED_PATTERNS = [
  /\.env$/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /credentials\.json$/i,
  /\.secret$/i,
];

// ── Path Sandboxing ───────────────────────────────────────

/**
 * Resolve and validate a path is within the workspace sandbox.
 * Returns the resolved absolute path or throws.
 */
function safePath(userPath: string): string {
  // Normalize and resolve against workspace root
  const resolved = path.resolve(WORKSPACE_ROOT, userPath.replace(/^\/+/, ''));

  // Ensure the resolved path is under WORKSPACE_ROOT
  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    throw new Error(`Path escapes workspace sandbox: ${userPath}`);
  }

  return resolved;
}

/**
 * Check if a path matches blocked patterns (secrets, keys, etc.)
 */
function isBlockedPath(filePath: string): boolean {
  return BLOCKED_PATTERNS.some(pattern => pattern.test(filePath));
}

// ── Workspace Info ────────────────────────────────────────

codeRouter.get('/workspace', (_req: Request, res: Response) => {
  res.json({
    root: WORKSPACE_ROOT,
    available: true,
  });
});

// ── List registered projects (top-level directories) ──────

codeRouter.get('/projects', async (_req: Request, res: Response) => {
  try {
    const entries = await fs.readdir(WORKSPACE_ROOT, { withFileTypes: true });
    const projects: { name: string; path: string; isGit: boolean }[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const projectPath = path.join(WORKSPACE_ROOT, entry.name);
        let isGit = false;
        try {
          await fs.access(path.join(projectPath, '.git'));
          isGit = true;
        } catch { /* not a git repo */ }

        projects.push({
          name: entry.name,
          path: entry.name,
          isGit,
        });
      }
    }

    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── File Operations ───────────────────────────────────────

/**
 * GET /files?path=<relative-path>
 * List directory contents or read a file
 */
codeRouter.get('/files', async (req: Request, res: Response) => {
  try {
    const userPath = (req.query.path as string) || '';
    const resolved = safePath(userPath);

    const stat = await fs.stat(resolved);

    if (stat.isDirectory()) {
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const items = entries
        .filter(e => !e.name.startsWith('.') || req.query.showHidden === 'true')
        .map(e => ({
          name: e.name,
          path: path.relative(WORKSPACE_ROOT, path.join(resolved, e.name)),
          isDirectory: e.isDirectory(),
          isFile: e.isFile(),
          isSymlink: e.isSymbolicLink(),
        }))
        .sort((a, b) => {
          // Directories first, then files
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });

      res.json({ type: 'directory', path: userPath, items });
    } else {
      // Read file
      if (stat.size > MAX_FILE_SIZE) {
        res.status(413).json({ error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB > 5MB limit)` });
        return;
      }

      const content = await fs.readFile(resolved, 'utf-8');
      const ext = path.extname(resolved).slice(1).toLowerCase();

      res.json({
        type: 'file',
        path: userPath,
        name: path.basename(resolved),
        extension: ext,
        size: stat.size,
        content,
        modified: stat.mtime.toISOString(),
      });
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      res.status(404).json({ error: 'Path not found' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

/**
 * PUT /files — Create or update a file
 */
codeRouter.put('/files', async (req: Request, res: Response) => {
  try {
    const { path: filePath, content } = req.body;

    if (!filePath || content === undefined) {
      res.status(400).json({ error: 'path and content are required' });
      return;
    }

    if (isBlockedPath(filePath)) {
      res.status(403).json({ error: 'Cannot write to sensitive files (.env, keys, credentials)' });
      return;
    }

    const resolved = safePath(filePath);

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(resolved), { recursive: true });

    await fs.writeFile(resolved, content, 'utf-8');

    logActivity('code-tools', 'success', `File written: ${filePath}`);
    res.json({ success: true, path: filePath });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /files/mkdir — Create a directory
 */
codeRouter.post('/files/mkdir', async (req: Request, res: Response) => {
  try {
    const { path: dirPath } = req.body;
    if (!dirPath) {
      res.status(400).json({ error: 'path is required' });
      return;
    }

    const resolved = safePath(dirPath);
    await fs.mkdir(resolved, { recursive: true });

    res.json({ success: true, path: dirPath });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * DELETE /files?path=<relative-path>
 */
codeRouter.delete('/files', async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ error: 'path query param is required' });
      return;
    }

    if (isBlockedPath(filePath)) {
      res.status(403).json({ error: 'Cannot delete sensitive files' });
      return;
    }

    const resolved = safePath(filePath);
    const stat = await fs.stat(resolved);

    if (stat.isDirectory()) {
      await fs.rm(resolved, { recursive: true });
    } else {
      await fs.unlink(resolved);
    }

    logActivity('code-tools', 'success', `Deleted: ${filePath}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /files/rename — Move/rename a file or directory
 */
codeRouter.post('/files/rename', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.body;
    if (!from || !to) {
      res.status(400).json({ error: 'from and to are required' });
      return;
    }

    const resolvedFrom = safePath(from);
    const resolvedTo = safePath(to);

    // Ensure target parent exists
    await fs.mkdir(path.dirname(resolvedTo), { recursive: true });
    await fs.rename(resolvedFrom, resolvedTo);

    res.json({ success: true, from, to });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /files/search — Search for files by name or content
 */
codeRouter.post('/files/search', async (req: Request, res: Response) => {
  try {
    const { query, searchPath, type } = req.body;
    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const cwd = safePath(searchPath || '');

    if (type === 'content') {
      // Search file contents with grep
      try {
        const { stdout } = await execAsync(
          `grep -rn --include="*.{ts,tsx,js,jsx,py,rs,go,java,c,cpp,h,css,html,json,yaml,yml,toml,md,txt}" -l "${query.replace(/"/g, '\\"')}" .`,
          { cwd, maxBuffer: MAX_OUTPUT_SIZE, timeout: 10000 }
        );
        const files = stdout.trim().split('\n').filter(Boolean).map(f => f.replace(/^\.\//, ''));
        res.json({ results: files, count: files.length });
      } catch {
        res.json({ results: [], count: 0 });
      }
    } else {
      // Search by filename
      try {
        const { stdout } = await execAsync(
          `find . -name "*${query.replace(/"/g, '\\"')}*" -not -path "*/node_modules/*" -not -path "*/.git/*" | head -50`,
          { cwd, maxBuffer: MAX_OUTPUT_SIZE, timeout: 10000 }
        );
        const files = stdout.trim().split('\n').filter(Boolean).map(f => f.replace(/^\.\//, ''));
        res.json({ results: files, count: files.length });
      } catch {
        res.json({ results: [], count: 0 });
      }
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Git Operations ────────────────────────────────────────

/**
 * Run a git command in a project directory
 */
async function gitCommand(projectPath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const cwd = safePath(projectPath);

  // Verify it's a git repo
  try {
    await fs.access(path.join(cwd, '.git'));
  } catch {
    throw new Error(`Not a git repository: ${projectPath}`);
  }

  const result = await execFileAsync('git', args, {
    cwd,
    maxBuffer: MAX_OUTPUT_SIZE,
    timeout: 30000,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0', // Never prompt for credentials interactively
    },
  });

  return result;
}

/**
 * GET /git/status?project=<path>
 */
codeRouter.get('/git/status', async (req: Request, res: Response) => {
  try {
    const project = req.query.project as string;
    if (!project) {
      res.status(400).json({ error: 'project query param required' });
      return;
    }

    const { stdout } = await gitCommand(project, ['status', '--porcelain', '-b']);
    const lines = stdout.trim().split('\n');

    // Parse branch info from first line
    const branchLine = lines[0] || '';
    const branchMatch = branchLine.match(/^## (.+?)(?:\.\.\.(.+))?$/);
    const branch = branchMatch ? branchMatch[1] : 'unknown';
    const tracking = branchMatch ? branchMatch[2] || null : null;

    // Parse file statuses
    const files = lines.slice(1).filter(Boolean).map(line => {
      const index = line[0];
      const working = line[1];
      const filePath = line.substring(3);
      return {
        path: filePath,
        index,
        working,
        staged: index !== ' ' && index !== '?',
        modified: working === 'M',
        untracked: index === '?' && working === '?',
        deleted: index === 'D' || working === 'D',
        added: index === 'A',
      };
    });

    res.json({ branch, tracking, files, clean: files.length === 0 });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /git/diff?project=<path>&staged=true|false&file=<optional>
 */
codeRouter.get('/git/diff', async (req: Request, res: Response) => {
  try {
    const project = req.query.project as string;
    if (!project) {
      res.status(400).json({ error: 'project query param required' });
      return;
    }

    const args = ['diff'];
    if (req.query.staged === 'true') args.push('--cached');
    if (req.query.file) args.push('--', req.query.file as string);

    const { stdout } = await gitCommand(project, args);
    res.json({ diff: stdout });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /git/log?project=<path>&limit=20
 */
codeRouter.get('/git/log', async (req: Request, res: Response) => {
  try {
    const project = req.query.project as string;
    if (!project) {
      res.status(400).json({ error: 'project query param required' });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const { stdout } = await gitCommand(project, [
      'log',
      `--max-count=${limit}`,
      '--pretty=format:%H|%h|%an|%ae|%ar|%s',
    ]);

    const commits = stdout.trim().split('\n').filter(Boolean).map(line => {
      const [hash, shortHash, author, email, relativeDate, ...messageParts] = line.split('|');
      return {
        hash,
        shortHash,
        author,
        email,
        relativeDate,
        message: messageParts.join('|'),
      };
    });

    res.json({ commits });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /git/branches?project=<path>
 */
codeRouter.get('/git/branches', async (req: Request, res: Response) => {
  try {
    const project = req.query.project as string;
    if (!project) {
      res.status(400).json({ error: 'project query param required' });
      return;
    }

    const { stdout } = await gitCommand(project, ['branch', '-a', '--format=%(refname:short)|%(objectname:short)|%(HEAD)']);

    const branches = stdout.trim().split('\n').filter(Boolean).map(line => {
      const [name, hash, head] = line.split('|');
      return {
        name,
        hash,
        current: head === '*',
        remote: name.startsWith('remotes/') || name.startsWith('origin/'),
      };
    });

    res.json({ branches });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /git/stage — Stage files
 */
codeRouter.post('/git/stage', async (req: Request, res: Response) => {
  try {
    const { project, files } = req.body;
    if (!project) {
      res.status(400).json({ error: 'project is required' });
      return;
    }

    const args = ['add'];
    if (files && Array.isArray(files) && files.length > 0) {
      args.push('--', ...files);
    } else {
      args.push('-A');
    }

    await gitCommand(project, args);
    logActivity('code-tools', 'success', `Staged files in ${project}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /git/unstage — Unstage files
 */
codeRouter.post('/git/unstage', async (req: Request, res: Response) => {
  try {
    const { project, files } = req.body;
    if (!project) {
      res.status(400).json({ error: 'project is required' });
      return;
    }

    const args = ['reset', 'HEAD'];
    if (files && Array.isArray(files)) {
      args.push('--', ...files);
    }

    await gitCommand(project, args);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /git/commit — Create a commit
 */
codeRouter.post('/git/commit', async (req: Request, res: Response) => {
  try {
    const { project, message, author } = req.body;
    if (!project || !message) {
      res.status(400).json({ error: 'project and message are required' });
      return;
    }

    const args = ['commit', '-m', message];
    if (author) {
      args.push('--author', author);
    }

    const { stdout } = await gitCommand(project, args);
    logActivity('code-tools', 'success', `Commit in ${project}: ${message.substring(0, 50)}`);
    res.json({ success: true, output: stdout });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /git/push — Push to remote
 */
codeRouter.post('/git/push', async (req: Request, res: Response) => {
  try {
    const { project, remote, branch, setUpstream } = req.body;
    if (!project) {
      res.status(400).json({ error: 'project is required' });
      return;
    }

    const args = ['push'];
    if (setUpstream) args.push('-u');
    if (remote) args.push(remote);
    if (branch) args.push(branch);

    const { stdout, stderr } = await gitCommand(project, args);
    logActivity('code-tools', 'success', `Pushed ${project} to ${remote || 'origin'}`);
    res.json({ success: true, output: stdout || stderr });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /git/pull — Pull from remote
 */
codeRouter.post('/git/pull', async (req: Request, res: Response) => {
  try {
    const { project, remote, branch } = req.body;
    if (!project) {
      res.status(400).json({ error: 'project is required' });
      return;
    }

    const args = ['pull'];
    if (remote) args.push(remote);
    if (branch) args.push(branch);

    const { stdout, stderr } = await gitCommand(project, args);
    logActivity('code-tools', 'success', `Pulled ${project} from ${remote || 'origin'}`);
    res.json({ success: true, output: stdout || stderr });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /git/checkout — Switch or create branch
 */
codeRouter.post('/git/checkout', async (req: Request, res: Response) => {
  try {
    const { project, branch, create } = req.body;
    if (!project || !branch) {
      res.status(400).json({ error: 'project and branch are required' });
      return;
    }

    const args = ['checkout'];
    if (create) args.push('-b');
    args.push(branch);

    const { stdout } = await gitCommand(project, args);
    logActivity('code-tools', 'info', `Switched to branch ${branch} in ${project}`);
    res.json({ success: true, output: stdout });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /git/clone — Clone a repository into workspace
 */
codeRouter.post('/git/clone', async (req: Request, res: Response) => {
  try {
    const { url, name } = req.body;
    if (!url) {
      res.status(400).json({ error: 'url is required' });
      return;
    }

    const targetName = name || url.split('/').pop()?.replace('.git', '') || 'repo';
    const targetPath = path.join(WORKSPACE_ROOT, targetName);

    // Check if directory already exists
    try {
      await fs.access(targetPath);
      res.status(409).json({ error: `Directory ${targetName} already exists` });
      return;
    } catch { /* good — doesn't exist */ }

    const { stdout, stderr } = await execFileAsync('git', ['clone', url, targetPath], {
      maxBuffer: MAX_OUTPUT_SIZE,
      timeout: 120000, // 2 minute timeout for cloning
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
    });

    logActivity('code-tools', 'success', `Cloned ${url} → ${targetName}`);
    res.json({ success: true, name: targetName, output: stdout || stderr });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Terminal (sandboxed command execution) ─────────────────

/**
 * POST /terminal/exec — Execute a command in a project directory
 *
 * Only allows a curated set of safe commands.
 */
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
]);

codeRouter.post('/terminal/exec', async (req: Request, res: Response) => {
  try {
    const { command, cwd: userCwd } = req.body;
    if (!command) {
      res.status(400).json({ error: 'command is required' });
      return;
    }

    // Extract the base command
    const baseCommand = command.trim().split(/\s+/)[0];
    if (!ALLOWED_COMMANDS.has(baseCommand)) {
      res.status(403).json({
        error: `Command '${baseCommand}' is not allowed. Permitted: ${Array.from(ALLOWED_COMMANDS).sort().join(', ')}`,
      });
      return;
    }

    // Block dangerous patterns
    const dangerousPatterns = [
      /rm\s+(-rf?|--recursive)\s+\//,  // rm -rf /
      />\s*\/dev\/sd/,                   // writing to devices
      /mkfs/,                            // formatting
      /dd\s+if=/,                        // disk destroyer
      /:(){ :|:& };:/,                   // fork bomb
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        res.status(403).json({ error: 'Dangerous command pattern detected' });
        return;
      }
    }

    const execCwd = userCwd ? safePath(userCwd) : WORKSPACE_ROOT;

    const { stdout, stderr } = await execAsync(command, {
      cwd: execCwd,
      maxBuffer: MAX_OUTPUT_SIZE,
      timeout: 60000, // 1 minute timeout
      env: {
        ...process.env,
        HOME: process.env.HOME || '/root',
        PATH: process.env.PATH,
      },
    });

    logActivity('code-tools', 'info', `Executed: ${command.substring(0, 80)}`);
    res.json({ stdout, stderr, exitCode: 0 });
  } catch (err: any) {
    // exec errors include stdout/stderr
    res.json({
      stdout: err.stdout || '',
      stderr: err.stderr || err.message,
      exitCode: err.code || 1,
    });
  }
});
