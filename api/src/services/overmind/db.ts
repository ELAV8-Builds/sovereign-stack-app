// ============================================================================
// Overmind Subsystem — Database Service Layer
// ============================================================================
// Provides CRUD operations for all Overmind tables. Bridges the gap between
// the SQL schema (overmind_*.sql) and the TypeScript interfaces (types.ts).
// ============================================================================

import { readFileSync } from 'fs';
import { join } from 'path';
import { query, withClient } from '../database';
import type {
  OvCategory,
  OvCleanupProfile,
  OvCleanupReport,
  OvConversation,
  OvMessage,
  OvAgent,
  OvJob,
  OvTask,
  OvSkill,
  AgentStatus,
  JobStatus,
  TaskStatus,
  TaskType,
  JobSource,
  MessageRole,
  CreateCategoryInput,
  CreateJobInput,
  RegisterAgentInput,
  JobWithTasks,
  JobConfig,
  CleanupFinding,
  ScanConfig,
  InvariantsConfig,
} from './types';

// ---------------------------------------------------------------------------
// Row-to-Entity Mappers
// ---------------------------------------------------------------------------
// The SQL schema uses different column names than the TS interfaces.
// These mappers translate database rows into properly-typed entities.

function rowToAgent(row: any): OvAgent {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    status: row.status,
    endpoint: row.endpoint_url,
    max_concurrent_tasks: row.max_parallel_jobs,
    current_load: row.current_load,
    last_heartbeat: row.updated_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToJob(row: any): OvJob {
  const config: JobConfig = row.config && typeof row.config === 'object'
    ? row.config
    : { min_iterations: 1, max_iterations: 3, cleanup_thresholds: { max_low: 10, max_medium: 5, max_high: 0, fail_on_critical: true } };
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    source: row.source,
    status: row.status,
    category_id: row.category_id ?? null,
    target_type: config.target_type as any ?? 'web_app',
    config,
    submitted_by: row.created_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at ?? null,
  };
}

function rowToTask(row: any): OvTask {
  return {
    id: row.id,
    job_id: row.job_id,
    agent_id: row.assigned_agent_id ?? null,
    type: row.type,
    status: row.status,
    sequence: row.sequence ?? 0,
    skill_name: row.skill_name ?? null,
    skill_config: row.skill_config ?? {},
    prompt: typeof row.input_payload === 'string'
      ? row.input_payload
      : JSON.stringify(row.input_payload ?? {}),
    result: row.output_payload ?? null,
    iteration: row.iteration_count,
    max_iterations: row.max_iterations ?? 3,
    error: row.error ?? null,
    started_at: row.started_at ?? null,
    completed_at: row.completed_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToCategory(row: any): OvCategory {
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    created_at: row.created_at,
  };
}

function rowToSkill(row: any): OvSkill {
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    config_schema: row.tooling_config ?? {},
    created_at: row.created_at,
  };
}

function rowToCleanupProfile(row: any): OvCleanupProfile {
  return {
    id: row.id,
    name: row.name,
    scan_config: row.scan_config ?? { linters: [], include: [], exclude: [] },
    invariants: row.invariants ?? { no_type_errors: true, build_must_pass: true, no_console_logs: false },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToCleanupReport(row: any): OvCleanupReport {
  const rawFindings = row.raw_findings ?? {};
  const findings: CleanupFinding[] = Array.isArray(rawFindings)
    ? rawFindings
    : rawFindings.findings ?? [];
  return {
    id: row.id,
    task_id: row.task_id,
    profile_id: row.profile_id ?? row.id,
    severity: row.severity,
    findings,
    passed: row.passed ?? (row.severity === 'none' || row.severity === 'low'),
    created_at: row.created_at,
  };
}

function rowToConversation(row: any): OvConversation {
  return {
    id: row.id,
    job_id: row.job_id,
    title: row.title ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
  };
}

function rowToMessage(row: any): OvMessage {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role,
    content: row.content,
    metadata: row.metadata ?? null,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function createCategory(input: CreateCategoryInput): Promise<OvCategory> {
  const { rows } = await query(
    `INSERT INTO overmind_categories (name, description)
     VALUES ($1, $2)
     RETURNING *`,
    [input.name, input.description ?? '']
  );
  return rowToCategory(rows[0]);
}

export async function getCategory(id: string): Promise<OvCategory | null> {
  const { rows } = await query(
    `SELECT * FROM overmind_categories WHERE id = $1`,
    [id]
  );
  return rows.length > 0 ? rowToCategory(rows[0]) : null;
}

export async function listCategories(): Promise<OvCategory[]> {
  const { rows } = await query(
    `SELECT * FROM overmind_categories ORDER BY created_at DESC`
  );
  return rows.map(rowToCategory);
}

// ---------------------------------------------------------------------------
// Cleanup Profiles
// ---------------------------------------------------------------------------

export async function createCleanupProfile(data: Partial<OvCleanupProfile>): Promise<OvCleanupProfile> {
  const { rows } = await query(
    `INSERT INTO overmind_cleanup_profiles (name, target_type, scan_config, invariants)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [
      data.name ?? 'default',
      'web_app',
      JSON.stringify(data.scan_config ?? {}),
      JSON.stringify(data.invariants ?? {}),
    ]
  );
  return rowToCleanupProfile(rows[0]);
}

export async function getCleanupProfile(id: string): Promise<OvCleanupProfile | null> {
  const { rows } = await query(
    `SELECT * FROM overmind_cleanup_profiles WHERE id = $1`,
    [id]
  );
  return rows.length > 0 ? rowToCleanupProfile(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export async function createSkill(data: Partial<OvSkill>): Promise<OvSkill> {
  const { rows } = await query(
    `INSERT INTO overmind_skills (name, description, tooling_config)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [
      data.name ?? 'unnamed',
      data.description ?? '',
      JSON.stringify(data.config_schema ?? {}),
    ]
  );
  return rowToSkill(rows[0]);
}

export async function listSkills(categoryId?: string): Promise<OvSkill[]> {
  if (categoryId) {
    const { rows } = await query(
      `SELECT * FROM overmind_skills WHERE category_id = $1 ORDER BY created_at DESC`,
      [categoryId]
    );
    return rows.map(rowToSkill);
  }
  const { rows } = await query(
    `SELECT * FROM overmind_skills ORDER BY created_at DESC`
  );
  return rows.map(rowToSkill);
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export async function registerAgent(input: RegisterAgentInput): Promise<OvAgent> {
  const { rows } = await query(
    `INSERT INTO overmind_agents (name, location, endpoint_url, max_parallel_jobs)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO UPDATE SET
       location = EXCLUDED.location,
       endpoint_url = EXCLUDED.endpoint_url,
       max_parallel_jobs = EXCLUDED.max_parallel_jobs,
       status = 'healthy',
       updated_at = NOW()
     RETURNING *`,
    [
      input.name,
      input.location,
      input.endpoint,
      input.max_concurrent_tasks ?? 1,
    ]
  );
  return rowToAgent(rows[0]);
}

export async function getAgent(id: string): Promise<OvAgent | null> {
  const { rows } = await query(
    `SELECT * FROM overmind_agents WHERE id = $1`,
    [id]
  );
  return rows.length > 0 ? rowToAgent(rows[0]) : null;
}

export async function listAgents(): Promise<OvAgent[]> {
  const { rows } = await query(
    `SELECT * FROM overmind_agents ORDER BY created_at DESC`
  );
  return rows.map(rowToAgent);
}

export async function updateAgentStatus(id: string, status: AgentStatus): Promise<void> {
  await query(
    `UPDATE overmind_agents SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, id]
  );
}

export async function updateAgentLoad(id: string, load: number): Promise<void> {
  await query(
    `UPDATE overmind_agents SET current_load = $1, updated_at = NOW() WHERE id = $2`,
    [load, id]
  );
}

export async function updateAgentHeartbeat(id: string): Promise<void> {
  await query(
    `UPDATE overmind_agents SET updated_at = NOW() WHERE id = $1`,
    [id]
  );
}

export async function decrementComplianceScore(id: string, amount: number): Promise<void> {
  await query(
    `UPDATE overmind_agents
     SET compliance_score = GREATEST(0, compliance_score - $1), updated_at = NOW()
     WHERE id = $2`,
    [amount, id]
  );
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function createJob(input: CreateJobInput): Promise<OvJob> {
  const config: Record<string, unknown> = {
    min_iterations: 1,
    max_iterations: 3,
    cleanup_thresholds: { max_low: 10, max_medium: 5, max_high: 0, fail_on_critical: true },
    target_type: input.target_type,
    ...input.config,
  };

  const { rows } = await query(
    `INSERT INTO overmind_jobs (title, description, source, category_id, config)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.title,
      input.description,
      input.source,
      input.category_id ?? null,
      JSON.stringify(config),
    ]
  );
  return rowToJob(rows[0]);
}

export async function getJob(id: string): Promise<OvJob | null> {
  const { rows } = await query(
    `SELECT * FROM overmind_jobs WHERE id = $1`,
    [id]
  );
  return rows.length > 0 ? rowToJob(rows[0]) : null;
}

export async function getJobWithTasks(id: string): Promise<JobWithTasks | null> {
  const job = await getJob(id);
  if (!job) return null;
  const tasks = await getTasksForJob(id);
  return { ...job, tasks };
}

export async function listJobs(status?: JobStatus): Promise<OvJob[]> {
  if (status) {
    const { rows } = await query(
      `SELECT * FROM overmind_jobs WHERE status = $1 ORDER BY created_at DESC`,
      [status]
    );
    return rows.map(rowToJob);
  }
  const { rows } = await query(
    `SELECT * FROM overmind_jobs ORDER BY created_at DESC`
  );
  return rows.map(rowToJob);
}

export async function updateJobStatus(id: string, status: JobStatus): Promise<void> {
  await query(
    `UPDATE overmind_jobs SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, id]
  );
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function createTask(
  jobId: string,
  type: TaskType,
  data?: Partial<OvTask>
): Promise<OvTask> {
  const { rows } = await query(
    `INSERT INTO overmind_tasks (job_id, type, status, input_payload, iteration_count)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      jobId,
      type,
      data?.status ?? 'pending',
      JSON.stringify(data?.prompt ?? data?.skill_config ?? {}),
      data?.iteration ?? 0,
    ]
  );
  return rowToTask(rows[0]);
}

export async function getTask(id: string): Promise<OvTask | null> {
  const { rows } = await query(
    `SELECT * FROM overmind_tasks WHERE id = $1`,
    [id]
  );
  return rows.length > 0 ? rowToTask(rows[0]) : null;
}

export async function getTasksForJob(jobId: string): Promise<OvTask[]> {
  const { rows } = await query(
    `SELECT * FROM overmind_tasks WHERE job_id = $1 ORDER BY created_at ASC`,
    [jobId]
  );
  return rows.map(rowToTask);
}

export async function assignTask(taskId: string, agentId: string): Promise<void> {
  await query(
    `UPDATE overmind_tasks
     SET assigned_agent_id = $1, status = 'queued', updated_at = NOW()
     WHERE id = $2`,
    [agentId, taskId]
  );
}

export async function updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
  await query(
    `UPDATE overmind_tasks SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, taskId]
  );
}

export async function incrementTaskIteration(taskId: string): Promise<number> {
  const { rows } = await query(
    `UPDATE overmind_tasks
     SET iteration_count = iteration_count + 1, updated_at = NOW()
     WHERE id = $1
     RETURNING iteration_count`,
    [taskId]
  );
  return rows[0].iteration_count;
}

export async function completeTask(taskId: string, result: Record<string, unknown>): Promise<void> {
  await query(
    `UPDATE overmind_tasks
     SET status = 'completed', output_payload = $1, completed_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(result), taskId]
  );
}

export async function failTask(taskId: string, error: string): Promise<void> {
  await query(
    `UPDATE overmind_tasks
     SET error = $1, completed_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [error, taskId]
  );
}

export async function overrideTask(
  taskId: string,
  overrides: {
    skill_name?: string;
    skill_config?: Record<string, unknown>;
    prompt?: string;
    max_iterations?: number;
  }
): Promise<void> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (overrides.skill_name !== undefined) {
    updates.push(`skill_name = $${paramIdx++}`);
    values.push(overrides.skill_name);
  }
  if (overrides.skill_config !== undefined) {
    updates.push(`skill_config = $${paramIdx++}`);
    values.push(JSON.stringify(overrides.skill_config));
  }
  if (overrides.prompt !== undefined) {
    updates.push(`input_payload = $${paramIdx++}`);
    values.push(JSON.stringify(overrides.prompt));
  }
  if (overrides.max_iterations !== undefined) {
    updates.push(`max_iterations = $${paramIdx++}`);
    values.push(overrides.max_iterations);
  }

  if (updates.length === 0) return;

  updates.push(`updated_at = NOW()`);
  values.push(taskId);

  await query(
    `UPDATE overmind_tasks SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
    values
  );
}

export async function getStuckTasks(timeoutMinutes: number): Promise<OvTask[]> {
  const { rows } = await query(
    `SELECT * FROM overmind_tasks
     WHERE status IN ('running', 'iterating')
       AND updated_at < NOW() - ($1 || ' minutes')::INTERVAL
     ORDER BY updated_at ASC`,
    [timeoutMinutes.toString()]
  );
  return rows.map(rowToTask);
}

export async function pollTasks(
  agentId: string,
  types?: TaskType[],
  limit?: number
): Promise<OvTask[]> {
  const effectiveLimit = limit ?? 5;

  if (types && types.length > 0) {
    const { rows } = await query(
      `SELECT * FROM overmind_tasks
       WHERE status = 'queued'
         AND assigned_agent_id IS NULL
         AND type = ANY($1)
       ORDER BY created_at ASC
       LIMIT $2`,
      [types, effectiveLimit]
    );
    return rows.map(rowToTask);
  }

  const { rows } = await query(
    `SELECT * FROM overmind_tasks
     WHERE status = 'queued'
       AND assigned_agent_id IS NULL
     ORDER BY created_at ASC
     LIMIT $1`,
    [effectiveLimit]
  );
  return rows.map(rowToTask);
}

// ---------------------------------------------------------------------------
// Cleanup Reports
// ---------------------------------------------------------------------------

export async function createCleanupReport(data: Partial<OvCleanupReport>): Promise<OvCleanupReport> {
  const { rows } = await query(
    `INSERT INTO overmind_cleanup_reports (task_id, severity, raw_findings)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [
      data.task_id,
      data.severity ?? 'none',
      JSON.stringify(data.findings ?? []),
    ]
  );
  return rowToCleanupReport(rows[0]);
}

export async function getCleanupReportsForTask(taskId: string): Promise<OvCleanupReport[]> {
  const { rows } = await query(
    `SELECT * FROM overmind_cleanup_reports WHERE task_id = $1 ORDER BY created_at ASC`,
    [taskId]
  );
  return rows.map(rowToCleanupReport);
}

// ---------------------------------------------------------------------------
// Conversations / Messages
// ---------------------------------------------------------------------------

export async function createConversation(
  jobId: string,
  source: JobSource,
  externalThreadId?: string
): Promise<OvConversation> {
  const { rows } = await query(
    `INSERT INTO overmind_conversations (job_id, source, external_thread_id)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [jobId, source, externalThreadId ?? null]
  );
  return rowToConversation(rows[0]);
}

export async function listConversationsForJob(jobId: string): Promise<OvConversation[]> {
  const { rows } = await query(
    `SELECT * FROM overmind_conversations WHERE job_id = $1 ORDER BY created_at ASC`,
    [jobId]
  );
  return rows.map(rowToConversation);
}

export async function addMessage(
  conversationId: string,
  role: MessageRole,
  content: string
): Promise<OvMessage> {
  const { rows } = await query(
    `INSERT INTO overmind_messages (conversation_id, role, content)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [conversationId, role, content]
  );
  return rowToMessage(rows[0]);
}

export async function getMessages(conversationId: string): Promise<OvMessage[]> {
  const { rows } = await query(
    `SELECT * FROM overmind_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId]
  );
  return rows.map(rowToMessage);
}

// ---------------------------------------------------------------------------
// Rules CRUD
// ---------------------------------------------------------------------------

export interface OvRule {
  id: string;
  category: string;
  key: string;
  value: any;
  enabled: boolean;
  scope: string;
  created_at: Date;
  updated_at: Date;
}

function rowToRule(row: any): OvRule {
  return {
    id: row.id,
    category: row.category,
    key: row.key,
    value: typeof row.value === 'string' ? JSON.parse(row.value) : row.value,
    enabled: row.enabled,
    scope: row.scope,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listRules(category?: string, scope?: string): Promise<OvRule[]> {
  let sql = 'SELECT * FROM overmind_rules WHERE 1=1';
  const params: any[] = [];
  if (category) {
    params.push(category);
    sql += ` AND category = $${params.length}`;
  }
  if (scope) {
    params.push(scope);
    sql += ` AND scope = $${params.length}`;
  }
  sql += ' ORDER BY category, key';
  const { rows } = await query(sql, params);
  return rows.map(rowToRule);
}

export async function getRule(id: string): Promise<OvRule | null> {
  const { rows } = await query('SELECT * FROM overmind_rules WHERE id = $1', [id]);
  return rows.length > 0 ? rowToRule(rows[0]) : null;
}

export async function upsertRule(data: {
  category: string;
  key: string;
  value: any;
  enabled?: boolean;
  scope?: string;
}): Promise<OvRule> {
  const { rows } = await query(
    `INSERT INTO overmind_rules (category, key, value, enabled, scope)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (category, key, scope)
     DO UPDATE SET value = $3, enabled = $4, updated_at = NOW()
     RETURNING *`,
    [data.category, data.key, JSON.stringify(data.value), data.enabled ?? true, data.scope || 'global']
  );
  return rowToRule(rows[0]);
}

export async function deleteRule(id: string): Promise<boolean> {
  const result = await query('DELETE FROM overmind_rules WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function deleteRulesByCategory(category: string): Promise<number> {
  const result = await query('DELETE FROM overmind_rules WHERE category = $1', [category]);
  return result.rowCount ?? 0;
}

export async function getEnabledRules(scope: string = 'global'): Promise<OvRule[]> {
  const { rows } = await query(
    `SELECT * FROM overmind_rules WHERE enabled = true AND (scope = 'global' OR scope = $1) ORDER BY category, key`,
    [scope]
  );
  return rows.map(rowToRule);
}

// ---------------------------------------------------------------------------
// Rule Versions
// ---------------------------------------------------------------------------

export interface OvRuleVersion {
  id: string;
  version: number;
  category: string;
  snapshot: any;
  change_type: string;
  changed_by: string;
  reason: string | null;
  conversation_id: string | null;
  created_at: Date;
}

function rowToRuleVersion(row: any): OvRuleVersion {
  return {
    id: row.id,
    version: row.version,
    category: row.category,
    snapshot: typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : row.snapshot,
    change_type: row.change_type,
    changed_by: row.changed_by,
    reason: row.reason,
    conversation_id: row.conversation_id,
    created_at: row.created_at,
  };
}

export async function createRuleVersion(data: {
  category: string;
  snapshot: any;
  change_type: string;
  changed_by?: string;
  reason?: string;
  conversation_id?: string;
}): Promise<OvRuleVersion> {
  // Get next version number for this category
  const { rows: maxRows } = await query(
    'SELECT COALESCE(MAX(version), 0) as max_ver FROM overmind_rule_versions WHERE category = $1',
    [data.category]
  );
  const nextVersion = (maxRows[0]?.max_ver || 0) + 1;

  const { rows } = await query(
    `INSERT INTO overmind_rule_versions (version, category, snapshot, change_type, changed_by, reason, conversation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [nextVersion, data.category, JSON.stringify(data.snapshot), data.change_type, data.changed_by || 'system', data.reason || null, data.conversation_id || null]
  );
  return rowToRuleVersion(rows[0]);
}

export async function listRuleVersions(category?: string): Promise<OvRuleVersion[]> {
  let sql = 'SELECT * FROM overmind_rule_versions';
  const params: any[] = [];
  if (category) {
    params.push(category);
    sql += ' WHERE category = $1';
  }
  sql += ' ORDER BY created_at DESC LIMIT 100';
  const { rows } = await query(sql, params);
  return rows.map(rowToRuleVersion);
}

export async function getRuleVersion(id: string): Promise<OvRuleVersion | null> {
  const { rows } = await query('SELECT * FROM overmind_rule_versions WHERE id = $1', [id]);
  return rows.length > 0 ? rowToRuleVersion(rows[0]) : null;
}

export async function getLatestRuleVersion(category: string): Promise<OvRuleVersion | null> {
  const { rows } = await query(
    'SELECT * FROM overmind_rule_versions WHERE category = $1 ORDER BY version DESC LIMIT 1',
    [category]
  );
  return rows.length > 0 ? rowToRuleVersion(rows[0]) : null;
}

/** Snapshot all rules in a category for versioning */
export async function snapshotRuleCategory(category: string, changeType: string, changedBy?: string, reason?: string): Promise<OvRuleVersion> {
  const rules = await listRules(category);
  return createRuleVersion({
    category,
    snapshot: rules,
    change_type: changeType,
    changed_by: changedBy,
    reason,
  });
}

// ---------------------------------------------------------------------------
// Deploy History
// ---------------------------------------------------------------------------

export interface OvDeployRecord {
  id: string;
  version: number;
  change_type: string;
  files_changed: any[];
  reason: string | null;
  conversation_id: string | null;
  build_output: string | null;
  deploy_status: string;
  health_check: any;
  requested_by: string;
  created_at: Date;
  rolled_back_at: Date | null;
}

function rowToDeployRecord(row: any): OvDeployRecord {
  return {
    id: row.id,
    version: row.version,
    change_type: row.change_type,
    files_changed: typeof row.files_changed === 'string' ? JSON.parse(row.files_changed) : row.files_changed,
    reason: row.reason,
    conversation_id: row.conversation_id,
    build_output: row.build_output,
    deploy_status: row.deploy_status,
    health_check: typeof row.health_check === 'string' ? JSON.parse(row.health_check) : row.health_check,
    requested_by: row.requested_by,
    created_at: row.created_at,
    rolled_back_at: row.rolled_back_at,
  };
}

export async function createDeployRecord(data: {
  change_type: string;
  files_changed: any[];
  reason?: string;
  requested_by?: string;
}): Promise<OvDeployRecord> {
  const { rows: maxRows } = await query('SELECT COALESCE(MAX(version), 0) as max_ver FROM overmind_deploy_history', []);
  const nextVersion = (maxRows[0]?.max_ver || 0) + 1;
  const { rows } = await query(
    `INSERT INTO overmind_deploy_history (version, change_type, files_changed, reason, requested_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [nextVersion, data.change_type, JSON.stringify(data.files_changed), data.reason || null, data.requested_by || 'beau']
  );
  return rowToDeployRecord(rows[0]);
}

export async function updateDeployRecord(id: string, updates: Partial<OvDeployRecord>): Promise<OvDeployRecord | null> {
  const setClauses: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  if (updates.deploy_status !== undefined) { setClauses.push(`deploy_status = $${paramIdx++}`); params.push(updates.deploy_status); }
  if (updates.build_output !== undefined) { setClauses.push(`build_output = $${paramIdx++}`); params.push(updates.build_output); }
  if (updates.health_check !== undefined) { setClauses.push(`health_check = $${paramIdx++}`); params.push(JSON.stringify(updates.health_check)); }
  if (updates.rolled_back_at !== undefined) { setClauses.push(`rolled_back_at = $${paramIdx++}`); params.push(updates.rolled_back_at); }

  if (setClauses.length === 0) return null;
  params.push(id);
  const { rows } = await query(`UPDATE overmind_deploy_history SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`, params);
  return rows.length > 0 ? rowToDeployRecord(rows[0]) : null;
}

export async function listDeployRecords(limit: number = 50): Promise<OvDeployRecord[]> {
  const { rows } = await query('SELECT * FROM overmind_deploy_history ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows.map(rowToDeployRecord);
}

// ---------------------------------------------------------------------------
// Health Events
// ---------------------------------------------------------------------------

export interface OvHealthEvent {
  id: string;
  event_type: string;
  severity: string;
  source: string;
  message: string;
  metadata: any;
  created_at: Date;
}

function rowToHealthEvent(row: any): OvHealthEvent {
  return {
    id: row.id,
    event_type: row.event_type,
    severity: row.severity,
    source: row.source,
    message: row.message,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    created_at: row.created_at,
  };
}

export async function logHealthEvent(data: {
  event_type: string;
  severity?: string;
  source?: string;
  message: string;
  metadata?: any;
}): Promise<OvHealthEvent> {
  const { rows } = await query(
    `INSERT INTO overmind_health_events (event_type, severity, source, message, metadata)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [data.event_type, data.severity || 'info', data.source || 'orchestrator', data.message, JSON.stringify(data.metadata || {})]
  );
  return rowToHealthEvent(rows[0]);
}

export async function listHealthEvents(limit: number = 100, severity?: string): Promise<OvHealthEvent[]> {
  let sql = 'SELECT * FROM overmind_health_events';
  const params: any[] = [];
  if (severity) { params.push(severity); sql += ' WHERE severity = $1'; }
  sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
  params.push(limit);
  const { rows } = await query(sql, params);
  return rows.map(rowToHealthEvent);
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export async function runMigration(): Promise<void> {
  const sqlPath = join(__dirname, '../../../../config/overmind-init.sql');
  const sql = readFileSync(sqlPath, 'utf-8');
  await withClient(async (client) => {
    await client.query(sql);
  });
}
