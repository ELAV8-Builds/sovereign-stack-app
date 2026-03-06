/**
 * Integrations API Client — Nango connections + custom webhooks
 *
 * Communicates with the backend integration routes to manage
 * data source connections for Canvas pages.
 */

const API_BASE = '/api/sovereign';

// ── Types ──────────────────────────────────────────────────────────────

export interface IntegrationStatus {
  nangoConfigured: boolean;
  webhooksEnabled: boolean;
}

export interface ConnectSession {
  token: string;
  expiresAt: string;
}

export interface StoredConnection {
  id: string;
  connection_id: string;
  integration_id: string;
  display_name: string;
  provider: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CustomWebhook {
  id: string;
  name: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body_template: object | null;
  auth_type: 'none' | 'bearer' | 'api_key' | 'basic';
  auth_config: Record<string, string>;
  status: string;
  last_tested_at: string | null;
  last_test_result: {
    success: boolean;
    statusCode?: number;
    dataPreview?: string;
    error?: string;
    testedAt: string;
  } | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookTestResult {
  success: boolean;
  data?: any;
  error?: string;
  statusCode?: number;
}

export interface UrlTestResult {
  success: boolean;
  statusCode: number;
  contentType: string;
  data: any;
  schemaHints: any;
}

// ── Data Source Config (stored in canvas_pages.data_sources) ──────────

export interface DataSourceConfig {
  sources: DataSource[];
}

export interface NangoDataSource {
  id: string;
  type: 'nango';
  integrationId: string;
  connectionId: string;
  endpoint: string;
  displayName: string;
  refreshInterval?: number; // ms, 0 = manual
}

export interface WebhookDataSource {
  id: string;
  type: 'webhook';
  webhookId: string;
  displayName: string;
  refreshInterval?: number;
}

export type DataSource = NangoDataSource | WebhookDataSource;

// ── API Methods ────────────────────────────────────────────────────────

export async function getIntegrationStatus(): Promise<IntegrationStatus> {
  const res = await fetch(`${API_BASE}/integrations/status`);
  if (!res.ok) throw new Error(`Failed to get status: ${res.status}`);
  return res.json();
}

export async function createConnectSession(options?: {
  userId?: string;
  email?: string;
  organizationId?: string;
  allowedIntegrations?: string[];
}): Promise<ConnectSession> {
  const res = await fetch(`${API_BASE}/integrations/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options || {}),
  });
  if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
  return res.json();
}

export async function listAvailableIntegrations(): Promise<any> {
  const res = await fetch(`${API_BASE}/integrations/available`);
  if (!res.ok) throw new Error(`Failed to list integrations: ${res.status}`);
  return res.json();
}

export async function listConnections(): Promise<{
  connections: StoredConnection[];
  live: any;
}> {
  const res = await fetch(`${API_BASE}/integrations/connections`);
  if (!res.ok) throw new Error(`Failed to list connections: ${res.status}`);
  return res.json();
}

export async function syncNangoConnections(): Promise<{
  synced: number;
  total: number;
  connections: StoredConnection[];
}> {
  const res = await fetch(`${API_BASE}/integrations/connections/sync`, {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Failed to sync connections: ${res.status}`);
  return res.json();
}

export async function deleteConnectionApi(integrationId: string, connectionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/integrations/connections/${integrationId}/${connectionId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to delete connection: ${res.status}`);
}

export async function proxyRequest(options: {
  integrationId: string;
  connectionId: string;
  endpoint: string;
  method?: string;
  params?: Record<string, string>;
  data?: unknown;
}): Promise<any> {
  const res = await fetch(`${API_BASE}/integrations/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!res.ok) throw new Error(`Proxy request failed: ${res.status}`);
  return res.json();
}

// ── Custom Webhooks ────────────────────────────────────────────────────

export async function listWebhooks(): Promise<CustomWebhook[]> {
  const res = await fetch(`${API_BASE}/integrations/webhooks`);
  if (!res.ok) throw new Error(`Failed to list webhooks: ${res.status}`);
  return res.json();
}

export async function createWebhook(data: {
  name: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  bodyTemplate?: object;
  authType?: 'none' | 'bearer' | 'api_key' | 'basic';
  authConfig?: Record<string, string>;
}): Promise<CustomWebhook> {
  const res = await fetch(`${API_BASE}/integrations/webhooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to create webhook: ${res.status}`);
  return res.json();
}

export async function deleteWebhook(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/integrations/webhooks/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to delete webhook: ${res.status}`);
}

export async function testWebhook(id: string): Promise<WebhookTestResult> {
  const res = await fetch(`${API_BASE}/integrations/webhooks/${id}/test`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Failed to test webhook: ${res.status}`);
  return res.json();
}

export async function fetchWebhookData(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/integrations/webhooks/${id}/fetch`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Failed to fetch webhook data: ${res.status}`);
  return res.json();
}

// ── URL Testing (for AI integration builder) ───────────────────────────

export async function testUrl(options: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<UrlTestResult> {
  const res = await fetch(`${API_BASE}/integrations/test-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!res.ok) throw new Error(`Failed to test URL: ${res.status}`);
  return res.json();
}
