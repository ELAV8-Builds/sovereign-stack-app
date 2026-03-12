-- ============================================================
-- Overmind Subsystem — PostgreSQL Migration
-- ============================================================
-- Adds the Overmind orchestration tables to the `sovereign` DB.
-- Assumes uuid-ossp and pgcrypto extensions already exist.
-- This script is idempotent — safe to run multiple times.
-- ============================================================

-- --------------------------------------------------------
-- 1. overmind_cleanup_profiles
--    (created before overmind_categories which references it)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS overmind_cleanup_profiles (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT        NOT NULL,
    target_type     TEXT        NOT NULL CHECK (target_type IN ('web_app', 'mobile_app', 'website', 'desktop_app', 'other')),
    scan_config     JSONB       NOT NULL DEFAULT '{}',
    invariants      JSONB       NOT NULL DEFAULT '{}',
    llm_prompt_template TEXT    DEFAULT '',
    metadata        JSONB       DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overmind_cleanup_profiles_target_type
    ON overmind_cleanup_profiles(target_type);
CREATE INDEX IF NOT EXISTS idx_overmind_cleanup_profiles_created_at
    ON overmind_cleanup_profiles(created_at DESC);

-- --------------------------------------------------------
-- 2. overmind_categories
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS overmind_categories (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                TEXT        UNIQUE NOT NULL,
    description         TEXT        NOT NULL DEFAULT '',
    default_workflow    JSONB       NOT NULL DEFAULT '[]',
    cleanup_profile_id  UUID        REFERENCES overmind_cleanup_profiles(id) ON DELETE SET NULL,
    default_config      JSONB       NOT NULL DEFAULT '{}',
    metadata            JSONB       DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overmind_categories_cleanup_profile_id
    ON overmind_categories(cleanup_profile_id);
CREATE INDEX IF NOT EXISTS idx_overmind_categories_created_at
    ON overmind_categories(created_at DESC);

-- --------------------------------------------------------
-- 3. overmind_skills
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS overmind_skills (
    id                      UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id             UUID        REFERENCES overmind_categories(id) ON DELETE SET NULL,
    name                    TEXT        NOT NULL,
    description             TEXT        NOT NULL DEFAULT '',
    required_capabilities   JSONB       DEFAULT '[]',
    tooling_config          JSONB       DEFAULT '{}',
    skill_path              TEXT        DEFAULT '',
    metadata                JSONB       DEFAULT '{}',
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overmind_skills_category_id
    ON overmind_skills(category_id);
CREATE INDEX IF NOT EXISTS idx_overmind_skills_created_at
    ON overmind_skills(created_at DESC);

-- --------------------------------------------------------
-- 4. overmind_agents
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS overmind_agents (
    id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                TEXT          NOT NULL,
    endpoint_url        TEXT          NOT NULL DEFAULT '',
    auth_token          TEXT          DEFAULT '',
    capabilities        JSONB         DEFAULT '[]',
    location            TEXT          NOT NULL DEFAULT 'local' CHECK (location IN ('local', 'remote', 'cloud')),
    status              TEXT          NOT NULL DEFAULT 'healthy' CHECK (status IN ('healthy', 'unhealthy', 'quarantined')),
    max_parallel_jobs   INT           NOT NULL DEFAULT 1,
    current_load        INT           NOT NULL DEFAULT 0,
    compliance_score    NUMERIC(5,2)  NOT NULL DEFAULT 100.00,
    metadata            JSONB         DEFAULT '{}',
    created_at          TIMESTAMPTZ   DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overmind_agents_status
    ON overmind_agents(status);
CREATE INDEX IF NOT EXISTS idx_overmind_agents_location
    ON overmind_agents(location);
CREATE INDEX IF NOT EXISTS idx_overmind_agents_created_at
    ON overmind_agents(created_at DESC);

-- --------------------------------------------------------
-- 5. overmind_jobs
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS overmind_jobs (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_by          TEXT        NOT NULL DEFAULT 'system',
    source              TEXT        NOT NULL DEFAULT 'api' CHECK (source IN ('web', 'slack', 'api')),
    external_thread_id  TEXT,
    category_id         UUID        REFERENCES overmind_categories(id) ON DELETE SET NULL,
    title               TEXT        NOT NULL,
    description         TEXT        NOT NULL DEFAULT '',
    status              TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'planning', 'running', 'needs_review', 'completed', 'failed')),
    config              JSONB       NOT NULL DEFAULT '{}',
    spec_snapshot       JSONB       DEFAULT '{}',
    metadata            JSONB       DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overmind_jobs_status
    ON overmind_jobs(status);
CREATE INDEX IF NOT EXISTS idx_overmind_jobs_category_id
    ON overmind_jobs(category_id);
CREATE INDEX IF NOT EXISTS idx_overmind_jobs_source
    ON overmind_jobs(source);
CREATE INDEX IF NOT EXISTS idx_overmind_jobs_created_at
    ON overmind_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_overmind_jobs_external_thread_id
    ON overmind_jobs(external_thread_id);

-- --------------------------------------------------------
-- 6. overmind_tasks
--    (cleanup_reports FK added after that table is created)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS overmind_tasks (
    id                      UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id                  UUID        NOT NULL REFERENCES overmind_jobs(id) ON DELETE CASCADE,
    type                    TEXT        NOT NULL,
    skill_id                UUID        REFERENCES overmind_skills(id) ON DELETE SET NULL,
    assigned_agent_id       UUID        REFERENCES overmind_agents(id) ON DELETE SET NULL,
    status                  TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'running', 'awaiting_cleanup', 'iterating', 'completed', 'escalated', 'failed')),
    iteration_count         INT         NOT NULL DEFAULT 0,
    artifact_refs           JSONB       DEFAULT '{}',
    input_payload           JSONB       DEFAULT '{}',
    output_payload          JSONB,
    last_cleanup_report_id  UUID,
    metadata                JSONB       DEFAULT '{}',
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overmind_tasks_job_id
    ON overmind_tasks(job_id);
CREATE INDEX IF NOT EXISTS idx_overmind_tasks_status
    ON overmind_tasks(status);
CREATE INDEX IF NOT EXISTS idx_overmind_tasks_skill_id
    ON overmind_tasks(skill_id);
CREATE INDEX IF NOT EXISTS idx_overmind_tasks_assigned_agent_id
    ON overmind_tasks(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_overmind_tasks_created_at
    ON overmind_tasks(created_at DESC);

-- --------------------------------------------------------
-- 7. overmind_cleanup_reports
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS overmind_cleanup_reports (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id           UUID        NOT NULL REFERENCES overmind_tasks(id) ON DELETE CASCADE,
    iteration_index   INT         NOT NULL DEFAULT 0,
    raw_findings      JSONB       DEFAULT '{}',
    residual_metrics  JSONB       DEFAULT '{}',
    severity          TEXT        NOT NULL DEFAULT 'none' CHECK (severity IN ('none', 'low', 'medium', 'high', 'critical')),
    llm_summary       TEXT        DEFAULT '',
    patch_suggestions JSONB       DEFAULT '[]',
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overmind_cleanup_reports_task_id
    ON overmind_cleanup_reports(task_id);
CREATE INDEX IF NOT EXISTS idx_overmind_cleanup_reports_severity
    ON overmind_cleanup_reports(severity);
CREATE INDEX IF NOT EXISTS idx_overmind_cleanup_reports_created_at
    ON overmind_cleanup_reports(created_at DESC);

-- Add the deferred FK from overmind_tasks → overmind_cleanup_reports
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_overmind_tasks_last_cleanup_report'
          AND table_name = 'overmind_tasks'
    ) THEN
        ALTER TABLE overmind_tasks
            ADD CONSTRAINT fk_overmind_tasks_last_cleanup_report
            FOREIGN KEY (last_cleanup_report_id)
            REFERENCES overmind_cleanup_reports(id)
            ON DELETE SET NULL;
    END IF;
END
$$;

-- --------------------------------------------------------
-- 8a. overmind_conversations
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS overmind_conversations (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id              UUID        REFERENCES overmind_jobs(id) ON DELETE CASCADE,
    source              TEXT        DEFAULT 'api',
    external_thread_id  TEXT,
    metadata            JSONB       DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overmind_conversations_job_id
    ON overmind_conversations(job_id);
CREATE INDEX IF NOT EXISTS idx_overmind_conversations_external_thread_id
    ON overmind_conversations(external_thread_id);
CREATE INDEX IF NOT EXISTS idx_overmind_conversations_created_at
    ON overmind_conversations(created_at DESC);

-- --------------------------------------------------------
-- 8b. overmind_messages
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS overmind_messages (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id   UUID        NOT NULL REFERENCES overmind_conversations(id) ON DELETE CASCADE,
    role              TEXT        NOT NULL CHECK (role IN ('user', 'system', 'agent', 'overmind')),
    content           TEXT        NOT NULL,
    metadata          JSONB       DEFAULT '{}',
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overmind_messages_conversation_id
    ON overmind_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_overmind_messages_role
    ON overmind_messages(role);
CREATE INDEX IF NOT EXISTS idx_overmind_messages_created_at
    ON overmind_messages(created_at DESC);

-- --------------------------------------------------------
-- 10. overmind_rules — Modular rules engine
-- --------------------------------------------------------
-- Stores configurable rules that control agent behavior,
-- cleanup thresholds, iteration limits, and policies.
-- Rules can be scoped globally or to specific target types/jobs.
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS overmind_rules (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    category    TEXT        NOT NULL,
    key         TEXT        NOT NULL,
    value       JSONB       NOT NULL DEFAULT '{}',
    enabled     BOOLEAN     NOT NULL DEFAULT true,
    scope       TEXT        NOT NULL DEFAULT 'global',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(category, key, scope)
);

CREATE INDEX IF NOT EXISTS idx_overmind_rules_category
    ON overmind_rules(category);
CREATE INDEX IF NOT EXISTS idx_overmind_rules_scope
    ON overmind_rules(scope);
CREATE INDEX IF NOT EXISTS idx_overmind_rules_enabled
    ON overmind_rules(enabled);

-- --------------------------------------------------------
-- 11. overmind_recipes — Repeatable build configurations
-- --------------------------------------------------------
-- A recipe captures HOW to build something: tools, rules,
-- steps, iteration config, and LLM tier preferences.
-- Recipes are matched by target_type and can be modified
-- before launch via the Build Plan Card UI.
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS overmind_recipes (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name              TEXT        NOT NULL,
    description       TEXT        DEFAULT '',
    target_type       TEXT        NOT NULL CHECK (target_type IN ('web_app', 'mobile_app', 'website', 'desktop_app', 'other')),
    tools             JSONB       NOT NULL DEFAULT '[]',
    rule_overrides    JSONB       DEFAULT '{}',
    steps             JSONB       NOT NULL DEFAULT '[]',
    iteration_config  JSONB       NOT NULL DEFAULT '{"min": 2, "max": 5}',
    cleanup_profile   TEXT        DEFAULT 'normal',
    llm_tiers         JSONB       DEFAULT '{}',
    usage_count       INT         DEFAULT 0,
    last_used_at      TIMESTAMPTZ,
    created_by        TEXT        DEFAULT 'system',
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overmind_recipes_target_type
    ON overmind_recipes(target_type);
CREATE INDEX IF NOT EXISTS idx_overmind_recipes_usage_count
    ON overmind_recipes(usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_overmind_recipes_created_at
    ON overmind_recipes(created_at DESC);

-- --------------------------------------------------------
-- 12. overmind_fleet — Multi-backend worker registry
-- --------------------------------------------------------
-- Tracks external backend API workers that Overmind can
-- route tasks to. Each worker has capabilities, load, and
-- context window usage metrics.
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS overmind_fleet (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name              TEXT        NOT NULL,
    url               TEXT        NOT NULL UNIQUE,
    api_key           TEXT        DEFAULT '',
    status            TEXT        NOT NULL DEFAULT 'healthy' CHECK (status IN ('healthy', 'unhealthy', 'quarantined', 'restarting')),
    capabilities      JSONB       DEFAULT '[]',
    current_load      INT         DEFAULT 0,
    max_load          INT         DEFAULT 3,
    context_usage     NUMERIC(5,2) DEFAULT 0,
    last_heartbeat    TIMESTAMPTZ,
    metadata          JSONB       DEFAULT '{}',
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overmind_fleet_status
    ON overmind_fleet(status);
CREATE INDEX IF NOT EXISTS idx_overmind_fleet_created_at
    ON overmind_fleet(created_at DESC);

-- --------------------------------------------------------
-- 13. overmind_worker_commands — Command queue for workers
-- --------------------------------------------------------
-- Overmind pushes commands here; workers poll for pending
-- commands and ACK them. This is how the control plane
-- tells a native Claude Code session to checkpoint, stop,
-- restart, or run a specific task.
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS overmind_worker_commands (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id       UUID        NOT NULL REFERENCES overmind_fleet(id) ON DELETE CASCADE,
    command         TEXT        NOT NULL CHECK (command IN (
                        'checkpoint',   -- Save state + CONTINUE.md, report context usage
                        'stop',         -- Graceful shutdown (checkpoint first)
                        'restart',      -- Stop + start fresh context
                        'ping',         -- Health check — worker must ACK within 30s
                        'run_task',     -- Execute a specific task (payload has task_id)
                        'update_config' -- Hot-reload configuration
                    )),
    status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending',      -- Waiting for worker to pick up
                        'acked',        -- Worker acknowledged receipt
                        'running',      -- Worker is executing the command
                        'completed',    -- Command finished successfully
                        'failed',       -- Command failed (see error field)
                        'expired'       -- Timed out before worker picked up
                    )),
    payload         JSONB       DEFAULT '{}',
    result          JSONB,
    error           TEXT,
    expires_at      TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '5 minutes'),
    acked_at        TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overmind_worker_commands_worker_id
    ON overmind_worker_commands(worker_id);
CREATE INDEX IF NOT EXISTS idx_overmind_worker_commands_status
    ON overmind_worker_commands(status);
CREATE INDEX IF NOT EXISTS idx_overmind_worker_commands_created_at
    ON overmind_worker_commands(created_at DESC);
-- Fast poll query: pending commands for a specific worker
CREATE INDEX IF NOT EXISTS idx_overmind_worker_commands_poll
    ON overmind_worker_commands(worker_id, status) WHERE status = 'pending';

-- --------------------------------------------------------
-- 14. overmind_checkpoints — Worker checkpoint history
-- --------------------------------------------------------
-- When a worker saves its state (CONTINUE.md, memU snapshot,
-- spec tracker, etc.), it records a checkpoint here.
-- Used for resuming work after a context reset.
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS overmind_checkpoints (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id       UUID        NOT NULL REFERENCES overmind_fleet(id) ON DELETE CASCADE,
    job_id          UUID        REFERENCES overmind_jobs(id) ON DELETE SET NULL,
    task_id         UUID        REFERENCES overmind_tasks(id) ON DELETE SET NULL,
    context_usage   NUMERIC(5,2) DEFAULT 0,
    reason          TEXT        NOT NULL DEFAULT 'manual',
    continue_file   TEXT,
    spec_tracker    TEXT,
    memu_snapshot   TEXT,
    files_modified  JSONB       DEFAULT '[]',
    summary         TEXT        DEFAULT '',
    metadata        JSONB       DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overmind_checkpoints_worker_id
    ON overmind_checkpoints(worker_id);
CREATE INDEX IF NOT EXISTS idx_overmind_checkpoints_job_id
    ON overmind_checkpoints(job_id);
CREATE INDEX IF NOT EXISTS idx_overmind_checkpoints_created_at
    ON overmind_checkpoints(created_at DESC);

-- --------------------------------------------------------
-- 15. overmind_rule_versions — Audit trail for rule changes
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS overmind_rule_versions (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    version         INTEGER     NOT NULL,
    category        TEXT        NOT NULL,
    snapshot        JSONB       NOT NULL,
    change_type     TEXT        NOT NULL DEFAULT 'updated',
    changed_by      TEXT        NOT NULL DEFAULT 'system',
    reason          TEXT,
    conversation_id TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_overmind_rule_versions_category
    ON overmind_rule_versions(category, version DESC);
CREATE INDEX IF NOT EXISTS idx_overmind_rule_versions_created_at
    ON overmind_rule_versions(created_at DESC);

-- --------------------------------------------------------
-- 16. overmind_deploy_history — Self-modification audit trail
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS overmind_deploy_history (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    version         INTEGER     NOT NULL,
    change_type     TEXT        NOT NULL CHECK (change_type IN ('frontend', 'backend', 'both')),
    files_changed   JSONB       NOT NULL DEFAULT '[]',
    reason          TEXT,
    conversation_id TEXT,
    build_output    TEXT,
    deploy_status   TEXT        NOT NULL DEFAULT 'pending' CHECK (deploy_status IN ('pending', 'building', 'deploying', 'success', 'failed', 'rolled_back')),
    health_check    JSONB,
    requested_by    TEXT        DEFAULT 'beau',
    created_at      TIMESTAMPTZ DEFAULT now(),
    rolled_back_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_overmind_deploy_history_status
    ON overmind_deploy_history(deploy_status);
CREATE INDEX IF NOT EXISTS idx_overmind_deploy_history_created_at
    ON overmind_deploy_history(created_at DESC);

-- --------------------------------------------------------
-- 17. overmind_health_events — System health event log
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS overmind_health_events (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type      TEXT        NOT NULL,
    severity        TEXT        NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'error', 'critical')),
    source          TEXT        NOT NULL DEFAULT 'orchestrator',
    message         TEXT        NOT NULL,
    metadata        JSONB       DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_overmind_health_events_type
    ON overmind_health_events(event_type);
CREATE INDEX IF NOT EXISTS idx_overmind_health_events_severity
    ON overmind_health_events(severity);
CREATE INDEX IF NOT EXISTS idx_overmind_health_events_created_at
    ON overmind_health_events(created_at DESC);

-- ============================================================
-- Migration complete.
-- ============================================================
