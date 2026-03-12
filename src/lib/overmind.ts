/**
 * Overmind API Client
 *
 * Communicates with the Overmind subsystem endpoints on the native API.
 * Proxy path: /api/sovereign/overmind/* → http://127.0.0.1:3100/api/overmind/*
 *
 * Safety: Hard limit of 5 fleet workers is enforced server-side.
 * The UI should reflect this and prevent unnecessary spawn requests.
 */

const API = '/api/sovereign';

// ─── Fleet Types ────────────────────────────────────────────────

export interface FleetWorker {
  id: string;
  name: string;
  url: string;
  status: 'healthy' | 'unhealthy' | 'quarantined' | 'restarting';
  capabilities: string[];
  current_load: number;
  max_load: number;
  context_usage: number;
  last_heartbeat: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface FleetStatus {
  total: number;
  healthy: number;
  unhealthy: number;
  quarantined: number;
  restarting: number;
  total_load: number;
  total_capacity: number;
  avg_context_usage: number;
}

export interface FleetSafety {
  max_workers: number;
  circuit_breaker_open: boolean;
  consecutive_failures: number;
  last_spawn_time: string | null;
  min_spawn_interval_ms: number;
}

export interface WorkerCommand {
  id: string;
  worker_id: string;
  command: 'checkpoint' | 'stop' | 'restart' | 'ping' | 'run_task' | 'update_config';
  status: 'pending' | 'acked' | 'running' | 'completed' | 'failed' | 'expired';
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface WorkerCheckpoint {
  id: string;
  worker_id: string;
  job_id: string | null;
  context_usage: number;
  reason: string;
  continue_file: string | null;
  summary: string;
  created_at: string;
}

// ─── Job Types ──────────────────────────────────────────────────

export interface OvJob {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'planning' | 'running' | 'needs_review' | 'completed' | 'failed';
  source: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface OvAgent {
  id: string;
  name: string;
  status: 'healthy' | 'unhealthy' | 'quarantined';
  capabilities: string[];
  current_load: number;
  max_parallel_jobs: number;
  compliance_score: number;
  created_at: string;
}

export interface OvRule {
  id: string;
  category: string;
  key: string;
  value: unknown;
  enabled: boolean;
  scope: string;
}

export interface OrchestratorStatus {
  running: boolean;
  tick_count: number;
  tick_interval_ms: number;
  started_at: string | null;
  last_tick: Record<string, unknown> | null;
}

// ─── Utility ────────────────────────────────────────────────────

async function apiGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
    throw new Error(err.error || err.message || `Request failed (${res.status})`);
  }
  return res.json();
}

async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${API}${path}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Delete failed' }));
    throw new Error(err.error || 'Delete failed');
  }
}

// ─── Fleet API ──────────────────────────────────────────────────

export async function getFleetWorkers(): Promise<FleetWorker[]> {
  const data = await apiGet<{ workers: FleetWorker[] }>('/overmind/fleet');
  return data?.workers || [];
}

export async function getFleetStatus(): Promise<FleetStatus | null> {
  return apiGet<FleetStatus>('/overmind/fleet/status');
}

export async function getFleetSafety(): Promise<FleetSafety | null> {
  return apiGet<FleetSafety>('/overmind/fleet/safety');
}

export async function registerFleetWorker(input: {
  name: string;
  url: string;
  capabilities?: string[];
  max_load?: number;
}): Promise<FleetWorker> {
  return apiPost<FleetWorker>('/overmind/fleet/register', input);
}

export async function removeFleetWorker(id: string): Promise<void> {
  return apiDelete(`/overmind/fleet/${id}`);
}

export async function requestWorkerCheckpoint(id: string): Promise<void> {
  await apiPost(`/overmind/fleet/${id}/checkpoint`);
}

export async function requestWorkerRestart(id: string): Promise<void> {
  await apiPost(`/overmind/fleet/${id}/restart`);
}

export async function requestWorkerStop(id: string): Promise<void> {
  await apiPost(`/overmind/fleet/${id}/stop`);
}

export async function resetFleetCircuitBreaker(): Promise<void> {
  await apiPost('/overmind/fleet/reset-circuit-breaker');
}

export async function getWorkerCommands(id: string): Promise<WorkerCommand[]> {
  const data = await apiGet<{ commands: WorkerCommand[] }>(`/overmind/fleet/${id}/commands/history`);
  return data?.commands || [];
}

export async function getWorkerCheckpoints(id: string): Promise<WorkerCheckpoint[]> {
  const data = await apiGet<{ checkpoints: WorkerCheckpoint[] }>(`/overmind/fleet/${id}/checkpoints`);
  return data?.checkpoints || [];
}

// ─── Jobs API ───────────────────────────────────────────────────

export async function getOvJobs(): Promise<OvJob[]> {
  const data = await apiGet<{ jobs: OvJob[] }>('/overmind/jobs');
  return data?.jobs || [];
}

export async function createOvJob(input: {
  title: string;
  description: string;
  source?: string;
}): Promise<OvJob> {
  return apiPost<OvJob>('/overmind/jobs', input);
}

export async function cancelOvJob(id: string): Promise<void> {
  await apiPost(`/overmind/jobs/${id}/cancel`);
}

// ─── Agents API ─────────────────────────────────────────────────

export async function getOvAgents(): Promise<OvAgent[]> {
  const data = await apiGet<{ agents: OvAgent[] }>('/overmind/agents');
  return data?.agents || [];
}

// ─── Rules API ──────────────────────────────────────────────────

export async function getOvRules(): Promise<OvRule[]> {
  const data = await apiGet<{ rules: OvRule[] }>('/overmind/rules');
  return data?.rules || [];
}

export async function updateOvRule(id: string, updates: Partial<OvRule>): Promise<OvRule> {
  return apiPost<OvRule>(`/overmind/rules/${id}`, updates);
}

export async function createOvRule(rule: {
  category: string;
  key: string;
  value: unknown;
  enabled?: boolean;
  scope?: string;
}): Promise<OvRule> {
  return apiPost<OvRule>('/overmind/rules', rule);
}

export async function deleteOvRule(id: string): Promise<void> {
  return apiDelete(`/overmind/rules/${id}`);
}

export async function applyRulePreset(name: 'strict' | 'normal' | 'permissive'): Promise<{
  applied: boolean;
  preset: string;
  rules: OvRule[];
  count: number;
}> {
  return apiPost(`/overmind/rules/preset/${name}`);
}

export async function seedDefaultRules(): Promise<{
  seeded: boolean;
  rules: OvRule[];
  count: number;
}> {
  return apiPost('/overmind/rules/seed');
}

// ─── Rule Versions API ─────────────────────────────────────────

export interface OvRuleVersion {
  id: string;
  version: number;
  category: string;
  snapshot: OvRule[];
  change_type: string;
  changed_by: string;
  reason: string | null;
  conversation_id: string | null;
  created_at: string;
}

export async function getRuleVersions(category?: string): Promise<OvRuleVersion[]> {
  const params = category ? `?category=${encodeURIComponent(category)}` : '';
  const data = await apiGet<{ versions: OvRuleVersion[] }>(`/overmind/versions${params}`);
  return data?.versions || [];
}

export async function getRuleVersion(id: string): Promise<OvRuleVersion | null> {
  return apiGet<OvRuleVersion>(`/overmind/versions/${id}`);
}

export async function rollbackRules(versionId: string): Promise<{
  rolled_back: boolean;
  category: string;
  restored_version: number;
  rules: OvRule[];
  count: number;
}> {
  return apiPost('/overmind/versions/rollback', { version_id: versionId });
}

export async function diffRuleVersions(v1: string, v2: string): Promise<{
  v1: { id: string; version: number; category: string; created_at: string };
  v2: { id: string; version: number; category: string; created_at: string };
  diff: { added: OvRule[]; removed: OvRule[]; changed: any[] };
}> {
  const data = await apiGet<any>(`/overmind/versions/diff/${v1}/${v2}`);
  return data || { v1: {}, v2: {}, diff: { added: [], removed: [], changed: [] } };
}

// ─── Deploy History API ────────────────────────────────────────

export interface OvDeployRecord {
  id: string;
  version: number;
  change_type: string;
  files_changed: Array<{ path: string; diff_summary?: string }>;
  reason: string | null;
  build_output: string | null;
  deploy_status: string;
  health_check: any;
  requested_by: string;
  created_at: string;
  rolled_back_at: string | null;
}

export async function getDeployHistory(): Promise<OvDeployRecord[]> {
  const data = await apiGet<{ deploys: OvDeployRecord[] }>('/overmind/deploys');
  return data?.deploys || [];
}

// ─── Health Events API ─────────────────────────────────────────

export interface OvHealthEvent {
  id: string;
  event_type: string;
  severity: string;
  source: string;
  message: string;
  metadata: any;
  created_at: string;
}

export async function getHealthEvents(limit?: number, severity?: string): Promise<OvHealthEvent[]> {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (severity) params.set('severity', severity);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const data = await apiGet<{ events: OvHealthEvent[] }>(`/overmind/health-events${qs}`);
  return data?.events || [];
}

// ─── System API ─────────────────────────────────────────────────

export async function getOrchestratorStatus(): Promise<OrchestratorStatus | null> {
  return apiGet<OrchestratorStatus>('/overmind/orchestrator/status');
}

// ─── Slack Listener API ─────────────────────────────────────────

export interface SlackListenerStatus {
  connected: boolean;
  botUserId: string | null;
  mode: 'socket_mode';
  webhook_configured: boolean;
}

export async function getSlackListenerStatus(): Promise<SlackListenerStatus | null> {
  return apiGet<SlackListenerStatus>('/overmind/slack/listener');
}

export async function reconnectSlackListener(): Promise<SlackListenerStatus> {
  return apiPost<SlackListenerStatus>('/overmind/slack/reconnect');
}
