import { Router, Request, Response } from 'express';
import { query } from '../services/database';
import { logActivity } from '../services/activity-broadcaster';

export const whatsappRouter = Router();

// Get WhatsApp connection status
whatsappRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT id, phone, status, connected_at, updated_at FROM whatsapp_sessions ORDER BY updated_at DESC LIMIT 1'
    );

    if (result.rows.length === 0) {
      return res.json({ status: 'disconnected', phone: null });
    }

    const session = result.rows[0];
    res.json({
      status: session.status,
      phone: session.phone,
      connectedAt: session.connected_at,
    });
  } catch {
    res.json({ status: 'disconnected', phone: null });
  }
});

// Generate QR code for WhatsApp pairing
whatsappRouter.post('/connect', async (_req: Request, res: Response) => {
  logActivity('whatsapp', 'info', 'WhatsApp QR code requested');

  // In the real implementation, this would interface with the WhatsApp Web API
  // through NanoClaw. For now, we provide the connection flow structure.
  try {
    // Create or update session entry
    await query(
      `INSERT INTO whatsapp_sessions (id, status, updated_at)
       VALUES (uuid_generate_v4(), 'waiting_for_scan', NOW())
       ON CONFLICT DO NOTHING`
    );

    // The NanoClaw service handles actual WhatsApp connection.
    // Forward the request to NanoClaw.
    const nanoclawUrl = process.env.NANOCLAW_URL || 'http://localhost:18789';
    try {
      const response = await fetch(`${nanoclawUrl}/whatsapp/qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json() as any;
        logActivity('whatsapp', 'success', 'QR code generated');
        return res.json({ qr: data.qr, status: 'waiting_for_scan' });
      }
    } catch {
      // NanoClaw not available
    }

    // Fallback: return placeholder for UI development
    res.json({
      qr: null,
      status: 'waiting_for_scan',
      note: 'NanoClaw WhatsApp bridge not yet connected. QR will appear when service is ready.',
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Disconnect WhatsApp
whatsappRouter.post('/disconnect', async (_req: Request, res: Response) => {
  logActivity('whatsapp', 'info', 'WhatsApp disconnect requested');

  try {
    await query("UPDATE whatsapp_sessions SET status = 'disconnected', updated_at = NOW()");

    const nanoclawUrl = process.env.NANOCLAW_URL || 'http://localhost:18789';
    try {
      await fetch(`${nanoclawUrl}/whatsapp/disconnect`, { method: 'POST', signal: AbortSignal.timeout(5000) });
    } catch { /* NanoClaw might be down */ }

    res.json({ status: 'disconnected' });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Get Slack integration status
whatsappRouter.get('/slack/status', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT id, team_name, status, connected_at FROM slack_integrations ORDER BY updated_at DESC LIMIT 1'
    );

    if (result.rows.length === 0) {
      return res.json({ status: 'disconnected', team: null });
    }

    const integration = result.rows[0];
    res.json({
      status: integration.status,
      team: integration.team_name,
      connectedAt: integration.connected_at,
    });
  } catch {
    res.json({ status: 'disconnected', team: null });
  }
});
