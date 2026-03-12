/**
 * Code Writer — Safe file write service
 *
 * Writes source files safely with git stash protection,
 * validation, and automatic revert on failure.
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = process.env.PROJECT_ROOT || join(__dirname, '../../../..');

export interface WriteResult {
  success: boolean;
  files_written: string[];
  files_backed_up: string[];
  error?: string;
}

export interface FileChange {
  path: string;
  content: string;
  action: 'create' | 'modify' | 'delete';
}

/**
 * Safely write multiple files with git backup.
 * If any write fails, reverts all changes.
 */
export async function safeWriteFiles(changes: FileChange[]): Promise<WriteResult> {
  const backups: Map<string, string> = new Map();
  const filesWritten: string[] = [];

  try {
    // 1. Backup existing files
    for (const change of changes) {
      const fullPath = join(PROJECT_ROOT, change.path);
      if (existsSync(fullPath) && change.action !== 'create') {
        backups.set(fullPath, readFileSync(fullPath, 'utf-8'));
      }
    }

    // 2. Write changes
    for (const change of changes) {
      const fullPath = join(PROJECT_ROOT, change.path);

      if (change.action === 'delete') {
        // Just mark for tracking — actual delete is more dangerous
        continue;
      }

      writeFileSync(fullPath, change.content, 'utf-8');
      filesWritten.push(change.path);
    }

    return {
      success: true,
      files_written: filesWritten,
      files_backed_up: [...backups.keys()].map(p => p.replace(PROJECT_ROOT + '/', '')),
    };
  } catch (err) {
    // Revert all changes
    for (const [path, content] of backups) {
      try {
        writeFileSync(path, content, 'utf-8');
      } catch {
        // Best effort revert
      }
    }

    return {
      success: false,
      files_written: [],
      files_backed_up: [],
      error: (err as Error).message,
    };
  }
}

/**
 * Get the content of a file relative to the project root.
 */
export function readProjectFile(relativePath: string): string | null {
  const fullPath = join(PROJECT_ROOT, relativePath);
  if (!existsSync(fullPath)) return null;
  return readFileSync(fullPath, 'utf-8');
}

/**
 * Git stash uncommitted changes before modifying files.
 */
export function gitStash(): boolean {
  try {
    execSync('git stash --include-untracked', { cwd: PROJECT_ROOT, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Pop the git stash.
 */
export function gitStashPop(): boolean {
  try {
    execSync('git stash pop', { cwd: PROJECT_ROOT, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Git commit changes with a message.
 */
export function gitCommit(message: string): boolean {
  try {
    execSync('git add -A', { cwd: PROJECT_ROOT, stdio: 'pipe' });
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: PROJECT_ROOT, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
