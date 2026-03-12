/**
 * Browser Service — Wraps agent-browser CLI for web browsing capabilities.
 *
 * Provides functions to open URLs, interact with page elements, take screenshots,
 * and extract data using a real Chromium browser via the agent-browser CLI.
 */
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const BROWSER_TIMEOUT_MS = 30_000; // 30 seconds per command
const MAX_OUTPUT_SIZE = 512 * 1024; // 512KB per command output

/**
 * Execute an agent-browser CLI command safely with timeout and error handling.
 */
async function runBrowserCommand(args: string[]): Promise<{ stdout: string; stderr: string }> {
  // Shell-escape each argument
  const escaped = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
  const command = `agent-browser ${escaped}`;

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: BROWSER_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_SIZE,
      env: {
        ...process.env,
        HOME: process.env.HOME || '/root',
        PATH: process.env.PATH,
      },
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err: any) {
    // If the command timed out, provide a clear message
    if (err.killed) {
      throw new Error(`Browser command timed out after ${BROWSER_TIMEOUT_MS / 1000}s: agent-browser ${args[0]}`);
    }
    // Return partial output if available, otherwise throw
    if (err.stdout || err.stderr) {
      return {
        stdout: (err.stdout || '').trim(),
        stderr: (err.stderr || err.message || '').trim(),
      };
    }
    throw new Error(`Browser command failed: ${err.message}`);
  }
}

/**
 * Open a URL in the browser and return a snapshot of interactive elements.
 */
export async function browseUrl(url: string): Promise<{ output: string; error?: string }> {
  try {
    // Open the URL
    const openResult = await runBrowserCommand(['open', url]);

    // Immediately get an interactive snapshot so the agent can see what's on the page
    let snapshot = '';
    try {
      const snapResult = await runBrowserCommand(['snapshot', '-i']);
      snapshot = snapResult.stdout;
    } catch {
      // Snapshot may fail if page is still loading — that's okay
    }

    const output = [
      openResult.stdout,
      snapshot ? `\n--- Interactive Elements ---\n${snapshot}` : '',
    ].filter(Boolean).join('\n');

    return { output };
  } catch (err: any) {
    return { output: '', error: err.message };
  }
}

/**
 * Execute a browser action (click, fill, type, screenshot, scroll, etc.).
 */
export async function browseAction(
  action: string,
  args: string[]
): Promise<{ output: string; error?: string }> {
  try {
    const result = await runBrowserCommand([action, ...args]);
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    return { output };
  } catch (err: any) {
    return { output: '', error: err.message };
  }
}

/**
 * Get the current page state / snapshot.
 */
export async function browseSnapshot(
  options?: { interactive?: boolean }
): Promise<{ output: string; error?: string }> {
  try {
    const args = ['snapshot'];
    if (options?.interactive) {
      args.push('-i');
    }
    const result = await runBrowserCommand(args);
    return { output: result.stdout };
  } catch (err: any) {
    return { output: '', error: err.message };
  }
}

/**
 * Close the browser session.
 */
export async function browseClose(): Promise<{ output: string; error?: string }> {
  try {
    const result = await runBrowserCommand(['close']);
    return { output: result.stdout || 'Browser session closed.' };
  } catch (err: any) {
    return { output: '', error: err.message };
  }
}
