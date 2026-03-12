import { Router, Request, Response } from 'express';
import { query } from '../services/database';
import { logActivity } from '../services/activity-broadcaster';

export const activityRouter = Router();

// Get recent activity
activityRouter.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const agent = req.query.agent as string;
    const level = req.query.level as string;

    let sql = 'SELECT id, agent, level, message, created_at as timestamp FROM agent_activity';
    const params: any[] = [];
    const conditions: string[] = [];

    if (agent) {
      conditions.push(`agent = $${params.length + 1}`);
      params.push(agent);
    }
    if (level) {
      conditions.push(`level = $${params.length + 1}`);
      params.push(level);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await query(sql, params);
    res.json({ entries: result.rows.reverse() });
  } catch {
    res.json({ entries: [] });
  }
});

// Post a manual activity entry (for tools/integrations)
activityRouter.post('/', async (req: Request, res: Response) => {
  const { agent, level, message } = req.body;

  if (!agent || !message) {
    return res.status(400).json({ error: 'agent and message are required' });
  }

  logActivity(agent, level || 'info', message);
  res.json({ logged: true });
});

// Clear old activity entries
activityRouter.delete('/cleanup', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      "DELETE FROM agent_activity WHERE created_at < NOW() - INTERVAL '7 days'"
    );
    res.json({ deleted: result.rowCount });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});
