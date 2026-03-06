/**
 * Fleet Mode — Client API
 *
 * Communicates with /api/sovereign/fleet/* endpoints
 * to manage fleet agents.
 */

const API_BASE = '/api/sovereign';

// ─── Types ───────────────────────────────────────────────────────────

export interface FleetAgent {
  id: string;
  name: string;
  template: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  model: string;
  system_prompt: string;
  workspace_path: string;
  icon: string;
  config: { tools?: string[] };
  conversation_id: string;
  message_count: number;
  created_at: string;
  started_at: string | null;
  stopped_at: string | null;
  last_error: string | null;
}

export interface FleetTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  model: string;
  toolCount: number;
}

export interface FleetStats {
  total_agents: number;
  running_agents: number;
  stopped_agents: number;
  error_agents: number;
  template_types: number;
}

export interface CreateAgentRequest {
  name: string;
  template?: string;
  model?: string;
  customPrompt?: string;
}

// ─── API Functions ───────────────────────────────────────────────────

export async function getFleetTemplates(): Promise<FleetTemplate[]> {
  try {
    const res = await fetch(`${API_BASE}/fleet/templates`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.templates || [];
  } catch {
    return [];
  }
}

export async function getFleetAgents(): Promise<FleetAgent[]> {
  try {
    const res = await fetch(`${API_BASE}/fleet/agents`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.agents || [];
  } catch {
    return [];
  }
}

export async function createFleetAgent(req: CreateAgentRequest): Promise<FleetAgent> {
  const res = await fetch(`${API_BASE}/fleet/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Failed to create agent (${res.status})`);
  }

  return res.json();
}

export async function stopFleetAgent(agentId: string): Promise<FleetAgent> {
  const res = await fetch(`${API_BASE}/fleet/agents/${agentId}/stop`, {
    method: 'POST',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Failed to stop agent (${res.status})`);
  }

  return res.json();
}

export async function startFleetAgent(agentId: string): Promise<FleetAgent> {
  const res = await fetch(`${API_BASE}/fleet/agents/${agentId}/start`, {
    method: 'POST',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Failed to start agent (${res.status})`);
  }

  return res.json();
}

export async function deleteFleetAgent(agentId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/fleet/agents/${agentId}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Failed to delete agent (${res.status})`);
  }
}

export async function updateFleetAgent(
  agentId: string,
  updates: Partial<Pick<FleetAgent, 'name' | 'icon' | 'model' | 'status'>>
): Promise<FleetAgent> {
  const res = await fetch(`${API_BASE}/fleet/agents/${agentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Failed to update agent (${res.status})`);
  }

  return res.json();
}

export async function getFleetStats(): Promise<FleetStats> {
  try {
    const res = await fetch(`${API_BASE}/fleet/stats`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error('Failed');
    return res.json();
  } catch {
    return {
      total_agents: 0,
      running_agents: 0,
      stopped_agents: 0,
      error_agents: 0,
      template_types: 0,
    };
  }
}
