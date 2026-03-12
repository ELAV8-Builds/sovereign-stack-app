-- ============================================================
-- Sovereign Stack — PostgreSQL Init
-- Creates databases and extensions for all services
-- ============================================================

-- Create memU database
CREATE DATABASE memu;

-- Enable extensions on sovereign (main) database
\c sovereign;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Chat messages table
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('chat', 'whatsapp', 'slack')),
    role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_messages_channel ON messages(channel);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);

-- Service status tracking
CREATE TABLE IF NOT EXISTS services (
    name VARCHAR(50) PRIMARY KEY,
    status VARCHAR(20) DEFAULT 'stopped',
    port INTEGER,
    runtime VARCHAR(50),
    last_health_check TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'
);

-- Insert default service definitions
INSERT INTO services (name, port, runtime) VALUES
    ('nanoclaw', NULL, 'Node.js'),
    ('litellm', 4000, 'Python'),
    ('ollama', 11434, 'Native Binary'),
    ('memu', 8090, 'Node.js'),
    ('postgresql', 5432, 'Docker'),
    ('redis', 6379, 'Docker'),
    ('anythingllm', 3001, 'Docker')
ON CONFLICT (name) DO NOTHING;

-- Agent activity log
CREATE TABLE IF NOT EXISTS agent_activity (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent VARCHAR(50) NOT NULL,
    level VARCHAR(10) DEFAULT 'info' CHECK (level IN ('info', 'success', 'warning', 'error', 'thinking')),
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_agent_activity_created ON agent_activity(created_at DESC);
CREATE INDEX idx_agent_activity_agent ON agent_activity(agent);

-- Settings (key-value store with encryption support)
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    encrypted BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tool results / artifacts
CREATE TABLE IF NOT EXISTS tool_artifacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tool_name VARCHAR(50) NOT NULL,
    input JSONB NOT NULL,
    output JSONB,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX idx_tool_artifacts_tool ON tool_artifacts(tool_name);
CREATE INDEX idx_tool_artifacts_status ON tool_artifacts(status);

-- WhatsApp sessions
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone VARCHAR(20),
    status VARCHAR(20) DEFAULT 'disconnected',
    session_data JSONB DEFAULT '{}',
    connected_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Slack integrations
CREATE TABLE IF NOT EXISTS slack_integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id VARCHAR(50),
    team_name VARCHAR(100),
    bot_token_encrypted TEXT,
    status VARCHAR(20) DEFAULT 'disconnected',
    connected_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable extensions on memu database
\c memu;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Memory entries for memU
CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content TEXT NOT NULL,
    embedding vector(384),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
