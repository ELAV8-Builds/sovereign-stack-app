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

// ─── Background Tasks API ────────────────────────────────────────────

export interface AgentJob {
  id: string;
  agentId: string;
  agentName: string;
  message: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'paused';
  progress: {
    iteration: number;
    maxIterations: number;
    currentTool?: string;
    lastThinking?: string;
  };
  result?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface QueueInfo {
  running: number;
  queued: number;
  completed: number;
  failed: number;
  maxConcurrency: number;
  systemLoad: number;
  backoffActive: boolean;
  system: {
    cpuCount: number;
    loadAvg: number;
    loadPercent: number;
    memFreeGB: number;
  };
}

export async function submitAgentTask(agentId: string, message: string): Promise<AgentJob> {
  const res = await fetch(`${API_BASE}/fleet/agents/${agentId}/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Failed to submit task (${res.status})`);
  }

  return res.json();
}

export async function getAgentTasks(agentId: string): Promise<AgentJob[]> {
  try {
    const res = await fetch(`${API_BASE}/fleet/agents/${agentId}/tasks`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.jobs || [];
  } catch {
    return [];
  }
}

export async function getJobStatus(jobId: string): Promise<AgentJob | null> {
  try {
    const res = await fetch(`${API_BASE}/fleet/jobs/${jobId}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function cancelAgentJob(jobId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/fleet/jobs/${jobId}/cancel`, {
    method: 'POST',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Failed to cancel job (${res.status})`);
  }
}

export async function getQueueInfo(): Promise<QueueInfo> {
  try {
    const res = await fetch(`${API_BASE}/fleet/queue`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error('Failed');
    return res.json();
  } catch {
    return {
      running: 0,
      queued: 0,
      completed: 0,
      failed: 0,
      maxConcurrency: 5,
      systemLoad: 0,
      backoffActive: false,
      system: { cpuCount: 0, loadAvg: 0, loadPercent: 0, memFreeGB: 0 },
    };
  }
}
