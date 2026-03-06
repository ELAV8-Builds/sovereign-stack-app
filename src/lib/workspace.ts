/**
 * Workspace API Client — CRUD + build/deploy for workspaces
 */

const API_BASE = '/api/sovereign';

// ── Types ──────────────────────────────────────────────────────────────

export interface WorkspaceTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  template: string;
  description: string;
  path: string;
  status: string;
  build_status: Record<string, unknown>;
  deploy_status: Record<string, unknown>;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface BuildStep {
  name: string;
  status: 'pass' | 'fail' | 'skip' | 'running';
  output: string;
  duration_ms: number;
}

export interface BuildReport {
  id: string;
  workspace_id: string;
  status: 'passing' | 'failing' | 'warning' | 'running';
  steps: BuildStep[];
  tier: 'small' | 'medium' | 'large';
  created_at: string;
}

// ── Workspace CRUD ─────────────────────────────────────────────────────

export async function listWorkspaces(): Promise<Workspace[]> {
  const res = await fetch(`${API_BASE}/workspaces`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `Failed to list workspaces: ${res.status}`);
  }
  return res.json();
}

export async function createWorkspace(
  name: string,
  template: string,
  description?: string,
): Promise<Workspace> {
  const res = await fetch(`${API_BASE}/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, template, description }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `Failed to create workspace: ${res.status}`);
  }
  return res.json();
}

export async function getWorkspace(id: string): Promise<Workspace> {
  const res = await fetch(`${API_BASE}/workspaces/${id}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `Failed to get workspace: ${res.status}`);
  }
  return res.json();
}

export async function deleteWorkspace(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/workspaces/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `Failed to delete workspace: ${res.status}`);
  }
}

// ── Templates ──────────────────────────────────────────────────────────

export async function listTemplates(): Promise<WorkspaceTemplate[]> {
  const res = await fetch(`${API_BASE}/workspaces/templates`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `Failed to list templates: ${res.status}`);
  }
  return res.json();
}

// ── Build & Deploy ─────────────────────────────────────────────────────

export async function validateWorkspace(id: string): Promise<BuildReport> {
  const res = await fetch(`${API_BASE}/workspaces/${id}/validate`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `Failed to validate workspace: ${res.status}`);
  }
  return res.json();
}

export async function deployWorkspace(
  id: string,
  target: string,
): Promise<any> {
  const res = await fetch(`${API_BASE}/workspaces/${id}/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `Failed to deploy workspace: ${res.status}`);
  }
  return res.json();
}
