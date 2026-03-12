import { Router, Request, Response } from 'express';
import { query } from '../services/database';
import { logActivity } from '../services/activity-broadcaster';
import crypto from 'crypto';

export const settingsRouter = Router();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex').subarray(0, 32), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(text: string): string {
  const [ivHex, authTagHex, encrypted] = text.split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(ENCRYPTION_KEY, 'hex').subarray(0, 32),
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Get all settings (non-encrypted values only, encrypted shown as ***)
settingsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await query('SELECT key, value, encrypted, updated_at FROM settings ORDER BY key');
    const settings = result.rows.map((row: any) => ({
      key: row.key,
      value: row.encrypted ? '***' : row.value,
      encrypted: row.encrypted,
      updated_at: row.updated_at,
    }));
    res.json({ settings });
  } catch {
    // Return defaults if DB is down
    res.json({ settings: [] });
  }
});

// Get a specific setting
settingsRouter.get('/:key', async (req: Request, res: Response) => {
  try {
    const result = await query('SELECT value, encrypted FROM settings WHERE key = $1', [req.params.key]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Setting not found' });
    }

    const row = result.rows[0];
    const value = row.encrypted ? decrypt(row.value) : row.value;
    res.json({ key: req.params.key, value });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Set a setting
settingsRouter.put('/:key', async (req: Request, res: Response) => {
  try {
    const { value, sensitive = false } = req.body;
    if (value === undefined) {
      return res.status(400).json({ error: 'Value is required' });
    }

    const storedValue = sensitive ? encrypt(String(value)) : String(value);

    await query(
      `INSERT INTO settings (key, value, encrypted, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, encrypted = $3, updated_at = NOW()`,
      [req.params.key, storedValue, sensitive]
    );

    logActivity('api', 'success', `Setting updated: ${req.params.key}`);
    res.json({ key: req.params.key, saved: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Delete a setting
settingsRouter.delete('/:key', async (req: Request, res: Response) => {
  try {
    await query('DELETE FROM settings WHERE key = $1', [req.params.key]);
    res.json({ deleted: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Bulk update settings
settingsRouter.post('/bulk', async (req: Request, res: Response) => {
  try {
    const { settings } = req.body;
    if (!Array.isArray(settings)) {
      return res.status(400).json({ error: 'settings array is required' });
    }

    for (const s of settings) {
      const storedValue = s.sensitive ? encrypt(String(s.value)) : String(s.value);
      await query(
        `INSERT INTO settings (key, value, encrypted, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, encrypted = $3, updated_at = NOW()`,
        [s.key, storedValue, s.sensitive || false]
      );
    }

    logActivity('api', 'success', `${settings.length} settings updated`);
    res.json({ saved: settings.length });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ═══════════════════════════════════════════════════════════
// KEY VAULT — Encrypted API Key Management
// ═══════════════════════════════════════════════════════════

/**
 * Pre-defined service registry. Users can also add custom keys.
 * Keys are stored encrypted in the settings table with the prefix "vault.".
 */
interface VaultKeyDef {
  id: string;
  name: string;
  envVar: string;
  category: 'ai' | 'media' | 'communication' | 'search' | 'infrastructure' | 'business' | 'development';
  placeholder: string;
  description: string;
}

const KEY_REGISTRY: VaultKeyDef[] = [
  // AI Providers
  { id: 'anthropic', name: 'Anthropic', envVar: 'ANTHROPIC_API_KEY', category: 'ai', placeholder: 'sk-ant-...', description: 'Powers Claude models via LiteLLM (required)' },
  { id: 'openai', name: 'OpenAI', envVar: 'OPENAI_API_KEY', category: 'ai', placeholder: 'sk-proj-...', description: 'Powers GPT models (codex, crosscheck, critic tiers)' },
  { id: 'gemini', name: 'Google Gemini', envVar: 'GEMINI_API_KEY', category: 'ai', placeholder: 'AIza...', description: 'Powers creative tier (Gemini models)' },
  { id: 'grok', name: 'Grok (xAI)', envVar: 'GROK_API_KEY', category: 'ai', placeholder: 'xai-...', description: 'xAI Grok models' },
  { id: 'manus', name: 'Manus', envVar: 'MANUS_API_KEY', category: 'ai', placeholder: 'sk-...', description: 'Manus AI agent platform' },
  // Media & Voice
  { id: 'elevenlabs', name: 'ElevenLabs', envVar: 'ELEVENLABS_API_KEY', category: 'media', placeholder: 'sk_...', description: 'Voice synthesis and text-to-speech' },
  { id: 'runway', name: 'Runway', envVar: 'RUNWAY_API_KEY', category: 'media', placeholder: 'key_...', description: 'AI video generation' },
  { id: 'heygen', name: 'HeyGen', envVar: 'HEYGEN_API_KEY', category: 'media', placeholder: 'sk_...', description: 'AI avatar video creation' },
  { id: 'deepgram', name: 'DeepGram', envVar: 'DEEPGRAM_API_KEY', category: 'media', placeholder: '', description: 'Real-time speech-to-text transcription' },
  { id: 'kling', name: 'Kling Access Key', envVar: 'KLING_API_KEY', category: 'media', placeholder: '', description: 'Kling AI access key (API key)' },
  { id: 'kling_secret', name: 'Kling Secret Key', envVar: 'KLING_SECRET_KEY', category: 'media', placeholder: '', description: 'Kling AI secret key (required with access key)' },
  // Communication
  { id: 'slack_bot', name: 'Slack Bot Token', envVar: 'SLACK_BOT_TOKEN', category: 'communication', placeholder: 'xoxb-...', description: 'Slack bot API token' },
  { id: 'slack_app', name: 'Slack App Token', envVar: 'SLACK_APP_TOKEN', category: 'communication', placeholder: 'xapp-...', description: 'Slack app-level token (Socket Mode)' },
  { id: 'slack_signing', name: 'Slack Signing Secret', envVar: 'SLACK_SIGNING_SECRET', category: 'communication', placeholder: '', description: 'Slack request verification secret' },
  // Search & Data
  { id: 'brave_search', name: 'Brave Search', envVar: 'BRAVE_SEARCH_API_KEY', category: 'search', placeholder: 'BSA...', description: 'Web search API' },
  { id: 'x_api', name: 'X / Twitter API', envVar: 'X_API_TOKEN', category: 'search', placeholder: '', description: 'X/Twitter data access' },
  { id: 'serper', name: 'Serper (Google Search)', envVar: 'SERPER_API_KEY', category: 'search', placeholder: '', description: 'Google Search results API — fast, structured search data' },
  { id: 'serpapi', name: 'SerpAPI', envVar: 'SERPAPI_API_KEY', category: 'search', placeholder: '', description: 'Search engine results from Google, Bing, YouTube, etc.' },
  // Business & Productivity
  { id: 'quickbooks_client_id', name: 'QuickBooks Client ID', envVar: 'QUICKBOOKS_CLIENT_ID', category: 'business', placeholder: '', description: 'Intuit QuickBooks OAuth client ID' },
  { id: 'quickbooks_client_secret', name: 'QuickBooks Client Secret', envVar: 'QUICKBOOKS_CLIENT_SECRET', category: 'business', placeholder: '', description: 'Intuit QuickBooks OAuth client secret' },
  { id: 'notion', name: 'Notion Integration Token', envVar: 'NOTION_API_KEY', category: 'business', placeholder: 'ntn_...', description: 'Notion internal integration token — access databases, pages, and blocks' },
  { id: 'notion_oauth_client', name: 'Notion OAuth Client ID', envVar: 'NOTION_OAUTH_CLIENT_ID', category: 'business', placeholder: '', description: 'Notion public integration OAuth client ID (for multi-user access)' },
  { id: 'notion_oauth_secret', name: 'Notion OAuth Client Secret', envVar: 'NOTION_OAUTH_CLIENT_SECRET', category: 'business', placeholder: '', description: 'Notion public integration OAuth client secret' },
  { id: 'google_client_id', name: 'Google OAuth Client ID', envVar: 'GOOGLE_CLIENT_ID', category: 'business', placeholder: '', description: 'Google Cloud OAuth — Gmail, Drive, Calendar, Sheets access' },
  { id: 'google_client_secret', name: 'Google OAuth Client Secret', envVar: 'GOOGLE_CLIENT_SECRET', category: 'business', placeholder: '', description: 'Google Cloud OAuth client secret' },
  { id: 'hubspot', name: 'HubSpot', envVar: 'HUBSPOT_API_KEY', category: 'business', placeholder: 'pat-...', description: 'CRM — contacts, deals, pipelines, marketing automation' },
  { id: 'airtable', name: 'Airtable', envVar: 'AIRTABLE_API_KEY', category: 'business', placeholder: 'pat...', description: 'Airtable personal access token — databases and automations' },
  { id: 'stripe', name: 'Stripe Secret Key', envVar: 'STRIPE_SECRET_KEY', category: 'business', placeholder: 'sk_live_...', description: 'Payments — invoices, subscriptions, customer data' },
  { id: 'shopify', name: 'Shopify Admin Token', envVar: 'SHOPIFY_ADMIN_TOKEN', category: 'business', placeholder: 'shpat_...', description: 'Shopify Admin API — products, orders, customers' },
  // Development & DevOps
  { id: 'github', name: 'GitHub Token', envVar: 'GITHUB_TOKEN', category: 'development', placeholder: 'ghp_...', description: 'GitHub personal access token — repos, issues, PRs, Actions' },
  { id: 'linear', name: 'Linear', envVar: 'LINEAR_API_KEY', category: 'development', placeholder: 'lin_api_...', description: 'Project management — issues, cycles, teams' },
  { id: 'vercel', name: 'Vercel', envVar: 'VERCEL_TOKEN', category: 'development', placeholder: '', description: 'Deploy and manage Vercel projects and domains' },
  { id: 'supabase', name: 'Supabase', envVar: 'SUPABASE_SERVICE_KEY', category: 'development', placeholder: 'eyJ...', description: 'Supabase service role key — database, auth, storage' },
  { id: 'sendgrid', name: 'SendGrid', envVar: 'SENDGRID_API_KEY', category: 'communication', placeholder: 'SG....', description: 'Transactional and marketing email delivery' },
  { id: 'twilio_sid', name: 'Twilio Account SID', envVar: 'TWILIO_ACCOUNT_SID', category: 'communication', placeholder: 'AC...', description: 'Twilio account identifier for SMS, voice, and WhatsApp' },
  { id: 'twilio_token', name: 'Twilio Auth Token', envVar: 'TWILIO_AUTH_TOKEN', category: 'communication', placeholder: '', description: 'Twilio authentication token (pair with Account SID)' },
  // Infrastructure
  { id: 'anythingllm', name: 'AnythingLLM', envVar: 'ANYTHINGLLM_API_KEY', category: 'infrastructure', placeholder: '', description: 'RAG / document knowledge base auth token' },
  { id: 'litellm_master', name: 'LiteLLM Master Key', envVar: 'LITELLM_MASTER_KEY', category: 'infrastructure', placeholder: 'sk-litellm-...', description: 'Internal LiteLLM authentication' },
  { id: 'nango', name: 'Nango', envVar: 'NANGO_SECRET_KEY', category: 'infrastructure', placeholder: '', description: 'Integration platform — enables the Data Connection Wizard (optional)' },
];

const VAULT_PREFIX = 'vault.';

// ── GET /api/settings/vault/registry — List all key definitions with status ──

settingsRouter.get('/vault/registry', async (_req: Request, res: Response) => {
  try {
    // Get all vault keys from DB
    const result = await query(
      `SELECT key, updated_at FROM settings WHERE key LIKE $1`,
      [`${VAULT_PREFIX}%`]
    );
    const savedKeys = new Map(result.rows.map((r: any) => [r.key.replace(VAULT_PREFIX, ''), r.updated_at]));

    // Also check for custom keys
    const customKeys = result.rows
      .filter((r: any) => !KEY_REGISTRY.some(k => `${VAULT_PREFIX}${k.id}` === r.key))
      .map((r: any) => ({
        id: r.key.replace(VAULT_PREFIX, ''),
        name: r.key.replace(VAULT_PREFIX, '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        envVar: r.key.replace(VAULT_PREFIX, '').toUpperCase(),
        category: 'custom' as const,
        placeholder: '',
        description: 'User-defined key',
      }));

    const registry = [...KEY_REGISTRY, ...customKeys].map(k => ({
      ...k,
      configured: savedKeys.has(k.id),
      updatedAt: savedKeys.get(k.id) || null,
    }));

    res.json({ keys: registry });
  } catch {
    // DB down — return registry with all unconfigured
    res.json({
      keys: KEY_REGISTRY.map(k => ({ ...k, configured: false, updatedAt: null })),
    });
  }
});

// ── PUT /api/settings/vault/:keyId — Save an API key (always encrypted) ──

settingsRouter.put('/vault/:keyId', async (req: Request, res: Response) => {
  try {
    const keyId = req.params.keyId;
    const { value } = req.body;

    if (!value || typeof value !== 'string' || value.trim().length === 0) {
      return res.status(400).json({ error: 'value is required' });
    }

    const dbKey = `${VAULT_PREFIX}${keyId}`;
    const encrypted = encrypt(value.trim());

    await query(
      `INSERT INTO settings (key, value, encrypted, updated_at)
       VALUES ($1, $2, true, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, encrypted = true, updated_at = NOW()`,
      [dbKey, encrypted]
    );

    // Look up the human-readable name
    const def = KEY_REGISTRY.find(k => k.id === keyId);
    logActivity('api', 'success', `Key vault: ${def?.name || keyId} saved (encrypted)`);
    res.json({ keyId, saved: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── DELETE /api/settings/vault/:keyId — Remove a key ──

settingsRouter.delete('/vault/:keyId', async (req: Request, res: Response) => {
  try {
    const dbKey = `${VAULT_PREFIX}${req.params.keyId}`;
    await query('DELETE FROM settings WHERE key = $1', [dbKey]);
    logActivity('api', 'info', `Key vault: ${req.params.keyId} removed`);
    res.json({ deleted: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── GET /api/settings/vault/key/:keyId — Internal: Fetch decrypted key value ──
// Used by agents to access API keys at runtime.
// Returns the raw decrypted value — should NOT be exposed to browser.

settingsRouter.get('/vault/key/:keyId', async (req: Request, res: Response) => {
  try {
    const dbKey = `${VAULT_PREFIX}${req.params.keyId}`;
    const result = await query('SELECT value, encrypted FROM settings WHERE key = $1', [dbKey]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Key '${req.params.keyId}' not configured` });
    }

    const row = result.rows[0];
    const value = row.encrypted ? decrypt(row.value) : row.value;
    res.json({ keyId: req.params.keyId, value });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── GET /api/settings/vault/available — List which keys are configured (no values) ──
// Safe for agent system prompt injection — just names, no secrets.

settingsRouter.get('/vault/available', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT key FROM settings WHERE key LIKE $1`,
      [`${VAULT_PREFIX}%`]
    );
    const available = result.rows.map((r: any) => {
      const id = r.key.replace(VAULT_PREFIX, '');
      const def = KEY_REGISTRY.find(k => k.id === id);
      return { id, name: def?.name || id, envVar: def?.envVar || id.toUpperCase() };
    });
    res.json({ available });
  } catch {
    res.json({ available: [] });
  }
});

