/**
 * Slack Listener — Bidirectional Slack ↔ Overmind via Socket Mode
 *
 * Listens for incoming Slack messages (DMs and @mentions) and routes them
 * through the Overmind chat gateway — same brain, different interface.
 *
 * Flow:
 *   Slack message → Socket Mode → POST /api/overmind/chat → Agent Engine → Slack reply
 *
 * Tokens are read from the encrypted vault at startup.
 * If tokens aren't configured, the listener silently skips.
 *
 * IMPORTANT: Requires @slack/bolt and these Slack app settings:
 * - Socket Mode enabled
 * - Bot Token Scopes: chat:write, channels:read, app_mentions:read, im:history, im:read
 * - App-Level Token: connections:write
 */
import { App, LogLevel } from '@slack/bolt';
import { logActivity } from './activity-broadcaster';
import { query } from './database';
import crypto from 'crypto';

const API_PORT = parseInt(process.env.PORT || '3100', 10);
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

let slackApp: App | null = null;
let botUserId: string | null = null;

// ── Vault Access ──────────────────────────────────────────

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

async function getVaultKey(keyId: string): Promise<string | null> {
  try {
    const result = await query(
      `SELECT value, encrypted FROM settings WHERE key = $1`,
      [`vault.${keyId}`]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return row.encrypted ? decrypt(row.value) : row.value;
  } catch (err: any) {
    logActivity('slack', 'error', `Failed to read vault key "${keyId}": ${err.message}`);
    return null;
  }
}

// ── Conversation History ─────────────────────────────────

interface SlackConversationEntry {
  role: 'user' | 'assistant';
  content: string;
}

const conversationHistories = new Map<string, SlackConversationEntry[]>();
const MAX_HISTORY = 20;

function getHistory(channelId: string): SlackConversationEntry[] {
  return conversationHistories.get(channelId) || [];
}

function addToHistory(channelId: string, role: 'user' | 'assistant', content: string): void {
  if (!conversationHistories.has(channelId)) {
    conversationHistories.set(channelId, []);
  }
  const history = conversationHistories.get(channelId)!;
  history.push({ role, content });
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

// ── Overmind Chat Gateway Call ────────────────────────────

/**
 * Route the message through the Overmind chat gateway.
 * This is the same endpoint the Tauri desktop app uses — same brain.
 */
async function callOvermindChat(message: string, channelId: string): Promise<string> {
  const history = getHistory(channelId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000); // 10 min

  try {
    const response = await fetch(`http://127.0.0.1:${API_PORT}/api/overmind/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        model: 'coder',
        history,
        conversation_id: `slack-${channelId}`,
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      return `Overmind error: ${response.status} ${response.statusText}`;
    }

    // Parse SSE stream to extract the final message
    const text = await response.text();
    const lines = text.split('\n');
    let finalMessage = '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'message' && data.content) {
          finalMessage = data.content;
        }
      } catch {
        // Skip malformed SSE lines
      }
    }

    return finalMessage || 'Overmind completed but returned no response.';
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return 'Overmind timed out after 10 minutes.';
    }
    return `Overmind error: ${err.message}`;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Slack Message Chunking ──────────────────────────────

const SLACK_MAX_LENGTH = 3900;

function chunkMessage(text: string): string[] {
  if (text.length <= SLACK_MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= SLACK_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Try to break at a newline, then a space, then hard-cut
    let breakPoint = remaining.lastIndexOf('\n', SLACK_MAX_LENGTH);
    if (breakPoint < SLACK_MAX_LENGTH * 0.5) {
      breakPoint = remaining.lastIndexOf(' ', SLACK_MAX_LENGTH);
    }
    if (breakPoint < SLACK_MAX_LENGTH * 0.3) {
      breakPoint = SLACK_MAX_LENGTH;
    }

    chunks.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint).trimStart();
  }

  return chunks;
}

// ── Strip Bot Mention ───────────────────────────────────

function stripMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>\s*/g, '').trim();
}

// ── Init & Start ────────────────────────────────────────

export async function initSlackListener(): Promise<void> {
  // Try env vars first, then vault
  let botToken = process.env.SLACK_BOT_TOKEN || null;
  let appToken = process.env.SLACK_APP_TOKEN || null;

  if (!botToken) botToken = await getVaultKey('slack_bot');
  if (!appToken) appToken = await getVaultKey('slack_app');

  if (!botToken) {
    logActivity('slack', 'info', 'Slack listener: no bot token configured — skipping');
    return;
  }

  if (!appToken) {
    logActivity('slack', 'info', 'Slack listener: no app token — Socket Mode requires xapp- token, skipping');
    return;
  }

  if (!botToken.startsWith('xoxb-')) {
    logActivity('slack', 'warning', 'Slack listener: bot token does not start with xoxb- — skipping');
    return;
  }

  if (!appToken.startsWith('xapp-')) {
    logActivity('slack', 'warning', 'Slack listener: app token does not start with xapp- — skipping');
    return;
  }

  try {
    slackApp = new App({
      token: botToken,
      appToken,
      socketMode: true,
      logLevel: LogLevel.WARN,
    });

    // Verify token and get bot's own user ID (to ignore own messages)
    const authResult = await slackApp.client.auth.test({ token: botToken });
    botUserId = authResult.user_id as string;

    // ── Handle direct messages ──────────────────────────
    slackApp.message(async ({ message, say }) => {
      if (message.subtype) return; // Ignore edits, joins, etc.
      const msg = message as any;
      if (msg.bot_id || msg.user === botUserId) return; // Ignore own messages

      const text = msg.text || '';
      if (!text.trim()) return;

      const channelId = msg.channel;
      const userId = msg.user;

      logActivity('slack', 'info', `DM from ${userId}: "${text.slice(0, 80)}..."`);
      addToHistory(channelId, 'user', text);

      try {
        const response = await callOvermindChat(text, channelId);
        addToHistory(channelId, 'assistant', response);

        const chunks = chunkMessage(response);
        for (const chunk of chunks) {
          await say({ text: chunk, thread_ts: msg.thread_ts });
        }
      } catch (err: any) {
        logActivity('slack', 'error', `Slack DM response failed: ${err.message}`);
        await say({ text: `Sorry, something went wrong: ${err.message}` });
      }
    });

    // ── Handle @mentions in channels ────────────────────
    slackApp.event('app_mention', async ({ event, say }) => {
      const text = stripMention(event.text || '');
      if (!text.trim()) return;

      const channelId = event.channel;
      const userId = event.user;

      logActivity('slack', 'info', `@mention from ${userId} in ${channelId}: "${text.slice(0, 80)}..."`);
      addToHistory(channelId, 'user', text);

      try {
        const response = await callOvermindChat(text, channelId);
        addToHistory(channelId, 'assistant', response);

        const chunks = chunkMessage(response);
        for (const chunk of chunks) {
          await say({ text: chunk, thread_ts: event.ts });
        }
      } catch (err: any) {
        logActivity('slack', 'error', `Slack mention response failed: ${err.message}`);
        await say({ text: `Sorry, something went wrong: ${err.message}` });
      }
    });

    await slackApp.start();
    logActivity('slack', 'success', `Slack listener connected (Socket Mode) — bot: ${botUserId}`);
    console.log(`✓ Slack listener connected (bot: ${botUserId})`);
  } catch (err: any) {
    logActivity('slack', 'error', `Slack listener failed to start: ${err.message}`);
    console.warn(`⚠ Slack listener failed: ${err.message}`);
    slackApp = null;
  }
}

// ── Status ──────────────────────────────────────────────

export function getSlackListenerStatus(): {
  connected: boolean;
  botUserId: string | null;
  mode: 'socket_mode';
} {
  return {
    connected: slackApp !== null,
    botUserId,
    mode: 'socket_mode',
  };
}

// ── Reconnect (called when tokens are updated via UI) ───

export async function reconnectSlackListener(): Promise<void> {
  await stopSlackListener();
  await initSlackListener();
}

// ── Stop ────────────────────────────────────────────────

export async function stopSlackListener(): Promise<void> {
  if (slackApp) {
    try {
      await slackApp.stop();
      logActivity('slack', 'info', 'Slack listener disconnected');
    } catch {
      // Best effort
    }
    slackApp = null;
    botUserId = null;
  }
}
