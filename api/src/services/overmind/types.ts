// ============================================================================
// Overmind Subsystem — Type Definitions
// ============================================================================
// These types mirror the Postgres schema exactly. Union types are used for
// enums because we execute raw SQL through pg, not an ORM.
// ============================================================================

// ---------------------------------------------------------------------------
// Enums (as union types)
// ---------------------------------------------------------------------------

/** Physical or logical location where an agent container runs. */
export type AgentLocation = 'local' | 'remote' | 'cloud';

/** Health status of an agent as determined by the heartbeat loop. */
export type AgentStatus = 'healthy' | 'unhealthy' | 'quarantined';

/** Channel through which a job was originally submitted. */
export type JobSource = 'web' | 'slack' | 'api';

/** Lifecycle status of a top-level job. */
export type JobStatus =
  | 'pending'
  | 'planning'
  | 'running'
  | 'needs_review'
  | 'completed'
  | 'failed';

/** The kind of work a task represents within a job. */
export type TaskType = 'spec' | 'implementation' | 'cleanup' | 'test' | 'deploy';

/** Lifecycle status of an individual task. */
export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'awaiting_cleanup'
  | 'iterating'
  | 'completed'
  | 'escalated'
  | 'failed';

/** The kind of deliverable the job produces. */
export type TargetType = 'web_app' | 'mobile_app' | 'website' | 'desktop_app' | 'other';

/** How severe the issues found during a cleanup scan are. */
export type CleanupSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** Role of a message within a conversation thread. */
export type MessageRole = 'user' | 'system' | 'agent' | 'overmind';

// ---------------------------------------------------------------------------
// Entity Interfaces
// ---------------------------------------------------------------------------

/**
 * A registered build agent (container) that can execute tasks.
 *
 * Table: `agents`
 */
export interface OvAgent {
  /** UUID primary key. */
  id: string;
  /** Human-readable agent name (unique). */
  name: string;
  /** Where the agent is running. */
  location: AgentLocation;
  /** Current health status. */
  status: AgentStatus;
  /** Reachable endpoint for the agent (e.g. `http://host:port`). */
  endpoint: string;
  /** Maximum number of concurrent tasks this agent can handle. */
  max_concurrent_tasks: number;
  /** Number of tasks currently assigned and running on this agent. */
  current_load: number;
  /** Last time the agent sent a heartbeat. */
  last_heartbeat: Date;
  /** Timestamp when the agent was registered. */
  created_at: Date;
  /** Timestamp of the most recent update. */
  updated_at: Date;
}

/**
 * A top-level job submitted by a user. A job is broken into one or more tasks.
 *
 * Table: `jobs`
 */
export interface OvJob {
  /** UUID primary key. */
  id: string;
  /** Short human-readable title. */
  title: string;
  /** Full description / prompt provided by the user. */
  description: string;
  /** Channel through which the job was submitted. */
  source: JobSource;
  /** Current lifecycle status. */
  status: JobStatus;
  /** Category FK (nullable — uncategorised jobs). */
  category_id: string | null;
  /** What kind of deliverable is being built. */
  target_type: TargetType;
  /** Technology stack and build configuration. */
  config: JobConfig;
  /** ID of the user who submitted the job (nullable for API-sourced jobs). */
  submitted_by: string | null;
  /** When the job was created. */
  created_at: Date;
  /** Last update timestamp. */
  updated_at: Date;
  /** When the job reached a terminal state (completed / failed). */
  completed_at: Date | null;
}

/**
 * An individual unit of work within a job, assigned to an agent.
 *
 * Table: `tasks`
 */
export interface OvTask {
  /** UUID primary key. */
  id: string;
  /** FK to the parent job. */
  job_id: string;
  /** FK to the assigned agent (null while pending/queued). */
  agent_id: string | null;
  /** What kind of work this task represents. */
  type: TaskType;
  /** Current lifecycle status. */
  status: TaskStatus;
  /** Execution order within the job (lower = earlier). */
  sequence: number;
  /** The skill to invoke for this task (e.g. `focused-builder`, `iterate`). */
  skill_name: string | null;
  /** Skill-specific configuration passed to the agent. */
  skill_config: Record<string, unknown>;
  /** The prompt / instructions sent to the agent. */
  prompt: string;
  /** Structured result payload returned by the agent on completion. */
  result: Record<string, unknown> | null;
  /** Current build-iteration count (used by the iterate loop). */
  iteration: number;
  /** Maximum iterations allowed before escalation. */
  max_iterations: number;
  /** Error message if the task failed. */
  error: string | null;
  /** When the agent started executing this task. */
  started_at: Date | null;
  /** When the task reached a terminal state. */
  completed_at: Date | null;
  /** Row creation timestamp. */
  created_at: Date;
  /** Last update timestamp. */
  updated_at: Date;
}

/**
 * A category used to group related jobs (e.g. "Marketing Site", "Internal Tools").
 *
 * Table: `categories`
 */
export interface OvCategory {
  /** UUID primary key. */
  id: string;
  /** Display name (unique). */
  name: string;
  /** Optional longer description. */
  description: string | null;
  /** Row creation timestamp. */
  created_at: Date;
}

/**
 * A reusable skill that agents can execute (registered in the skill catalogue).
 *
 * Table: `skills`
 */
export interface OvSkill {
  /** UUID primary key. */
  id: string;
  /** Unique skill identifier (e.g. `focused-builder`). */
  name: string;
  /** Human-readable description of what the skill does. */
  description: string | null;
  /** JSON schema describing the expected `skill_config` shape. */
  config_schema: Record<string, unknown>;
  /** Row creation timestamp. */
  created_at: Date;
}

/**
 * A named cleanup profile defining scan rules and thresholds.
 *
 * Table: `cleanup_profiles`
 */
export interface OvCleanupProfile {
  /** UUID primary key. */
  id: string;
  /** Unique profile name (e.g. `strict`, `permissive`). */
  name: string;
  /** Scan-level configuration (linters, severity gates, etc.). */
  scan_config: ScanConfig;
  /** Hard rules that must never be violated. */
  invariants: InvariantsConfig;
  /** Row creation timestamp. */
  created_at: Date;
  /** Last update timestamp. */
  updated_at: Date;
}

/**
 * The result of running a cleanup scan against a task's output.
 *
 * Table: `cleanup_reports`
 */
export interface OvCleanupReport {
  /** UUID primary key. */
  id: string;
  /** FK to the task that was scanned. */
  task_id: string;
  /** FK to the cleanup profile used for this scan. */
  profile_id: string;
  /** Highest severity issue found. */
  severity: CleanupSeverity;
  /** Structured list of individual findings. */
  findings: CleanupFinding[];
  /** Whether the scan passed the profile's thresholds. */
  passed: boolean;
  /** When the scan was executed. */
  created_at: Date;
}

/**
 * A conversation thread attached to a job (user <-> overmind dialogue).
 *
 * Table: `conversations`
 */
export interface OvConversation {
  /** UUID primary key. */
  id: string;
  /** FK to the job this conversation belongs to. */
  job_id: string;
  /** Optional title / subject line. */
  title: string | null;
  /** Row creation timestamp. */
  created_at: Date;
  /** Last update timestamp. */
  updated_at: Date;
}

/**
 * A single message within a conversation.
 *
 * Table: `messages`
 */
export interface OvMessage {
  /** UUID primary key. */
  id: string;
  /** FK to the parent conversation. */
  conversation_id: string;
  /** Who sent this message. */
  role: MessageRole;
  /** Message body (plain text or markdown). */
  content: string;
  /** Optional structured metadata (e.g. attached files, tool calls). */
  metadata: Record<string, unknown> | null;
  /** Row creation timestamp. */
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Sub-types used inside entities
// ---------------------------------------------------------------------------

/** A single finding within a cleanup report. */
export interface CleanupFinding {
  /** Rule or check that flagged this issue. */
  rule: string;
  /** Severity of this individual finding. */
  severity: CleanupSeverity;
  /** File path relative to the project root. */
  file: string | null;
  /** Line number (if applicable). */
  line: number | null;
  /** Human-readable description of the issue. */
  message: string;
}

// ---------------------------------------------------------------------------
// Config Types
// ---------------------------------------------------------------------------

/**
 * Build configuration stored in `jobs.config`.
 * Controls iteration limits, cleanup thresholds, and the workflow pipeline.
 */
export interface JobConfig {
  /** Minimum number of iterate cycles before a task can be marked complete. */
  min_iterations: number;
  /** Maximum iterations before the task is escalated or failed. */
  max_iterations: number;
  /** Severity thresholds that gate whether a cleanup scan passes. */
  cleanup_thresholds: CleanupThresholds;
  /** Optional ordered list of workflow steps (overrides the default pipeline). */
  workflow?: WorkflowStep[];
  /** Arbitrary extra configuration (e.g. env vars, feature flags). */
  [key: string]: unknown;
}

/** Severity gates for cleanup scans. */
export interface CleanupThresholds {
  /** Maximum number of `low` findings allowed before failing. */
  max_low: number;
  /** Maximum number of `medium` findings allowed before failing. */
  max_medium: number;
  /** Maximum number of `high` findings allowed before failing. */
  max_high: number;
  /** Whether any `critical` finding immediately fails the scan. */
  fail_on_critical: boolean;
}

/**
 * Configuration for a cleanup scan — what checks to run and how.
 * Stored in `cleanup_profiles.scan_config`.
 */
export interface ScanConfig {
  /** List of linter/checker identifiers to run (e.g. `eslint`, `tsc`, `lighthouse`). */
  linters: string[];
  /** Glob patterns for files to include in the scan. */
  include: string[];
  /** Glob patterns for files to exclude from the scan. */
  exclude: string[];
  /** Arbitrary extra scanner configuration. */
  [key: string]: unknown;
}

/**
 * Hard invariants that must never be violated, regardless of thresholds.
 * Stored in `cleanup_profiles.invariants`.
 */
export interface InvariantsConfig {
  /** TypeScript must compile with zero errors. */
  no_type_errors: boolean;
  /** The production build must succeed. */
  build_must_pass: boolean;
  /** No `console.log` statements in production code. */
  no_console_logs: boolean;
  /** Arbitrary additional invariant rules. */
  [key: string]: unknown;
}

/**
 * A single step in a job's workflow pipeline.
 * Steps are executed in order; each maps to a skill invocation.
 */
export interface WorkflowStep {
  /** The type of step (maps to TaskType). */
  type: TaskType;
  /** Skill to invoke for this step (if omitted, uses the default for the type). */
  skill_name?: string;
  /** Skill-specific configuration. */
  config?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Request / Input Types (API Endpoints)
// ---------------------------------------------------------------------------

/** Payload for creating a new job via POST /jobs. */
export interface CreateJobInput {
  /** Short title for the job. */
  title: string;
  /** Full description / prompt. */
  description: string;
  /** Channel through which the job is being submitted. */
  source: JobSource;
  /** Optional category ID to file the job under. */
  category_id?: string;
  /** Kind of deliverable. */
  target_type: TargetType;
  /** Build configuration overrides. */
  config?: Partial<JobConfig>;
}

/** Payload for creating a new category via POST /categories. */
export interface CreateCategoryInput {
  /** Display name for the category. */
  name: string;
  /** Optional description. */
  description?: string;
}

/** Payload for registering a new agent via POST /agents. */
export interface RegisterAgentInput {
  /** Human-readable agent name. */
  name: string;
  /** Where the agent is running. */
  location: AgentLocation;
  /** Reachable endpoint URL. */
  endpoint: string;
  /** Maximum concurrent tasks this agent supports. */
  max_concurrent_tasks?: number;
}

/** Payload for overriding task parameters before or during execution. */
export interface TaskOverrideInput {
  /** Override the skill to use. */
  skill_name?: string;
  /** Override skill configuration. */
  skill_config?: Record<string, unknown>;
  /** Override the prompt / instructions. */
  prompt?: string;
  /** Override the maximum iteration count. */
  max_iterations?: number;
}

/** Payload for updating a task's status (e.g. from an agent callback). */
export interface TaskStatusUpdate {
  /** New status to transition to. */
  status: TaskStatus;
  /** Structured result payload (required when status is `completed`). */
  result?: Record<string, unknown>;
  /** Error message (required when status is `failed` or `escalated`). */
  error?: string;
  /** Current iteration number (for `iterating` status). */
  iteration?: number;
}

/** Query parameters for GET /tasks/poll (agent polling for work). */
export interface PollTasksQuery {
  /** ID of the agent requesting work. */
  agent_id: string;
  /** Only return tasks of these types (comma-separated or array). */
  types?: TaskType[];
  /** Maximum number of tasks to claim in one poll. */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Response / Composite Types
// ---------------------------------------------------------------------------

/** A job together with all of its tasks. Returned by GET /jobs/:id. */
export interface JobWithTasks extends OvJob {
  /** All tasks belonging to this job, ordered by sequence. */
  tasks: OvTask[];
}

/** A task together with its cleanup reports. Returned by GET /tasks/:id. */
export interface TaskWithCleanup extends OvTask {
  /** Cleanup reports generated for this task, ordered by creation date. */
  cleanup_reports: OvCleanupReport[];
}

/** An agent with its current load information. Returned by GET /agents. */
export interface AgentWithLoad extends OvAgent {
  /** Tasks currently assigned to this agent. */
  assigned_tasks: OvTask[];
  /** Ratio of current_load to max_concurrent_tasks (0.0 – 1.0). */
  utilization: number;
}
