/**
 * Schedule — Client API
 *
 * Communicates with /api/sovereign/schedule/* endpoints
 * to manage scheduled tasks.
 */

const API_BASE = '/api/sovereign';

// ─── Types ───────────────────────────────────────────────────────────

export interface ScheduledTask {
  id: string;
  agent_id: string | null;
  name: string;
  message: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  max_runs: number | null;
  runs_count: number;
  created_at: string;
  updated_at: string;
}

export interface TaskRun {
  id: string;
  task_id: string;
  status: string;
  result: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface CreateScheduledTaskRequest {
  name: string;
  message: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  agent_id?: string;
  max_runs?: number;
  is_active?: boolean;
}

export interface UpdateScheduledTaskRequest {
  name?: string;
  message?: string;
  schedule_type?: 'cron' | 'interval' | 'once';
  schedule_value?: string;
  agent_id?: string;
  max_runs?: number;
  is_active?: boolean;
}

// ─── API Functions ───────────────────────────────────────────────────

export async function listScheduledTasks(agentId?: string): Promise<ScheduledTask[]> {
  try {
    const params = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : '';
    const res = await fetch(`${API_BASE}/schedule${params}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.tasks || [];
  } catch {
    return [];
  }
}

export async function getScheduledTask(id: string): Promise<ScheduledTask | null> {
  try {
    const res = await fetch(`${API_BASE}/schedule/${id}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function createScheduledTask(req: CreateScheduledTaskRequest): Promise<ScheduledTask> {
  const res = await fetch(`${API_BASE}/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Failed to create task (${res.status})`);
  }

  return res.json();
}

export async function updateScheduledTask(id: string, updates: UpdateScheduledTaskRequest): Promise<ScheduledTask> {
  const res = await fetch(`${API_BASE}/schedule/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Failed to update task (${res.status})`);
  }

  return res.json();
}

export async function deleteScheduledTask(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/schedule/${id}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Failed to delete task (${res.status})`);
  }
}

export async function pauseScheduledTask(id: string): Promise<ScheduledTask> {
  const res = await fetch(`${API_BASE}/schedule/${id}/pause`, {
    method: 'POST',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Failed to pause task (${res.status})`);
  }

  return res.json();
}

export async function resumeScheduledTask(id: string): Promise<ScheduledTask> {
  const res = await fetch(`${API_BASE}/schedule/${id}/resume`, {
    method: 'POST',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Failed to resume task (${res.status})`);
  }

  return res.json();
}

export async function getTaskRuns(taskId: string): Promise<TaskRun[]> {
  try {
    const res = await fetch(`${API_BASE}/schedule/${taskId}/runs`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.runs || [];
  } catch {
    return [];
  }
}
