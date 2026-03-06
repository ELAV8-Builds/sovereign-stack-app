/**
 * RAG / Knowledge Base API — Frontend client
 *
 * Talks to /api/sovereign/rag/* endpoints.
 * Handles workspaces, document uploads, and queries.
 */

const API_BASE = "/api/sovereign/rag";

// ── Types ────────────────────────────────────────────────

export interface RAGStatus {
  connected: boolean;
  error?: string;
  workspaces: Array<{
    id: number;
    name: string;
    slug: string;
    documentCount: number;
  }>;
  system: {
    vectorDB: string;
    embeddingEngine: string;
  } | null;
}

export interface RAGWorkspace {
  id: number;
  name: string;
  slug: string;
  createdAt: string;
  documents: any[];
  threads: any[];
}

export interface RAGQueryResult {
  answer: string;
  sources: Array<{
    title: string;
    text: string;
    score?: number;
  }>;
  workspace: string;
  error?: string;
}

export interface RAGDocuments {
  documents: {
    name: string;
    type: string;
    items: any[];
  };
}

// ── Status ───────────────────────────────────────────────

export async function getRAGStatus(): Promise<RAGStatus> {
  const res = await fetch(`${API_BASE}/status`);
  if (!res.ok) throw new Error(`RAG status check failed: ${res.status}`);
  return res.json();
}

// ── Workspaces ───────────────────────────────────────────

export async function listWorkspaces(): Promise<RAGWorkspace[]> {
  const res = await fetch(`${API_BASE}/workspaces`);
  if (!res.ok) throw new Error(`Failed to list workspaces: ${res.status}`);
  const data = await res.json();
  return data.workspaces;
}

export async function createWorkspace(name: string): Promise<RAGWorkspace> {
  const res = await fetch(`${API_BASE}/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to create workspace: ${res.status}`);
  const data = await res.json();
  return data.workspace;
}

export async function deleteWorkspace(slug: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/workspaces/${slug}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete workspace: ${res.status}`);
  const data = await res.json();
  return data.deleted;
}

// ── Documents ────────────────────────────────────────────

export async function getDocuments(): Promise<any> {
  const res = await fetch(`${API_BASE}/documents`);
  if (!res.ok) throw new Error(`Failed to list documents: ${res.status}`);
  return res.json();
}

export async function uploadFile(
  file: File,
  workspace?: string
): Promise<{ success: boolean; documents?: any[]; error?: string }> {
  const formData = new FormData();
  formData.append("file", file);
  if (workspace) formData.append("workspace", workspace);

  const res = await fetch(`${API_BASE}/documents/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error || `Upload failed: ${res.status}`);
  }

  return res.json();
}

export async function uploadText(
  title: string,
  content: string,
  workspace?: string
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/documents/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, content, workspace }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error || `Upload failed: ${res.status}`);
  }

  return res.json();
}

export async function embedDocuments(
  workspaceSlug: string,
  documents: string[]
): Promise<{ added: number }> {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceSlug}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documents }),
  });
  if (!res.ok) throw new Error(`Failed to embed documents: ${res.status}`);
  return res.json();
}

// ── RAG Query ────────────────────────────────────────────

export async function queryKnowledgeBase(
  question: string,
  workspace?: string,
  mode: "query" | "chat" = "query"
): Promise<RAGQueryResult> {
  const res = await fetch(`${API_BASE}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, workspace, mode }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Query failed" }));
    throw new Error(err.error || `Query failed: ${res.status}`);
  }

  return res.json();
}
