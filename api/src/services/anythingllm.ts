/**
 * AnythingLLM Service — RAG / Document Knowledge Base
 *
 * Wraps the AnythingLLM REST API for:
 * - Workspace management (list, create)
 * - Document upload + embedding
 * - RAG-powered chat queries
 * - Document listing + deletion
 *
 * API key is fetched from the encrypted key vault at runtime.
 */
import { query } from './database';
import { logActivity } from './activity-broadcaster';
import crypto from 'crypto';

// ── Configuration ────────────────────────────────────────

const ANYTHINGLLM_URL = process.env.ANYTHINGLLM_URL || 'http://localhost:3001';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

// ── Key Vault Helper ─────────────────────────────────────

function decrypt(text: string): string {
  const [ivHex, authTagHex, encrypted] = text.split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(ENCRYPTION_KEY, 'hex').subarray(0, 32),
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Get AnythingLLM API key from the encrypted vault.
 * Falls back to env var ANYTHINGLLM_API_KEY if vault is empty.
 */
async function getApiKey(): Promise<string | null> {
  try {
    const result = await query(
      `SELECT value, encrypted FROM settings WHERE key = 'vault.anythingllm'`
    );
    if (result.rows.length > 0) {
      const row = result.rows[0];
      return row.encrypted ? decrypt(row.value) : row.value;
    }
  } catch {
    // DB might be down
  }

  // Fallback to env
  return process.env.ANYTHINGLLM_API_KEY || null;
}

// ── Types ────────────────────────────────────────────────

export interface ALLMWorkspace {
  id: number;
  name: string;
  slug: string;
  createdAt: string;
  openAiTemp: number | null;
  openAiHistory: number;
  openAiPrompt: string | null;
  documents: any[];
  threads: any[];
}

export interface ALLMDocument {
  name: string;
  type: string;
  id?: string;
  cached?: boolean;
  pinnedWorkspaces?: number[];
  chunkSource?: string;
  published?: string;
  wordCount?: number;
  token_count_estimate?: number;
}

export interface ALLMChatResponse {
  id: string;
  type: string;
  textResponse: string | null;
  sources: any[];
  close: boolean;
  error: string | null;
}

export interface ALLMQueryResult {
  answer: string;
  sources: Array<{
    title: string;
    text: string;
    score?: number;
  }>;
  error?: string;
}

// ── Core API Calls ───────────────────────────────────────

async function allm<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('AnythingLLM API key not configured. Add it in Settings → Security → Key Vault.');
  }

  const url = `${ANYTHINGLLM_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal: options.signal || AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`AnythingLLM API error (${response.status}): ${body}`);
  }

  return response.json() as Promise<T>;
}

// ── Health Check ─────────────────────────────────────────

export async function checkAnythingLLMHealth(): Promise<boolean> {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) return false;

    const response = await fetch(`${ANYTHINGLLM_URL}/api/v1/auth`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json() as { authenticated?: boolean };
    return data.authenticated === true;
  } catch {
    return false;
  }
}

// ── Workspace Operations ─────────────────────────────────

export async function listWorkspaces(): Promise<ALLMWorkspace[]> {
  const data = await allm<{ workspaces: ALLMWorkspace[] }>('/api/v1/workspaces');
  return data.workspaces || [];
}

export async function createWorkspace(name: string): Promise<ALLMWorkspace> {
  const data = await allm<{ workspace: ALLMWorkspace }>('/api/v1/workspace/new', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  logActivity('rag', 'success', `Workspace created: ${name}`);
  return data.workspace;
}

export async function getWorkspace(slug: string): Promise<ALLMWorkspace | null> {
  try {
    const data = await allm<{ workspace: ALLMWorkspace }>(`/api/v1/workspace/${slug}`);
    return data.workspace;
  } catch {
    return null;
  }
}

export async function deleteWorkspace(slug: string): Promise<boolean> {
  try {
    await allm(`/api/v1/workspace/${slug}`, { method: 'DELETE' });
    logActivity('rag', 'info', `Workspace deleted: ${slug}`);
    return true;
  } catch {
    return false;
  }
}

// ── Document Operations ──────────────────────────────────

/**
 * List all documents in the local file system of AnythingLLM
 */
export async function listDocuments(): Promise<any> {
  const data = await allm<{ localFiles: any }>('/api/v1/documents');
  return data.localFiles;
}

/**
 * Upload a document to AnythingLLM (raw file).
 * Uses multipart/form-data — different content type.
 */
export async function uploadDocument(
  file: Buffer,
  filename: string
): Promise<{ success: boolean; error?: string; documents?: any[] }> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('AnythingLLM API key not configured.');
  }

  const formData = new FormData();
  const blob = new Blob([file], { type: 'application/octet-stream' });
  formData.append('file', blob, filename);

  const response = await fetch(`${ANYTHINGLLM_URL}/api/v1/document/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
    signal: AbortSignal.timeout(60000), // 60s for large files
  });

  const data = await response.json() as { success: boolean; error?: string; documents?: any[] };

  if (!data.success) {
    logActivity('rag', 'error', `Document upload failed: ${filename} — ${data.error || 'unknown'}`);
  } else {
    logActivity('rag', 'success', `Document uploaded: ${filename}`);
  }

  return data;
}

/**
 * Upload raw text as a document
 */
export async function uploadTextDocument(
  title: string,
  content: string
): Promise<{ success: boolean; error?: string; documents?: any[] }> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('AnythingLLM API key not configured.');
  }

  const response = await fetch(`${ANYTHINGLLM_URL}/api/v1/document/raw-text`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      textContent: content,
      metadata: { title },
    }),
    signal: AbortSignal.timeout(30000),
  });

  const data = await response.json() as { success: boolean; error?: string; documents?: any[] };

  if (data.success) {
    logActivity('rag', 'success', `Text document uploaded: ${title}`);
  }

  return data;
}

/**
 * Embed (add) documents to a workspace for RAG
 */
export async function embedDocumentsToWorkspace(
  workspaceSlug: string,
  docPaths: string[]
): Promise<{ added: number; failed: number }> {
  const data = await allm<{ workspace: any }>(`/api/v1/workspace/${workspaceSlug}/update-embeddings`, {
    method: 'POST',
    body: JSON.stringify({ adds: docPaths, deletes: [] }),
  });

  logActivity('rag', 'success', `Embedded ${docPaths.length} document(s) to workspace: ${workspaceSlug}`);
  return { added: docPaths.length, failed: 0 };
}

/**
 * Remove documents from a workspace
 */
export async function removeDocumentsFromWorkspace(
  workspaceSlug: string,
  docPaths: string[]
): Promise<boolean> {
  await allm(`/api/v1/workspace/${workspaceSlug}/update-embeddings`, {
    method: 'POST',
    body: JSON.stringify({ adds: [], deletes: docPaths }),
  });
  logActivity('rag', 'info', `Removed ${docPaths.length} document(s) from workspace: ${workspaceSlug}`);
  return true;
}

// ── RAG Chat / Query ─────────────────────────────────────

/**
 * Send a chat message to a workspace with RAG context.
 * mode: 'chat' (conversational with history) or 'query' (document-only, no history)
 */
export async function queryWorkspace(
  workspaceSlug: string,
  question: string,
  mode: 'chat' | 'query' = 'query'
): Promise<ALLMQueryResult> {
  try {
    const data = await allm<ALLMChatResponse>(`/api/v1/workspace/${workspaceSlug}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message: question, mode }),
    });

    if (data.error) {
      return { answer: '', sources: [], error: data.error };
    }

    const sources = (data.sources || []).map((s: any) => ({
      title: s.title || s.metadata?.title || 'Unknown',
      text: s.text || s.content || '',
      score: s.score,
    }));

    return {
      answer: data.textResponse || '',
      sources,
    };
  } catch (err) {
    return {
      answer: '',
      sources: [],
      error: (err as Error).message,
    };
  }
}

// ── Ensure Default Workspace ─────────────────────────────

const DEFAULT_WORKSPACE = 'sovereign';

/**
 * Ensure the default "sovereign" workspace exists.
 * Called on first RAG query if no workspace is specified.
 */
export async function ensureDefaultWorkspace(): Promise<string> {
  const workspaces = await listWorkspaces();
  const existing = workspaces.find(w => w.slug === DEFAULT_WORKSPACE);
  if (existing) return existing.slug;

  const ws = await createWorkspace('Sovereign');
  return ws.slug;
}

// ── System Info ──────────────────────────────────────────

export async function getSystemInfo(): Promise<any> {
  try {
    return await allm('/api/v1/system');
  } catch {
    return null;
  }
}
