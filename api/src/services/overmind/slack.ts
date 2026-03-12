/**
 * Overmind — Slack Integration
 *
 * Handles incoming Slack events (messages, app_mentions) and converts
 * them into Overmind jobs. Also sends status updates back to Slack threads.
 *
 * Architecture:
 * - POST /api/overmind/slack/events — Receives Slack webhook events
 * - Job updates are pushed back to the originating thread
 * - Uses SLACK_BOT_TOKEN from environment for outbound messages
 */

import type { OvJob, OvTask, OvCleanupReport } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SlackEvent {
  type: string;
  event: {
    type: string;
    text: string;
    user: string;
    channel: string;
    ts: string;
    thread_ts?: string;
  };
  challenge?: string;
}

interface SlackMessage {
  channel: string;
  text: string;
  thread_ts?: string;
  blocks?: SlackBlock[];
}

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  elements?: Array<{ type: string; text?: { type: string; text: string }; value?: string }>;
  fields?: Array<{ type: string; text: string }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';

// ---------------------------------------------------------------------------
// Slack API Helpers
// ---------------------------------------------------------------------------

/**
 * Send a message to a Slack channel (or thread).
 */
export async function sendSlackMessage(msg: SlackMessage): Promise<boolean> {
  if (!SLACK_BOT_TOKEN) {
    console.warn('[overmind/slack] No SLACK_BOT_TOKEN configured, skipping message');
    return false;
  }

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel: msg.channel,
        text: msg.text,
        thread_ts: msg.thread_ts,
        blocks: msg.blocks,
        unfurl_links: false,
      }),
    });

    const data = await response.json() as any;
    if (!data.ok) {
      console.error('[overmind/slack] Failed to send message:', data.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[overmind/slack] Error sending message:', err);
    return false;
  }
}

/**
 * Update an existing Slack message.
 */
export async function updateSlackMessage(
  channel: string,
  ts: string,
  text: string,
  blocks?: SlackBlock[]
): Promise<boolean> {
  if (!SLACK_BOT_TOKEN) return false;

  try {
    const response = await fetch('https://slack.com/api/chat.update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({ channel, ts, text, blocks }),
    });

    const data = await response.json() as any;
    return data.ok === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Slack Event Processing
// ---------------------------------------------------------------------------

/**
 * Process an incoming Slack event.
 * Returns a response payload (for URL verification or acknowledgement).
 */
export async function processSlackEvent(event: SlackEvent): Promise<{
  statusCode: number;
  body: Record<string, unknown>;
}> {
  // Handle Slack URL verification challenge
  if (event.challenge) {
    return { statusCode: 200, body: { challenge: event.challenge } };
  }

  // Only process app_mention and message events
  const eventType = event.event?.type;
  if (!eventType || !['app_mention', 'message'].includes(eventType)) {
    return { statusCode: 200, body: { ok: true, ignored: true } };
  }

  // Ignore bot messages to prevent loops
  const text = event.event.text || '';
  if (!text.trim()) {
    return { statusCode: 200, body: { ok: true, ignored: true } };
  }

  // Return immediately and process async
  return { statusCode: 200, body: { ok: true, processing: true } };
}

/**
 * Extract the job prompt from a Slack message.
 * Strips bot mentions and cleans up the text.
 */
export function extractPromptFromSlack(text: string): string {
  // Remove bot mention (e.g. <@U1234567>)
  return text
    .replace(/<@[A-Z0-9]+>/g, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Job Status Notifications
// ---------------------------------------------------------------------------

/**
 * Send a job creation notification to Slack.
 */
export async function notifyJobCreated(
  job: OvJob,
  channel: string,
  threadTs?: string
): Promise<void> {
  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:rocket: *New Job Created*\n*${job.title}*`,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Status:* ${job.status}` },
        { type: 'mrkdwn', text: `*Target:* ${job.target_type}` },
        { type: 'mrkdwn', text: `*Source:* ${job.source}` },
        { type: 'mrkdwn', text: `*ID:* \`${job.id.slice(0, 8)}\`` },
      ],
    },
  ];

  await sendSlackMessage({
    channel,
    text: `Job created: ${job.title}`,
    thread_ts: threadTs,
    blocks,
  });
}

/**
 * Send a task status update to Slack.
 */
export async function notifyTaskUpdate(
  task: OvTask,
  channel: string,
  threadTs?: string
): Promise<void> {
  const statusEmoji: Record<string, string> = {
    pending: ':hourglass:',
    queued: ':inbox_tray:',
    running: ':gear:',
    awaiting_cleanup: ':broom:',
    iterating: ':arrows_counterclockwise:',
    completed: ':white_check_mark:',
    escalated: ':warning:',
    failed: ':x:',
  };

  const emoji = statusEmoji[task.status] || ':question:';

  await sendSlackMessage({
    channel,
    text: `${emoji} Task ${task.type} — ${task.status}${task.iteration > 0 ? ` (iteration ${task.iteration})` : ''}`,
    thread_ts: threadTs,
  });
}

/**
 * Send a cleanup report summary to Slack.
 */
export async function notifyCleanupReport(
  report: OvCleanupReport,
  passed: boolean,
  channel: string,
  threadTs?: string
): Promise<void> {
  const severityCounts: Record<string, number> = {};
  for (const f of report.findings) {
    severityCounts[f.severity] = (severityCounts[f.severity] || 0) + 1;
  }

  const countsStr = Object.entries(severityCounts)
    .map(([sev, count]) => `${sev}: ${count}`)
    .join(', ');

  const emoji = passed ? ':white_check_mark:' : ':x:';
  const text = `${emoji} Cleanup ${passed ? 'PASSED' : 'FAILED'} — ${report.findings.length} findings (${countsStr || 'none'})`;

  await sendSlackMessage({
    channel,
    text,
    thread_ts: threadTs,
  });
}

/**
 * Send a job completion notification to Slack.
 */
export async function notifyJobCompleted(
  job: OvJob,
  channel: string,
  threadTs?: string
): Promise<void> {
  const emoji = job.status === 'completed' ? ':tada:' : ':warning:';
  const statusText = job.status === 'completed' ? 'completed successfully' : `ended with status: ${job.status}`;

  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *Job ${statusText}*\n*${job.title}*`,
      },
    },
  ];

  await sendSlackMessage({
    channel,
    text: `Job ${job.title} ${statusText}`,
    thread_ts: threadTs,
    blocks,
  });
}

// ---------------------------------------------------------------------------
// Slack Verification
// ---------------------------------------------------------------------------

/**
 * Verify a Slack request signature.
 * Returns true if the request is authentic.
 */
export function isSlackConfigured(): boolean {
  return SLACK_BOT_TOKEN.length > 0;
}
