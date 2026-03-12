/**
 * Nango Service — Centralized integration platform
 *
 * Manages OAuth connections to 700+ APIs through Nango's hosted platform.
 * We host one Nango app — all users/companies authenticate through our
 * Nango dashboard. The SDK handles token refresh, credential storage,
 * and proxy requests automatically.
 *
 * Flow:
 * 1. Backend creates a Connect Session → short-lived token (30 min)
 * 2. Frontend opens Nango's Connect UI with that token
 * 3. User authenticates with the external service
 * 4. Nango webhooks us with the connectionId
 * 5. We fetch data through Nango's authenticated proxy
 */
import { Nango } from '@nangohq/node';
import { query } from './database';
import { logActivity } from './activity-broadcaster';

// ── Singleton ──────────────────────────────────────────────────────────

let nangoClient: Nango | null = null;

function getNango(): Nango {
  if (!nangoClient) {
    const secretKey = process.env.NANGO_SECRET_KEY;
    if (!secretKey) {
      throw new Error('NANGO_SECRET_KEY environment variable is not set');
    }
    nangoClient = new Nango({
      secretKey,
      ...(process.env.NANGO_HOST ? { host: process.env.NANGO_HOST } : {}),
    });
    logActivity('nango', 'success', 'Nango SDK initialized');
  }
  return nangoClient;
}

export function isNangoConfigured(): boolean {
  return !!process.env.NANGO_SECRET_KEY;
}

// ── Database schema for stored connections ─────────────────────────────

export async function initIntegrationSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS integration_connections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      connection_id TEXT NOT NULL,
      integration_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(connection_id, integration_id)
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_integration_connections_status
    ON integration_connections (status, updated_at DESC)
  `);

  // Custom webhook integrations
  await query(`
    CREATE TABLE IF NOT EXISTS custom_webhooks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'GET',
      headers JSONB DEFAULT '{}',
      body_template JSONB,
      auth_type TEXT DEFAULT 'none',
      auth_config JSONB DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      last_tested_at TIMESTAMPTZ,
      last_test_result JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// ── Connect Sessions ──────────────────────────────────────────────────

export interface CreateSessionOptions {
  userId?: string;
  email?: string;
  organizationId?: string;
  allowedIntegrations?: string[];
}

export async function createConnectSession(options: CreateSessionOptions = {}) {
  const nango = getNango();

  const tags: Record<string, string> = {};
  if (options.userId) tags.end_user_id = options.userId;
  if (options.email) tags.end_user_email = options.email;
  if (options.organizationId) tags.organization_id = options.organizationId;

  const sessionConfig: any = { tags };
  if (options.allowedIntegrations?.length) {
    sessionConfig.allowed_integrations = options.allowedIntegrations;
  }

  const { data } = await nango.createConnectSession(sessionConfig);

  logActivity('nango', 'info', `Connect session created${options.allowedIntegrations ? ` for: ${options.allowedIntegrations.join(', ')}` : ''}`);

  return {
    token: data.token,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
  };
}

// ── Integrations ──────────────────────────────────────────────────────

export async function listAvailableIntegrations() {
  const nango = getNango();
  const result = await nango.listIntegrations();
  return result;
}

export async function getIntegrationDetails(uniqueKey: string) {
  const nango = getNango();
  return nango.getIntegration({ uniqueKey });
}

// ── Connections ───────────────────────────────────────────────────────

export async function listConnections(filters?: { integrationId?: string }) {
  const nango = getNango();
  const params: any = {};
  if (filters?.integrationId) params.integrationId = filters.integrationId;
  return nango.listConnections(params);
}

export async function getConnection(integrationId: string, connectionId: string) {
  const nango = getNango();
  return nango.getConnection(integrationId, connectionId);
}

export async function deleteConnection(integrationId: string, connectionId: string) {
  const nango = getNango();
  await nango.deleteConnection(integrationId, connectionId);

  // Remove from our local tracking table
  await query(
    'DELETE FROM integration_connections WHERE connection_id = $1 AND integration_id = $2',
    [connectionId, integrationId]
  );

  logActivity('nango', 'info', `Connection deleted: ${integrationId}/${connectionId}`);
}

// ── Store connection locally (called from webhook) ────────────────────

export async function storeConnection(data: {
  connectionId: string;
  integrationId: string;
  provider: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
}) {
  await query(`
    INSERT INTO integration_connections (connection_id, integration_id, display_name, provider, metadata)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (connection_id, integration_id)
    DO UPDATE SET status = 'active', updated_at = NOW(), metadata = $5
    RETURNING *
  `, [
    data.connectionId,
    data.integrationId,
    data.displayName || data.integrationId,
    data.provider,
    JSON.stringify(data.metadata || {}),
  ]);

  logActivity('nango', 'success', `Connection stored: ${data.integrationId} (${data.connectionId})`);
}

export async function listStoredConnections() {
  const result = await query(
    'SELECT * FROM integration_connections WHERE status = $1 ORDER BY updated_at DESC',
    ['active']
  );
  return result.rows;
}

// ── Sync: pull live Nango connections into local DB ──────────────────

export async function syncConnections(): Promise<{ synced: number; total: number }> {
  const nango = getNango();
  const live = await nango.listConnections();
  const connections = (live as any)?.connections ?? [];

  let synced = 0;
  for (const conn of connections) {
    try {
      await query(`
        INSERT INTO integration_connections (connection_id, integration_id, display_name, provider, metadata)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (connection_id, integration_id)
        DO UPDATE SET status = 'active', updated_at = NOW()
      `, [
        conn.connection_id,
        conn.provider_config_key || conn.integration_id || 'unknown',
        conn.provider_config_key || conn.integration_id || 'unknown',
        conn.provider || conn.provider_config_key || 'unknown',
        JSON.stringify({ synced: true, created: conn.created_at }),
      ]);
      synced++;
    } catch {
      // skip individual failures
    }
  }

  logActivity('nango', 'success', `Synced ${synced} connections from Nango`);
  return { synced, total: connections.length };
}

// ── Proxy Data Fetching ───────────────────────────────────────────────

export interface ProxyRequestOptions {
  integrationId: string;
  connectionId: string;
  endpoint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string>;
  data?: unknown;
  retries?: number;
}

export async function proxyRequest(options: ProxyRequestOptions): Promise<any> {
  const nango = getNango();

  const config: any = {
    endpoint: options.endpoint,
    providerConfigKey: options.integrationId,
    connectionId: options.connectionId,
    retries: options.retries ?? 3,
  };

  if (options.params) config.params = options.params;
  if (options.data) config.data = options.data;

  const method = (options.method || 'GET').toLowerCase();

  switch (method) {
    case 'get':
      return nango.get(config);
    case 'post':
      return nango.post(config);
    case 'put':
      return nango.put(config);
    case 'patch':
      return nango.patch(config);
    case 'delete':
      return nango.delete(config);
    default:
      return nango.get(config);
  }
}

// ── Synced Records ────────────────────────────────────────────────────

export async function fetchRecords(options: {
  integrationId: string;
  connectionId: string;
  model: string;
  limit?: number;
}) {
  const nango = getNango();
  return nango.listRecords({
    providerConfigKey: options.integrationId,
    connectionId: options.connectionId,
    model: options.model,
    limit: options.limit ?? 100,
  });
}

// ── Custom Webhook Management ─────────────────────────────────────────

export interface CustomWebhookInput {
  name: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  bodyTemplate?: object;
  authType?: 'none' | 'bearer' | 'api_key' | 'basic';
  authConfig?: Record<string, string>;
}

export async function createCustomWebhook(input: CustomWebhookInput) {
  const result = await query(`
    INSERT INTO custom_webhooks (name, url, method, headers, body_template, auth_type, auth_config)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [
    input.name,
    input.url,
    input.method || 'GET',
    JSON.stringify(input.headers || {}),
    input.bodyTemplate ? JSON.stringify(input.bodyTemplate) : null,
    input.authType || 'none',
    JSON.stringify(input.authConfig || {}),
  ]);

  logActivity('integrations', 'success', `Custom webhook created: ${input.name}`);
  return result.rows[0];
}

export async function listCustomWebhooks() {
  const result = await query(
    'SELECT * FROM custom_webhooks WHERE status = $1 ORDER BY updated_at DESC',
    ['active']
  );
  return result.rows;
}

export async function deleteCustomWebhook(id: string) {
  await query('UPDATE custom_webhooks SET status = $1 WHERE id = $2', ['deleted', id]);
  logActivity('integrations', 'info', `Custom webhook deleted: ${id}`);
}

export async function testCustomWebhook(id: string): Promise<{ success: boolean; data?: any; error?: string; statusCode?: number }> {
  const result = await query('SELECT * FROM custom_webhooks WHERE id = $1', [id]);
  const webhook = result.rows[0];
  if (!webhook) return { success: false, error: 'Webhook not found' };

  try {
    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(webhook.headers || {}),
    };

    // Apply auth
    if (webhook.auth_type === 'bearer' && webhook.auth_config?.token) {
      headers['Authorization'] = `Bearer ${webhook.auth_config.token}`;
    } else if (webhook.auth_type === 'api_key' && webhook.auth_config?.key && webhook.auth_config?.header) {
      headers[webhook.auth_config.header] = webhook.auth_config.key;
    } else if (webhook.auth_type === 'basic' && webhook.auth_config?.username) {
      const encoded = Buffer.from(`${webhook.auth_config.username}:${webhook.auth_config.password || ''}`).toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
    }

    const fetchOptions: RequestInit = {
      method: webhook.method || 'GET',
      headers,
      signal: AbortSignal.timeout(15000), // 15s timeout
    };

    if (['POST', 'PUT', 'PATCH'].includes(webhook.method) && webhook.body_template) {
      fetchOptions.body = JSON.stringify(webhook.body_template);
    }

    const response = await fetch(webhook.url, fetchOptions);
    const contentType = response.headers.get('content-type') || '';
    let data: any;

    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    // Store test result
    const testResult = {
      success: response.ok,
      statusCode: response.status,
      dataPreview: typeof data === 'string' ? data.slice(0, 500) : JSON.stringify(data).slice(0, 500),
      testedAt: new Date().toISOString(),
    };

    await query(
      'UPDATE custom_webhooks SET last_tested_at = NOW(), last_test_result = $1 WHERE id = $2',
      [JSON.stringify(testResult), id]
    );

    logActivity('integrations', response.ok ? 'success' : 'warning', `Webhook test ${response.ok ? 'passed' : 'failed'}: ${webhook.name} (${response.status})`);

    return {
      success: response.ok,
      data,
      statusCode: response.status,
    };
  } catch (err: any) {
    const testResult = {
      success: false,
      error: err.message,
      testedAt: new Date().toISOString(),
    };

    await query(
      'UPDATE custom_webhooks SET last_tested_at = NOW(), last_test_result = $1 WHERE id = $2',
      [JSON.stringify(testResult), id]
    );

    logActivity('integrations', 'error', `Webhook test error: ${webhook.name} — ${err.message}`);

    return { success: false, error: err.message };
  }
}

// ── Fetch data from custom webhook (for canvas data refresh) ──────────

export async function fetchWebhookData(webhookId: string): Promise<any> {
  const res = await query('SELECT * FROM custom_webhooks WHERE id = $1 AND status = $2', [webhookId, 'active']);
  const webhook = res.rows[0];
  if (!webhook) throw new Error('Webhook not found');

  const headers: Record<string, string> = {
    ...(webhook.headers || {}),
  };

  if (webhook.auth_type === 'bearer' && webhook.auth_config?.token) {
    headers['Authorization'] = `Bearer ${webhook.auth_config.token}`;
  } else if (webhook.auth_type === 'api_key' && webhook.auth_config?.key && webhook.auth_config?.header) {
    headers[webhook.auth_config.header] = webhook.auth_config.key;
  } else if (webhook.auth_type === 'basic' && webhook.auth_config?.username) {
    const encoded = Buffer.from(`${webhook.auth_config.username}:${webhook.auth_config.password || ''}`).toString('base64');
    headers['Authorization'] = `Basic ${encoded}`;
  }

  const fetchOptions: RequestInit = {
    method: webhook.method || 'GET',
    headers,
    signal: AbortSignal.timeout(15000),
  };

  if (['POST', 'PUT', 'PATCH'].includes(webhook.method) && webhook.body_template) {
    fetchOptions.body = JSON.stringify(webhook.body_template);
  }

  const response = await fetch(webhook.url, fetchOptions);
  if (!response.ok) throw new Error(`Webhook returned ${response.status}`);

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

// ── Webhook verification (incoming from Nango) ───────────────────────

export function verifyNangoWebhook(body: any, headers: Record<string, string>): boolean {
  try {
    const nango = getNango();
    return nango.verifyIncomingWebhookRequest(body, headers);
  } catch {
    return false;
  }
}
