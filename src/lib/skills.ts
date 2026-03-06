/**
 * Skills API Client
 *
 * Fetches skill data from the Sovereign Stack API.
 * In dev, Vite proxy forwards /api/sovereign/* → API at :3100.
 */

// ─── Types ───────────────────────────────────────────────────────────────

export interface SkillInfo {
  name: string;
  version: string;
  description: string;
  category: string;
  tags: string[];
  installed: boolean;
  hasUpdate: boolean;
  source: 'local' | 'exchange' | 'both';
}

export interface SkillsResponse {
  skills: SkillInfo[];
  stats: {
    installed: number;
    available: number;
    updates: number;
    total: number;
  };
}

export interface SkillDetail {
  name: string;
  installed: boolean;
  content: string;
}

// ─── Config ──────────────────────────────────────────────────────────────

const API_BASE = '/api/sovereign';

// ─── API Functions ───────────────────────────────────────────────────────

/**
 * Fetch all skills (installed + available from exchange).
 */
export async function fetchSkills(): Promise<SkillsResponse> {
  const response = await fetch(`${API_BASE}/skills`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch skills: ${response.status}`);
  }
  return response.json();
}

/**
 * Fetch a single skill's full details (SKILL.md content).
 */
export async function fetchSkillDetail(name: string): Promise<SkillDetail> {
  const response = await fetch(`${API_BASE}/skills/${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch skill "${name}": ${response.status}`);
  }
  return response.json();
}

/**
 * Install a skill from the exchange.
 */
export async function installSkill(name: string): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/skills/${encodeURIComponent(name)}/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(data.error || `Install failed: ${response.status}`);
  }
  return response.json();
}

/**
 * Update a skill from the exchange.
 */
export async function updateSkill(name: string): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/skills/${encodeURIComponent(name)}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(data.error || `Update failed: ${response.status}`);
  }
  return response.json();
}

/**
 * Remove a locally installed skill.
 */
export async function removeSkill(name: string): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/skills/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(data.error || `Remove failed: ${response.status}`);
  }
  return response.json();
}
