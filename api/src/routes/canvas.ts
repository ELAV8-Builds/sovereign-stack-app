/**
 * Canvas Routes — CRUD for pages + AI generation endpoint
 *
 * POST /api/canvas/generate  → Stream JSONL patches via SSE (json-render protocol)
 * GET  /api/canvas/pages     → List all pages
 * POST /api/canvas/pages     → Create a page
 * GET  /api/canvas/pages/:id → Get a page
 * PUT  /api/canvas/pages/:id → Update a page
 * DELETE /api/canvas/pages/:id → Delete a page
 * POST /api/canvas/pages/:id/duplicate → Duplicate a page
 */
import { Router, Request, Response } from 'express';
import {
  listPages,
  getPage,
  createPage,
  updatePage,
  deletePage,
  duplicatePage,
  initCanvasSchema,
} from '../services/canvas';
import { logActivity } from '../services/activity-broadcaster';
import {
  isNangoConfigured,
  proxyRequest,
  fetchWebhookData,
} from '../services/nango';
import { query } from '../services/database';
import crypto from 'crypto';

const LITELLM_URL = process.env.LITELLM_URL || 'http://localhost:4000';

// ── Vault key lookup for direct API calls ────────────────────────────

function decryptVaultValue(text: string): string {
  const encKey = process.env.ENCRYPTION_KEY;
  if (!encKey) throw new Error('ENCRYPTION_KEY not set');
  const [ivHex, authTagHex, encrypted] = text.split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(encKey, 'hex').subarray(0, 32),
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function getVaultKey(keyId: string): Promise<string | null> {
  try {
    const result = await query(
      `SELECT value, encrypted FROM settings WHERE key = $1`,
      [`vault.${keyId}`]
    );
    if (result.rows.length > 0) {
      const row = result.rows[0];
      return row.encrypted ? decryptVaultValue(row.value) : row.value;
    }
  } catch { /* vault unavailable */ }
  const envKey = keyId.toUpperCase().replace(/-/g, '_') + '_API_KEY';
  return process.env[envKey] || null;
}

// ── Direct API config per service ────────────────────────────────────
// Maps integration IDs to their base URL, auth style, and vault key ID.
// Used to call APIs directly when the user has a key in the vault.

interface DirectApiConfig {
  vaultKeyId: string;
  baseUrl: string;
  authStyle: 'bearer' | 'header' | 'query';
  authHeader?: string;
  extraHeaders?: Record<string, string>;
}

const DIRECT_API_MAP: Record<string, DirectApiConfig> = {
  notion:       { vaultKeyId: 'notion', baseUrl: 'https://api.notion.com', authStyle: 'bearer', extraHeaders: { 'Notion-Version': '2022-06-28' } },
  slack:        { vaultKeyId: 'slack_bot', baseUrl: 'https://slack.com/api', authStyle: 'bearer' },
  github:       { vaultKeyId: 'github', baseUrl: 'https://api.github.com', authStyle: 'bearer' },
  stripe:       { vaultKeyId: 'stripe', baseUrl: 'https://api.stripe.com', authStyle: 'bearer' },
  hubspot:      { vaultKeyId: 'hubspot', baseUrl: 'https://api.hubapi.com', authStyle: 'bearer' },
  airtable:     { vaultKeyId: 'airtable', baseUrl: 'https://api.airtable.com', authStyle: 'bearer' },
  linear:       { vaultKeyId: 'linear', baseUrl: 'https://api.linear.app', authStyle: 'bearer' },
  intercom:     { vaultKeyId: 'intercom', baseUrl: 'https://api.intercom.io', authStyle: 'bearer' },
  brave_search: { vaultKeyId: 'brave_search', baseUrl: 'https://api.search.brave.com', authStyle: 'header', authHeader: 'X-Subscription-Token' },
};

async function tryDirectFetch(
  integrationId: string,
  endpoint: string,
  method: 'GET' | 'POST',
): Promise<{ data: any } | null> {
  const id = integrationId.toLowerCase();
  const config = Object.entries(DIRECT_API_MAP).find(([key]) => id.includes(key))?.[1];
  if (!config) return null;

  const apiKey = await getVaultKey(config.vaultKeyId);
  if (!apiKey) return null;

  const url = `${config.baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(config.extraHeaders || {}) };

  if (config.authStyle === 'bearer') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (config.authStyle === 'header' && config.authHeader) {
    headers[config.authHeader] = apiKey;
  }

  const response = await fetch(url, {
    method,
    headers,
    signal: AbortSignal.timeout(15000),
    ...(method === 'POST' ? { body: '{}' } : {}),
  });

  if (!response.ok) throw new Error(`Direct API call failed (${response.status})`);

  return { data: await response.json() };
}
const LITELLM_KEY = process.env.LITELLM_MASTER_KEY || 'sk-litellm-master';

export const canvasRouter = Router();

// ── Initialize schema on startup ───────────────────────────────────────

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  try {
    await initCanvasSchema();
    schemaReady = true;
  } catch (err) {
    console.error('[canvas] Schema init failed:', err);
  }
}

// ── CATALOG PROMPT ─────────────────────────────────────────────────────
// This system prompt tells the AI how to output json-render JSONL patches.
// It lists all 33 shadcn components with their props.

const CATALOG_SYSTEM_PROMPT = `You are a UI generator. You output ONLY JSONL patch lines — no prose, no markdown, no explanation.

Each line is a JSON object representing a UI element in a flat tree:
{"key":"root","type":"Stack","props":{"direction":"vertical","gap":"md"},"children":["header","content"]}
{"key":"header","type":"Heading","props":{"text":"Dashboard","level":"h1"}}
{"key":"content","type":"Grid","props":{"columns":3,"gap":"md"},"children":["card1","card2","card3"]}

RULES:
1. Output one JSON object per line (JSONL format)
2. Every element needs a unique "key" string
3. The first element is the root — its key should be "root"
4. Use "children" array to reference child elements by their key
5. Only use components from the catalog below
6. Design beautiful, functional UIs with proper layout hierarchy
7. Use Stack for vertical/horizontal layouts, Grid for multi-column layouts
8. Use Card to group related content
9. Match the dark theme aesthetic (the renderer handles styling)
10. For data-heavy displays, prefer Table + metrics over walls of text
11. NEVER output anything other than JSONL lines — no text before, after, or between
12. Grid columns MUST be 1, 2, 3, or 4 — NEVER more than 4. Use rows of grids for more items.
13. Keep text short inside cards. Summarize long content — avoid paragraphs that overflow card bounds.
14. For dashboards with 5+ sections, use a vertical Stack of Grid rows (e.g. two rows of 3 columns) instead of one wide grid.

AVAILABLE COMPONENTS:

LAYOUT:
- Stack: {direction: "horizontal"|"vertical", gap: "none"|"sm"|"md"|"lg", align: "start"|"center"|"end"|"stretch", justify: "start"|"center"|"end"|"between"|"around"} — children slot
- Grid: {columns: number, gap: "sm"|"md"|"lg"} — children slot
- Card: {title: string|null, description: string|null, maxWidth: "sm"|"md"|"lg"|"full", centered: boolean|null} — children slot (default)
- Separator: {orientation: "horizontal"|"vertical"}
- Tabs: {tabs: [{label, value}], defaultValue: string|null, value: string|null} — named slots matching tab values, events: [change]
- Accordion: {items: [{title, content}], type: "single"|"multiple"}
- Collapsible: {title: string, defaultOpen: boolean|null} — children slot
- Dialog: {title: string, description: string|null, openPath: string} — children slot
- Drawer: {title: string, description: string|null, openPath: string} — children slot
- Carousel: {items: [{title, description}]}

DISPLAY:
- Heading: {text: string, level: "h1"|"h2"|"h3"|"h4"}
- Text: {text: string, variant: "caption"|"body"|"muted"|"lead"|"code"}
- Image: {src: string|null, alt: string, width: number|null, height: number|null}
- Avatar: {src: string|null, name: string, size: "sm"|"md"|"lg"}
- Badge: {text: string, variant: "default"|"secondary"|"destructive"|"outline"}
- Alert: {title: string, message: string|null, type: "success"|"info"|"warning"|"error"}
- Progress: {value: number, max: number|null, label: string|null}
- Skeleton: {width: string|null, height: string|null, rounded: boolean|null}
- Spinner: {size: "sm"|"md"|"lg", label: string|null}
- Tooltip: {content: string, text: string}
- Popover: {trigger: string, content: string}
- Table: {columns: string[], rows: string[][], caption: string|null}

INPUT:
- Input: {label: string, name: string, type: "text"|"email"|"number"|"password", placeholder: string|null, value: string|null}
- Textarea: {label: string, name: string, placeholder: string|null, rows: number|null, value: string|null}
- Select: {label: string, name: string, options: string[], placeholder: string|null, value: string|null}
- Checkbox: {label: string, name: string, checked: boolean|null}
- Radio: {label: string, name: string, options: string[], value: string|null}
- Switch: {label: string, name: string, checked: boolean|null}
- Slider: {label: string|null, min: number|null, max: number|null, step: number|null, value: number|null}

ACTIONS:
- Button: {label: string, variant: "primary"|"secondary"|"danger", disabled: boolean|null} — events: [press]
- Link: {label: string, href: string} — events: [press]
- DropdownMenu: {label: string, items: [{label, value}], value: string|null} — events: [change]
- Toggle: {label: string, pressed: boolean|null, variant: "default"|"outline"} — events: [change]
- ToggleGroup: {items: [{label, value}], type: "single"|"multiple", value: string|null} — events: [change]
- ButtonGroup: {buttons: [{label, value}], selected: string|null} — events: [change]
- Pagination: {totalPages: number, page: number|null} — events: [change]

EXAMPLE — Sales Dashboard:
{"key":"root","type":"Stack","props":{"direction":"vertical","gap":"lg"},"children":["title","metrics","details"]}
{"key":"title","type":"Heading","props":{"text":"Sales Dashboard","level":"h1"}}
{"key":"metrics","type":"Grid","props":{"columns":3,"gap":"md"},"children":["rev","deals","rate"]}
{"key":"rev","type":"Card","props":{"title":"Revenue"},"children":["rev-val"]}
{"key":"rev-val","type":"Text","props":{"text":"$1,234,567","variant":"lead"}}
{"key":"deals","type":"Card","props":{"title":"Active Deals"},"children":["deals-val"]}
{"key":"deals-val","type":"Text","props":{"text":"47","variant":"lead"}}
{"key":"rate","type":"Card","props":{"title":"Win Rate"},"children":["rate-bar"]}
{"key":"rate-bar","type":"Progress","props":{"value":68,"max":100,"label":"68%"}}
{"key":"details","type":"Card","props":{"title":"Recent Deals"},"children":["deals-table"]}
{"key":"deals-table","type":"Table","props":{"columns":["Deal","Stage","Value","Close Date"],"rows":[["Acme Corp","Negotiation","$45,000","Mar 15"],["Beta Inc","Proposal","$32,000","Mar 22"],["Gamma LLC","Discovery","$18,500","Apr 1"]]}}`;

// ── Slack deep fetch: channels + recent messages ─────────────────────

async function fetchSlackData(apiKey: string): Promise<any> {
  const slackGet = async (method: string, params: Record<string, string> = {}): Promise<any> => {
    const qs = new URLSearchParams(params).toString();
    const url = `https://slack.com/api/${method}${qs ? '?' + qs : ''}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    return res.json() as Promise<any>;
  };

  // Resolve user IDs to display names (cached for the session)
  const userCache: Record<string, string> = {};
  const resolveUser = async (userId: string): Promise<string> => {
    if (!userId || userId === 'unknown') return 'unknown';
    if (userCache[userId]) return userCache[userId];
    try {
      const info: any = await slackGet('users.info', { user: userId });
      const name = info.ok ? (info.user?.real_name || info.user?.name || userId) : userId;
      userCache[userId] = name;
      return name;
    } catch { return userId; }
  };

  // Fetch all conversation types: public, private, DMs, group DMs
  const channelList: any = await slackGet('conversations.list', {
    limit: '50',
    exclude_archived: 'true',
    types: 'public_channel,private_channel,im,mpim',
  });
  if (!channelList.ok) return channelList;

  const allConvs = channelList.channels || [];
  const channels = allConvs.filter((c: any) => !c.is_im && !c.is_mpim);
  const dms = allConvs.filter((c: any) => c.is_im);
  const groupDms = allConvs.filter((c: any) => c.is_mpim);

  const enrichChannel = async (ch: any) => {
    await slackGet('conversations.join', { channel: ch.id }).catch(() => {});
    const history: any = await slackGet('conversations.history', { channel: ch.id, limit: '10' });
    const messages = history.ok ? history.messages : [];

    // Resolve user names in messages
    const resolvedMessages = [];
    for (const m of messages) {
      resolvedMessages.push({
        user: await resolveUser(m.user || m.bot_id || 'unknown'),
        text: (m.text || '').slice(0, 300),
        ts: m.ts,
      });
    }

    return {
      id: ch.id,
      name: ch.name || ch.name_normalized || `DM`,
      purpose: ch.purpose?.value || '',
      topic: ch.topic?.value || '',
      num_members: ch.num_members,
      is_private: ch.is_private || false,
      is_im: ch.is_im || false,
      is_mpim: ch.is_mpim || false,
      recent_messages: resolvedMessages,
    };
  };

  // Enrich channels (up to 10)
  const enrichedChannels = [];
  for (const ch of channels.slice(0, 10)) {
    enrichedChannels.push(await enrichChannel(ch));
  }

  // Enrich DMs — resolve the other user's name for display
  const enrichedDMs = [];
  for (const dm of dms.slice(0, 10)) {
    const otherUser = await resolveUser(dm.user);
    const enriched = await enrichChannel(dm);
    enriched.name = `DM with ${otherUser}`;
    enrichedDMs.push(enriched);
  }

  // Enrich group DMs
  const enrichedGroupDMs = [];
  for (const gdm of groupDms.slice(0, 5)) {
    enrichedGroupDMs.push(await enrichChannel(gdm));
  }

  return {
    ok: true,
    channels: enrichedChannels,
    direct_messages: enrichedDMs,
    group_dms: enrichedGroupDMs,
    total_channels: channels.length,
    total_dms: dms.length,
    total_group_dms: groupDms.length,
  };
}

async function fetchSlackViaNango(integrationId: string, connectionId: string): Promise<any> {
  const channelList = await proxyRequest({
    integrationId, connectionId,
    endpoint: '/conversations.list?limit=20&exclude_archived=true',
    method: 'GET', retries: 2,
  });

  const channels = channelList?.data?.channels || [];
  const enriched = [];

  for (const ch of channels.slice(0, 10)) {
    await proxyRequest({
      integrationId, connectionId,
      endpoint: `/conversations.join`,
      method: 'POST', data: { channel: ch.id }, retries: 1,
    }).catch(() => {});

    let history: any = { messages: [] };
    try {
      history = await proxyRequest({
        integrationId, connectionId,
        endpoint: `/conversations.history?channel=${ch.id}&limit=10`,
        method: 'GET', retries: 1,
      });
    } catch { /* channel might block reads */ }

    enriched.push({
      id: ch.id,
      name: ch.name,
      purpose: ch.purpose?.value || '',
      topic: ch.topic?.value || '',
      num_members: ch.num_members,
      is_archived: ch.is_archived,
      recent_messages: (history?.data?.messages || []).map((m: any) => ({
        user: m.user || m.bot_id || 'unknown',
        text: (m.text || '').slice(0, 300),
        ts: m.ts,
      })),
    });
  }

  return { ok: true, channels: enriched, total_channels: channels.length };
}

// ── Data Fetch Pipeline ──────────────────────────────────────────────
// Fetches real data from connected sources before generating UI

interface DataSourceConfig {
  sources: Array<{
    id: string;
    type: 'nango' | 'webhook';
    integrationId?: string;
    connectionId?: string;
    endpoint?: string;
    displayName: string;
    webhookId?: string;
  }>;
}

interface FetchedData {
  sourceId: string;
  sourceName: string;
  sourceType: string;
  data: any;
  error?: string;
}

async function fetchDataFromSources(dataSources: DataSourceConfig): Promise<FetchedData[]> {
  const results: FetchedData[] = [];

  for (const source of dataSources.sources) {
    try {
      if (source.type === 'nango' && source.integrationId) {
        const id = source.integrationId.toLowerCase();

        // Slack needs a multi-step fetch (channels + join + history)
        if (id.includes('slack')) {
          let slackData: any = null;
          let usedDirect = false;

          const slackKey = await getVaultKey('slack_bot');
          if (slackKey) {
            try {
              logActivity('canvas', 'info', `Fetching Slack data (direct)...`);
              slackData = await fetchSlackData(slackKey);
              usedDirect = true;
            } catch (e: any) {
              logActivity('canvas', 'info', `Slack direct failed: ${e.message} — trying Nango`);
            }
          }

          if (!slackData && source.connectionId && isNangoConfigured()) {
            try {
              logActivity('canvas', 'info', `Fetching Slack data (Nango)...`);
              slackData = await fetchSlackViaNango(source.integrationId, source.connectionId);
            } catch (e: any) {
              logActivity('canvas', 'warning', `Slack Nango failed: ${e.message}`);
            }
          }

          results.push({
            sourceId: source.id,
            sourceName: source.displayName,
            sourceType: usedDirect ? 'direct' : 'nango',
            data: slackData,
            error: slackData ? undefined : 'Could not fetch Slack data',
          });
          if (slackData) logActivity('canvas', 'success', `Slack data fetched (${usedDirect ? 'direct' : 'nango'})`);
          continue;
        }

        // Generic path: direct vault key first, Nango fallback
        const guessed = guessEndpointConfig(source.integrationId);
        const endpoint = source.endpoint && source.endpoint !== '/'
          ? source.endpoint
          : guessed.endpoint;
        const method = guessed.method;

        let response: any = null;
        let usedDirect = false;

        try {
          logActivity('canvas', 'info', `Trying direct API for ${source.displayName}...`);
          response = await tryDirectFetch(source.integrationId, endpoint, method);
          if (response) usedDirect = true;
        } catch (directErr: any) {
          logActivity('canvas', 'info', `Direct API failed for ${source.displayName}: ${directErr.message} — trying Nango`);
        }

        if (!response && source.connectionId && isNangoConfigured()) {
          logActivity('canvas', 'info', `Fetching ${source.displayName} via Nango proxy...`);
          response = await proxyRequest({
            integrationId: source.integrationId,
            connectionId: source.connectionId,
            endpoint,
            method,
            retries: 2,
          });
        }

        if (!response) {
          results.push({
            sourceId: source.id,
            sourceName: source.displayName,
            sourceType: 'nango',
            data: null,
            error: 'No vault key found and Nango not configured',
          });
          continue;
        }

        results.push({
          sourceId: source.id,
          sourceName: source.displayName,
          sourceType: usedDirect ? 'direct' : 'nango',
          data: response?.data || response,
        });

        logActivity('canvas', 'success', `Data fetched from ${source.displayName} (${usedDirect ? 'direct' : 'nango'})`);
      } else if (source.type === 'webhook' && source.webhookId) {
        logActivity('canvas', 'info', `Fetching data from webhook: ${source.displayName}...`);

        const data = await fetchWebhookData(source.webhookId);
        results.push({
          sourceId: source.id,
          sourceName: source.displayName,
          sourceType: 'webhook',
          data,
        });

        logActivity('canvas', 'success', `Webhook data fetched: ${source.displayName}`);
      }
    } catch (err: any) {
      console.error(`[canvas] Failed to fetch data from ${source.displayName}:`, err);
      results.push({
        sourceId: source.id,
        sourceName: source.displayName,
        sourceType: source.type,
        data: null,
        error: err.message,
      });
    }
  }

  return results;
}

function guessEndpointConfig(integrationId: string): { endpoint: string; method: 'GET' | 'POST' } {
  const id = integrationId.toLowerCase();
  // Common API endpoints by integration type — some need POST (e.g. Notion search)
  if (id.includes('hubspot')) return { endpoint: '/crm/v3/objects/contacts?limit=20', method: 'GET' };
  if (id.includes('salesforce')) return { endpoint: '/services/data/v66.0/query?q=SELECT+Id,Name,Amount+FROM+Opportunity+LIMIT+20', method: 'GET' };
  if (id.includes('notion')) return { endpoint: '/v1/search', method: 'POST' };
  if (id.includes('stripe')) return { endpoint: '/v1/charges?limit=20', method: 'GET' };
  if (id.includes('github')) return { endpoint: '/user/repos?per_page=20&sort=updated', method: 'GET' };
  if (id.includes('slack')) return { endpoint: '/conversations.list?limit=20', method: 'GET' };
  if (id.includes('linear')) return { endpoint: '/graphql', method: 'POST' };
  if (id.includes('jira')) return { endpoint: '/rest/api/3/search/jql?maxResults=20', method: 'GET' };
  if (id.includes('airtable')) return { endpoint: '/v0/meta/bases', method: 'GET' };
  if (id.includes('google-mail')) return { endpoint: '/gmail/v1/users/me/messages?maxResults=20', method: 'GET' };
  if (id.includes('google-drive')) return { endpoint: '/drive/v3/files?pageSize=20', method: 'GET' };
  if (id.includes('pipedrive')) return { endpoint: '/v1/deals?limit=20', method: 'GET' };
  if (id.includes('zoho')) return { endpoint: '/crm/v2/Deals?per_page=20', method: 'GET' };
  if (id.includes('quickbooks')) return { endpoint: '/v3/company/query?query=SELECT * FROM Invoice MAXRESULTS 20', method: 'GET' };
  if (id.includes('xero')) return { endpoint: '/api.xro/2.0/Invoices?pageSize=20', method: 'GET' };
  if (id.includes('mailchimp')) return { endpoint: '/3.0/lists?count=20', method: 'GET' };
  if (id.includes('intercom')) return { endpoint: '/contacts?per_page=20', method: 'GET' };
  // Default — try root
  return { endpoint: '/', method: 'GET' };
}

function summarizeData(fetchedData: FetchedData[]): string {
  const parts: string[] = [];

  for (const item of fetchedData) {
    if (item.error) {
      parts.push(`[${item.sourceName}]: Error — ${item.error}. Design a placeholder showing the connection needs to be configured.`);
      continue;
    }

    if (!item.data) {
      parts.push(`[${item.sourceName}]: No data returned. Show an empty state.`);
      continue;
    }

    // Truncate large data to keep prompt manageable
    const dataStr = JSON.stringify(item.data);
    const truncated = dataStr.length > 4000
      ? dataStr.slice(0, 4000) + '... [truncated]'
      : dataStr;

    parts.push(`[${item.sourceName}] (${item.sourceType}):\n${truncated}`);
  }

  return parts.join('\n\n');
}

// ── Integration Auto-Detection ──────────────────────────────────────────

interface DetectedIntegration {
  service: string;
  vaultKeyId?: string;
  nangoIntegration?: string;
  endpoint?: string;
}

function detectIntegrations(prompt: string): DetectedIntegration[] {
  const lower = prompt.toLowerCase();
  const detected: DetectedIntegration[] = [];

  const INTEGRATION_MAP: Array<{
    keywords: string[];
    service: string;
    vaultKeyId?: string;
    nangoIntegration?: string;
    endpoint?: string;
  }> = [
    { keywords: ['notion'], service: 'Notion', vaultKeyId: 'notion', nangoIntegration: 'notion', endpoint: '/v1/search' },
    { keywords: ['slack', 'slack messages', 'slack channels'], service: 'Slack', vaultKeyId: 'slack_bot', nangoIntegration: 'slack', endpoint: '/conversations.list?limit=20' },
    { keywords: ['quickbooks', 'qb ', 'p&l', 'profit and loss', 'profit & loss'], service: 'QuickBooks', nangoIntegration: 'quickbooks', endpoint: '/v3/company/query?query=SELECT * FROM Invoice MAXRESULTS 20' },
    { keywords: ['hubspot', 'crm deals', 'sales pipeline'], service: 'HubSpot', nangoIntegration: 'hubspot', endpoint: '/crm/v3/objects/contacts?limit=20' },
    { keywords: ['salesforce'], service: 'Salesforce', nangoIntegration: 'salesforce' },
    { keywords: ['github', 'repos', 'repositories', 'pull requests'], service: 'GitHub', nangoIntegration: 'github', endpoint: '/user/repos?per_page=20&sort=updated' },
    { keywords: ['stripe', 'payments', 'charges', 'subscriptions'], service: 'Stripe', nangoIntegration: 'stripe', endpoint: '/v1/charges?limit=20' },
    { keywords: ['gmail', 'email', 'inbox', 'emails'], service: 'Gmail', nangoIntegration: 'google-mail' },
    { keywords: ['google drive', 'gdrive', 'drive files'], service: 'Google Drive', nangoIntegration: 'google-drive', endpoint: '/drive/v3/files?pageSize=20' },
    { keywords: ['jira', 'tickets', 'issues'], service: 'Jira', nangoIntegration: 'jira', endpoint: '/rest/api/3/search/jql?maxResults=20' },
    { keywords: ['linear'], service: 'Linear', nangoIntegration: 'linear' },
    { keywords: ['airtable'], service: 'Airtable', nangoIntegration: 'airtable', endpoint: '/v0/meta/bases' },
    { keywords: ['mailchimp', 'email campaign', 'newsletter'], service: 'Mailchimp', nangoIntegration: 'mailchimp', endpoint: '/3.0/lists?count=20' },
    { keywords: ['shopify', 'store', 'ecommerce', 'e-commerce'], service: 'Shopify', nangoIntegration: 'shopify' },
    { keywords: ['intercom', 'support tickets'], service: 'Intercom', nangoIntegration: 'intercom', endpoint: '/contacts?per_page=20' },
    { keywords: ['brave search', 'web search', 'search the web', 'research'], service: 'Brave Search', vaultKeyId: 'brave_search' },
    { keywords: ['x.com', 'twitter', 'tweets'], service: 'X/Twitter', vaultKeyId: 'x_api' },
    { keywords: ['xero', 'accounting'], service: 'Xero', nangoIntegration: 'xero', endpoint: '/api.xro/2.0/Invoices?pageSize=20' },
    { keywords: ['pipedrive'], service: 'Pipedrive', nangoIntegration: 'pipedrive', endpoint: '/v1/deals?limit=20' },
  ];

  for (const mapping of INTEGRATION_MAP) {
    if (mapping.keywords.some(kw => lower.includes(kw))) {
      detected.push({
        service: mapping.service,
        vaultKeyId: mapping.vaultKeyId,
        nangoIntegration: mapping.nangoIntegration,
        endpoint: mapping.endpoint,
      });
    }
  }

  return detected;
}

// ── Generate endpoint — streams JSONL via SSE ──────────────────────────

canvasRouter.post('/generate', async (req: Request, res: Response) => {
  await ensureSchema();

  const { prompt, currentSpec, pageId, dataSources } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  logActivity('canvas', 'info', `Generating UI: "${prompt.slice(0, 60)}..."`);

  // ── Step 1: Fetch real data from connected sources ────────────────
  let fetchedDataContext = '';
  let dataSourceConfig: DataSourceConfig | null = dataSources || null;

  // If we have a pageId but no dataSources in the request, look them up from the DB
  if (!dataSourceConfig && pageId) {
    try {
      const page = await getPage(pageId);
      if (page?.data_sources) {
        dataSourceConfig = page.data_sources as unknown as DataSourceConfig;
      }
    } catch {
      // Page might not have data sources — that's fine
    }
  }

  if (dataSourceConfig?.sources?.length) {
    logActivity('canvas', 'info', `Fetching data from ${dataSourceConfig.sources.length} source(s)...`);

    const fetchedData = await fetchDataFromSources(dataSourceConfig);
    fetchedDataContext = summarizeData(fetchedData);

    if (fetchedDataContext) {
      logActivity('canvas', 'success', `Data fetched from ${fetchedData.filter(d => !d.error).length}/${fetchedData.length} source(s)`);
    }
  }

  // ── Step 1b: Auto-fetch from detected integrations if no explicit sources ──
  // If the user didn't go through the wizard but mentions a service in the prompt,
  // check for active Nango connections and fetch data automatically.
  if (!fetchedDataContext && isNangoConfigured()) {
    const detectedForFetch = detectIntegrations(prompt);
    if (detectedForFetch.length > 0) {
      try {
        // Look up active Nango connections from DB
        const connResult = await query(
          `SELECT connection_id, integration_id, display_name FROM integration_connections WHERE status = 'active'`
        );
        const activeConns = connResult.rows;

        if (activeConns.length > 0) {
          const autoSources: DataSourceConfig = { sources: [] };

          for (const detected of detectedForFetch) {
            if (!detected.nangoIntegration) continue;

            // Find a matching active connection
            const match = activeConns.find((c: any) =>
              c.integration_id?.toLowerCase().includes(detected.nangoIntegration!.toLowerCase())
            );

            if (match) {
              const config = guessEndpointConfig(match.integration_id);
              autoSources.sources.push({
                id: `auto_${match.connection_id}`,
                type: 'nango',
                integrationId: match.integration_id,
                connectionId: match.connection_id,
                endpoint: detected.endpoint || config.endpoint,
                displayName: match.display_name || detected.service,
              });
              logActivity('canvas', 'info', `Auto-detected ${detected.service} connection: ${match.connection_id}`);
            }
          }

          if (autoSources.sources.length > 0) {
            logActivity('canvas', 'info', `Auto-fetching data from ${autoSources.sources.length} detected connection(s)...`);
            const fetchedData = await fetchDataFromSources(autoSources);
            fetchedDataContext = summarizeData(fetchedData);

            if (fetchedDataContext) {
              logActivity('canvas', 'success', `Auto-fetch: ${fetchedData.filter(d => !d.error).length}/${fetchedData.length} source(s) returned data`);

              // Save auto-detected sources to the page for future refreshes
              if (pageId) {
                try {
                  await updatePage(pageId, { data_sources: autoSources as any });
                } catch {
                  // Non-critical — page will still render
                }
              }
            }
          }
        }
      } catch (err: any) {
        logActivity('canvas', 'warning', `Auto-detection fetch failed: ${err.message}`);
      }
    }
  }

  // ── Step 2: Build messages with real data context ─────────────────
  const messages: any[] = [
    { role: 'system', content: CATALOG_SYSTEM_PROMPT },
  ];

  // If we have real data, inject it as context
  if (fetchedDataContext) {
    messages.push({
      role: 'system',
      content: `REAL DATA FROM CONNECTED SOURCES — Use this actual data to populate the UI. Do NOT use placeholder values when real data is available. Display the actual values, names, numbers, dates, etc. from this data:\n\n${fetchedDataContext}`,
    });
  }

  // If editing an existing spec, include it as context
  if (currentSpec) {
    messages.push({
      role: 'user',
      content: `Current UI state:\n${JSON.stringify(currentSpec, null, 2)}`,
    });
    messages.push({
      role: 'assistant',
      content: 'I see the current UI. What changes would you like?',
    });
  }

  messages.push({ role: 'user', content: prompt });

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // ── Step 3: Detect integrations from the prompt and emit status ────
  const detectedIntegrations = detectIntegrations(prompt);
  if (detectedIntegrations.length > 0) {
    for (const integration of detectedIntegrations) {
      if (integration.vaultKeyId) {
        try {
          const keyResult = await query(
            `SELECT key FROM settings WHERE key = $1`,
            [`vault.${integration.vaultKeyId}`]
          );
          if (keyResult.rows.length === 0) {
            res.write(`data: ${JSON.stringify({
              type: 'integration_status',
              service: integration.service,
              status: 'missing_key',
              message: `${integration.service} requires an API key. Add it in Settings \u2192 Security \u2192 Key Vault.`,
              keyId: integration.vaultKeyId,
            })}\n\n`);
            if (typeof (res as any).flush === 'function') {
              (res as any).flush();
            }
          } else {
            res.write(`data: ${JSON.stringify({
              type: 'integration_status',
              service: integration.service,
              status: 'connected',
              message: `${integration.service} API key found.`,
              keyId: integration.vaultKeyId,
            })}\n\n`);
            if (typeof (res as any).flush === 'function') {
              (res as any).flush();
            }
          }
        } catch {
          // DB query failed — skip status check
        }
      }

      if (integration.nangoIntegration) {
        if (isNangoConfigured()) {
          res.write(`data: ${JSON.stringify({
            type: 'integration_status',
            service: integration.service,
            status: 'nango_available',
            message: `Nango is configured. ${integration.service} can be connected via OAuth.`,
            nangoIntegration: integration.nangoIntegration,
          })}\n\n`);
          if (typeof (res as any).flush === 'function') {
            (res as any).flush();
          }
        }
      }
    }
  }

  try {
    const response = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LITELLM_KEY}`,
      },
      body: JSON.stringify({
        model: 'coder',
        messages,
        temperature: 0.3,
        max_tokens: 8192,
        stream: true,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      res.write(`data: ${JSON.stringify({ error: `LLM error: ${response.status}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      res.write(`data: ${JSON.stringify({ error: 'No response body' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullContent += delta;
          }
        } catch {
          // Skip malformed SSE
        }
      }

      // Parse complete JSONL lines from fullContent and forward them
      const contentLines = fullContent.split('\n');
      // Keep the last (potentially incomplete) line in fullContent
      const completedLines = contentLines.slice(0, -1);

      for (const cl of completedLines) {
        const trimmed = cl.trim();
        if (!trimmed) continue;
        try {
          // Validate it's valid JSON before forwarding
          JSON.parse(trimmed);
          res.write(`data: ${trimmed}\n\n`);
          if (typeof (res as any).flush === 'function') {
            (res as any).flush();
          }
        } catch {
          // Not valid JSON yet, skip
        }
      }

      // Keep only the last incomplete line
      fullContent = contentLines[contentLines.length - 1] || '';
    }

    // Handle any remaining content
    const remaining = fullContent.trim();
    if (remaining) {
      try {
        JSON.parse(remaining);
        res.write(`data: ${remaining}\n\n`);
      } catch {
        // Skip incomplete JSON
      }
    }

    // If we have a pageId, save the complete spec
    if (pageId) {
      try {
        // Reconstruct full content from what we streamed
        // The frontend will send the assembled spec back for persistence
        logActivity('canvas', 'info', `Page ${pageId} spec updated`);
      } catch (err) {
        console.error('[canvas] Failed to save spec:', err);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

    logActivity('canvas', 'success', 'UI generation complete');
  } catch (err: any) {
    console.error('[canvas] Generate error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// ── Page CRUD ──────────────────────────────────────────────────────────

canvasRouter.get('/pages', async (_req: Request, res: Response) => {
  await ensureSchema();
  try {
    const pages = await listPages();
    res.json(pages);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

canvasRouter.post('/pages', async (req: Request, res: Response) => {
  await ensureSchema();
  try {
    const page = await createPage(req.body);
    logActivity('canvas', 'success', `New page: ${page.name}`);
    res.status(201).json(page);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

canvasRouter.get('/pages/:id', async (req: Request, res: Response) => {
  await ensureSchema();
  try {
    const page = await getPage(req.params.id as string);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    res.json(page);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

canvasRouter.put('/pages/:id', async (req: Request, res: Response) => {
  await ensureSchema();
  try {
    const page = await updatePage(req.params.id as string, req.body);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    logActivity('canvas', 'success', `Page updated: ${page.name}`);
    res.json(page);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

canvasRouter.delete('/pages/:id', async (req: Request, res: Response) => {
  await ensureSchema();
  try {
    const deleted = await deletePage(req.params.id as string);
    if (!deleted) return res.status(404).json({ error: 'Page not found' });
    logActivity('canvas', 'success', `Page deleted`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

canvasRouter.post('/pages/:id/duplicate', async (req: Request, res: Response) => {
  await ensureSchema();
  try {
    const { name } = req.body;
    const page = await duplicatePage(req.params.id as string, name || 'Copy');
    if (!page) return res.status(404).json({ error: 'Source page not found' });
    logActivity('canvas', 'success', `Page duplicated: ${page.name}`);
    res.status(201).json(page);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Data Refresh ────────────────────────────────────────────────────────
// Fetches fresh data from connected sources and returns it
// The frontend can use this to re-generate or update the canvas

canvasRouter.post('/pages/:id/refresh', async (req: Request, res: Response) => {
  await ensureSchema();
  try {
    const page = await getPage(req.params.id as string);
    if (!page) return res.status(404).json({ error: 'Page not found' });

    if (!page.data_sources) {
      return res.status(400).json({ error: 'Page has no connected data sources' });
    }

    const dataSourceConfig = page.data_sources as unknown as DataSourceConfig;
    if (!dataSourceConfig.sources?.length) {
      return res.status(400).json({ error: 'Page has no data sources configured' });
    }

    logActivity('canvas', 'info', `Refreshing data for page: ${page.name}`);

    const fetchedData = await fetchDataFromSources(dataSourceConfig);
    const successCount = fetchedData.filter(d => !d.error).length;

    logActivity('canvas', successCount > 0 ? 'success' : 'warning',
      `Data refresh: ${successCount}/${fetchedData.length} sources succeeded`);

    res.json({
      data: fetchedData,
      summary: summarizeData(fetchedData),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
