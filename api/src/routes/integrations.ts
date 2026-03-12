/**
 * Integration Routes — Nango connections + custom webhooks
 *
 * POST   /api/integrations/session            → Create Nango connect session
 * GET    /api/integrations/available           → List available Nango integrations
 * GET    /api/integrations/connections         → List active connections
 * GET    /api/integrations/connections/:id     → Get connection details
 * DELETE /api/integrations/connections/:id     → Remove a connection
 * POST   /api/integrations/proxy              → Proxy request through Nango
 * POST   /api/integrations/webhooks           → Create custom webhook
 * GET    /api/integrations/webhooks           → List custom webhooks
 * DELETE /api/integrations/webhooks/:id       → Delete custom webhook
 * POST   /api/integrations/webhooks/:id/test  → Test custom webhook
 * POST   /api/integrations/webhooks/:id/fetch → Fetch data from custom webhook
 * POST   /api/integrations/nango-webhook      → Receive Nango webhooks (connection events)
 * GET    /api/integrations/status             → Check Nango configuration status
 */
import { Router, Request, Response } from 'express';
import {
  isNangoConfigured,
  createConnectSession,
  listAvailableIntegrations,
  listConnections,
  getConnection,
  deleteConnection,
  proxyRequest,
  storeConnection,
  listStoredConnections,
  createCustomWebhook,
  listCustomWebhooks,
  deleteCustomWebhook,
  testCustomWebhook,
  fetchWebhookData,
  verifyNangoWebhook,
  syncConnections,
  initIntegrationSchema,
} from '../services/nango';
import { logActivity } from '../services/activity-broadcaster';

export const integrationsRouter = Router();

// ── Schema init ─────────────────────────────────────────────────────

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  try {
    await initIntegrationSchema();
    schemaReady = true;
  } catch (err) {
    console.error('[integrations] Schema init failed:', err);
  }
}

// ── Status check ────────────────────────────────────────────────────

integrationsRouter.get('/status', async (_req: Request, res: Response) => {
  res.json({
    nangoConfigured: isNangoConfigured(),
    webhooksEnabled: true,
  });
});

// ── Nango Connect Session ───────────────────────────────────────────

integrationsRouter.post('/session', async (req: Request, res: Response) => {
  if (!isNangoConfigured()) {
    return res.status(503).json({ error: 'Nango is not configured. Set NANGO_SECRET_KEY in environment.' });
  }

  try {
    const { userId, email, organizationId, allowedIntegrations } = req.body;
    const session = await createConnectSession({
      userId,
      email,
      organizationId,
      allowedIntegrations,
    });
    res.json(session);
  } catch (err: any) {
    console.error('[integrations] Session creation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Available Integrations ──────────────────────────────────────────

integrationsRouter.get('/available', async (_req: Request, res: Response) => {
  if (!isNangoConfigured()) {
    return res.json({ integrations: [] });
  }

  try {
    const result = await listAvailableIntegrations();
    res.json(result);
  } catch (err: any) {
    console.error('[integrations] List integrations error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Connections (from Nango) ────────────────────────────────────────

integrationsRouter.get('/connections', async (req: Request, res: Response) => {
  await ensureSchema();

  try {
    // Return locally stored connections (faster, works even if Nango is down)
    const stored = await listStoredConnections();

    // If Nango is configured, also get live status
    let liveConnections: any = null;
    if (isNangoConfigured()) {
      try {
        const integrationId = req.query.integrationId as string | undefined;
        liveConnections = await listConnections(integrationId ? { integrationId } : undefined);
      } catch {
        // Nango might be temporarily down
      }
    }

    res.json({
      connections: stored,
      live: liveConnections,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sync: pull live Nango connections into local DB ─────────────────

integrationsRouter.post('/connections/sync', async (req: Request, res: Response) => {
  await ensureSchema();

  if (!isNangoConfigured()) {
    return res.status(503).json({ error: 'Nango not configured' });
  }

  try {
    const result = await syncConnections();
    const stored = await listStoredConnections();
    res.json({ ...result, connections: stored });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

integrationsRouter.get('/connections/:integrationId/:connectionId', async (req: Request, res: Response) => {
  if (!isNangoConfigured()) {
    return res.status(503).json({ error: 'Nango not configured' });
  }

  try {
    const connection = await getConnection(
      req.params.integrationId as string,
      req.params.connectionId as string
    );
    res.json(connection);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

integrationsRouter.delete('/connections/:integrationId/:connectionId', async (req: Request, res: Response) => {
  if (!isNangoConfigured()) {
    return res.status(503).json({ error: 'Nango not configured' });
  }

  try {
    await deleteConnection(
      req.params.integrationId as string,
      req.params.connectionId as string
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Proxy Request ───────────────────────────────────────────────────

integrationsRouter.post('/proxy', async (req: Request, res: Response) => {
  if (!isNangoConfigured()) {
    return res.status(503).json({ error: 'Nango not configured' });
  }

  try {
    const { integrationId, connectionId, endpoint, method, params, data } = req.body;

    if (!integrationId || !connectionId || !endpoint) {
      return res.status(400).json({ error: 'integrationId, connectionId, and endpoint are required' });
    }

    const result = await proxyRequest({
      integrationId,
      connectionId,
      endpoint,
      method,
      params,
      data,
    });

    res.json({ data: result.data, status: result.status });
  } catch (err: any) {
    console.error('[integrations] Proxy error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Custom Webhooks ─────────────────────────────────────────────────

integrationsRouter.get('/webhooks', async (_req: Request, res: Response) => {
  await ensureSchema();
  try {
    const webhooks = await listCustomWebhooks();
    res.json(webhooks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

integrationsRouter.post('/webhooks', async (req: Request, res: Response) => {
  await ensureSchema();
  try {
    const { name, url, method, headers, bodyTemplate, authType, authConfig } = req.body;

    if (!name || !url) {
      return res.status(400).json({ error: 'name and url are required' });
    }

    const webhook = await createCustomWebhook({
      name,
      url,
      method,
      headers,
      bodyTemplate,
      authType,
      authConfig,
    });
    res.status(201).json(webhook);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

integrationsRouter.delete('/webhooks/:id', async (req: Request, res: Response) => {
  await ensureSchema();
  try {
    await deleteCustomWebhook(req.params.id as string);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

integrationsRouter.post('/webhooks/:id/test', async (req: Request, res: Response) => {
  await ensureSchema();
  try {
    const result = await testCustomWebhook(req.params.id as string);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

integrationsRouter.post('/webhooks/:id/fetch', async (req: Request, res: Response) => {
  await ensureSchema();
  try {
    const data = await fetchWebhookData(req.params.id as string);
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Nango Incoming Webhook ──────────────────────────────────────────
// Nango sends us webhooks when connections are created/updated/deleted

integrationsRouter.post('/nango-webhook', async (req: Request, res: Response) => {
  await ensureSchema();

  // Verify webhook authenticity if Nango is configured
  if (isNangoConfigured()) {
    const headersMap: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headersMap[key] = value;
    }

    const isValid = verifyNangoWebhook(req.body, headersMap);
    if (!isValid) {
      logActivity('nango', 'warning', 'Invalid webhook signature received');
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
  }

  const { type, operation, connectionId, success } = req.body;

  logActivity('nango', 'info', `Webhook received: ${type}/${operation} — ${success ? 'success' : 'failure'}`);

  if (type === 'auth' && operation === 'creation' && success) {
    // New connection created
    const tags = req.body.tags || {};
    const integrationId = req.body.provider || req.body.providerConfigKey || 'unknown';

    try {
      await storeConnection({
        connectionId,
        integrationId,
        provider: integrationId,
        displayName: integrationId,
        metadata: { tags, operation },
      });
    } catch (err) {
      console.error('[integrations] Failed to store connection from webhook:', err);
    }
  } else if (type === 'auth' && operation === 'override' && success) {
    // Reconnection — update existing
    logActivity('nango', 'info', `Connection reconnected: ${connectionId}`);
  }

  // Always respond 200 to Nango
  res.json({ received: true });
});

// ── Test endpoint for direct URL fetching (AI integration builder) ──

integrationsRouter.post('/test-url', async (req: Request, res: Response) => {
  try {
    const { url, method, headers, body: reqBody } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'url is required' });
    }

    const fetchOptions: RequestInit = {
      method: method || 'GET',
      headers: {
        'User-Agent': 'Sovereign-Stack/1.0',
        ...(headers || {}),
      },
      signal: AbortSignal.timeout(15000),
    };

    if (['POST', 'PUT', 'PATCH'].includes(method) && reqBody) {
      fetchOptions.body = typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody);
      if (!headers?.['Content-Type']) {
        (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, fetchOptions);
    const contentType = response.headers.get('content-type') || '';

    let data: any;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    // Extract schema hints for the AI
    let schemaHints: any = null;
    if (typeof data === 'object' && data !== null) {
      schemaHints = extractSchemaHints(data);
    }

    res.json({
      success: response.ok,
      statusCode: response.status,
      contentType,
      data: typeof data === 'string' ? data.slice(0, 2000) : data,
      schemaHints,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helper: extract schema hints from JSON data ─────────────────────

function extractSchemaHints(data: any, depth = 0): any {
  if (depth > 3) return typeof data;

  if (Array.isArray(data)) {
    if (data.length === 0) return { type: 'array', items: 'unknown', count: 0 };
    return {
      type: 'array',
      count: data.length,
      items: extractSchemaHints(data[0], depth + 1),
    };
  }

  if (typeof data === 'object' && data !== null) {
    const hints: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') hints[key] = 'string';
      else if (typeof value === 'number') hints[key] = 'number';
      else if (typeof value === 'boolean') hints[key] = 'boolean';
      else if (value === null) hints[key] = 'null';
      else if (Array.isArray(value)) hints[key] = extractSchemaHints(value, depth + 1);
      else if (typeof value === 'object') hints[key] = extractSchemaHints(value, depth + 1);
    }
    return { type: 'object', fields: hints };
  }

  return typeof data;
}
