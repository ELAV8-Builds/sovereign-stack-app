import { Router, Request, Response } from 'express';
import { query, withClient } from '../services/database';
import { logActivity } from '../services/activity-broadcaster';

export const conversationsRouter = Router();

// ─── Auto-migrate on first request ──────────────────────────────────────

let migrated = false;

async function ensureTables(): Promise<void> {
  if (migrated) return;

  await withClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        title TEXT NOT NULL DEFAULT 'New Conversation',
        agent_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        pinned BOOLEAN NOT NULL DEFAULT false,
        archived BOOLEAN NOT NULL DEFAULT false
      );

      -- Add agent_id column if it doesn't exist (migration for existing installs)
      DO $$ BEGIN
        ALTER TABLE conversations ADD COLUMN IF NOT EXISTS agent_id TEXT;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;

      CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id);

      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'agent', 'system')),
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sending', 'sent', 'error')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_conv_messages_conversation_id ON conversation_messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_conv_messages_created_at ON conversation_messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);

      -- Full-text search index on message content
      CREATE INDEX IF NOT EXISTS idx_conv_messages_content_search
        ON conversation_messages USING gin(to_tsvector('english', content));
    `);
  });

  migrated = true;
}

// ─── Helper: Auto-title from first user message ────────────────────────

function generateTitle(content: string): string {
  // Take first 60 chars, trim to last word boundary
  const trimmed = content.slice(0, 60).trim();
  if (trimmed.length < content.length) {
    const lastSpace = trimmed.lastIndexOf(' ');
    if (lastSpace > 20) {
      return trimmed.slice(0, lastSpace) + '…';
    }
    return trimmed + '…';
  }
  return trimmed;
}

// ─── GET /api/conversations — List all conversations ────────────────────

conversationsRouter.get('/', async (req: Request, res: Response) => {
  await ensureTables();

  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;
  const includeArchived = req.query.archived === 'true';

  try {
    const archiveFilter = includeArchived ? '' : 'WHERE c.archived = false';

    const agentFilter = req.query.agent_id
      ? ` AND c.agent_id = '${String(req.query.agent_id).replace(/'/g, "''")}'`
      : '';
    const mainOnly = req.query.main_only === 'true' ? ' AND c.agent_id IS NULL' : '';

    const result = await query(
      `SELECT
        c.id,
        c.title,
        c.agent_id,
        c.created_at,
        c.updated_at,
        c.pinned,
        c.archived,
        COUNT(m.id)::int AS message_count,
        (SELECT content FROM conversation_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message
      FROM conversations c
      LEFT JOIN conversation_messages m ON m.conversation_id = c.id
      ${archiveFilter}${agentFilter}${mainOnly}
      GROUP BY c.id
      ORDER BY c.pinned DESC, c.updated_at DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({ conversations: result.rows });
  } catch (err) {
    logActivity('api', 'error', `Failed to list conversations: ${err}`);
    res.status(500).json({ error: `Failed to list conversations: ${err}` });
  }
});

// ─── POST /api/conversations — Create a new conversation ────────────────

conversationsRouter.post('/', async (req: Request, res: Response) => {
  await ensureTables();

  const { title, agent_id } = req.body || {};

  try {
    const result = await query(
      `INSERT INTO conversations (title, agent_id) VALUES ($1, $2) RETURNING *`,
      [title || 'New Conversation', agent_id || null]
    );

    logActivity('api', 'info', `New conversation: ${result.rows[0].id}`);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logActivity('api', 'error', `Failed to create conversation: ${err}`);
    res.status(500).json({ error: `Failed to create conversation: ${err}` });
  }
});

// ─── GET /api/conversations/:id — Get conversation with messages ────────

conversationsRouter.get('/:id', async (req: Request, res: Response) => {
  await ensureTables();

  const id = String(req.params.id);

  try {
    const convResult = await query(
      `SELECT * FROM conversations WHERE id = $1`,
      [id]
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const msgsResult = await query(
      `SELECT * FROM conversation_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [id]
    );

    res.json({
      ...convResult.rows[0],
      messages: msgsResult.rows,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch conversation: ${err}` });
  }
});

// ─── PATCH /api/conversations/:id — Update conversation (title, pin, archive)

conversationsRouter.patch('/:id', async (req: Request, res: Response) => {
  await ensureTables();

  const id = String(req.params.id);
  const { title, pinned, archived } = req.body || {};

  const updates: string[] = [];
  const values: any[] = [];
  let paramIdx = 1;

  if (title !== undefined) {
    updates.push(`title = $${paramIdx++}`);
    values.push(title);
  }
  if (pinned !== undefined) {
    updates.push(`pinned = $${paramIdx++}`);
    values.push(pinned);
  }
  if (archived !== undefined) {
    updates.push(`archived = $${paramIdx++}`);
    values.push(archived);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  updates.push(`updated_at = NOW()`);
  values.push(id);

  try {
    const result = await query(
      `UPDATE conversations SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: `Failed to update conversation: ${err}` });
  }
});

// ─── DELETE /api/conversations/:id — Delete conversation + messages ──────

conversationsRouter.delete('/:id', async (req: Request, res: Response) => {
  await ensureTables();

  const id = String(req.params.id);

  try {
    const result = await query(
      `DELETE FROM conversations WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    logActivity('api', 'info', `Deleted conversation: ${id}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to delete conversation: ${err}` });
  }
});

// ─── POST /api/conversations/:id/messages — Add a message ───────────────

conversationsRouter.post('/:id/messages', async (req: Request, res: Response) => {
  await ensureTables();

  const conversationId = String(req.params.id);
  const { role, content, status } = req.body || {};

  if (!role || !content) {
    return res.status(400).json({ error: 'role and content are required' });
  }

  if (!['user', 'agent', 'system'].includes(role)) {
    return res.status(400).json({ error: 'role must be user, agent, or system' });
  }

  try {
    // Insert message
    const msgResult = await query(
      `INSERT INTO conversation_messages (conversation_id, role, content, status)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [conversationId, role, content, status || 'sent']
    );

    // Update conversation timestamp + auto-title if it's the first user message
    const convResult = await query(
      `SELECT title, (SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = $1 AND role = 'user')::int AS user_count
       FROM conversations WHERE id = $1`,
      [conversationId]
    );

    if (convResult.rows.length > 0) {
      const conv = convResult.rows[0];
      // Auto-title on first user message if title is still default
      if (role === 'user' && conv.user_count <= 1 && conv.title === 'New Conversation') {
        await query(
          `UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2`,
          [generateTitle(content), conversationId]
        );
      } else {
        await query(
          `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
          [conversationId]
        );
      }
    }

    res.status(201).json(msgResult.rows[0]);
  } catch (err) {
    res.status(500).json({ error: `Failed to add message: ${err}` });
  }
});

// ─── GET /api/conversations/search — Full-text search across messages ───

conversationsRouter.get('/search/query', async (req: Request, res: Response) => {
  await ensureTables();

  const q = (req.query.q as string || '').trim();
  if (!q) {
    return res.status(400).json({ error: 'q parameter is required' });
  }

  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

  try {
    // Use PostgreSQL full-text search with headline for context snippets
    const result = await query(
      `SELECT
        m.id AS message_id,
        m.conversation_id,
        m.role,
        m.content,
        m.created_at AS message_date,
        c.title AS conversation_title,
        c.updated_at AS conversation_updated,
        ts_headline('english', m.content, plainto_tsquery('english', $1),
          'StartSel=<<, StopSel=>>, MaxWords=40, MinWords=20') AS snippet,
        ts_rank(to_tsvector('english', m.content), plainto_tsquery('english', $1)) AS rank
      FROM conversation_messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE to_tsvector('english', m.content) @@ plainto_tsquery('english', $1)
      ORDER BY rank DESC, m.created_at DESC
      LIMIT $2`,
      [q, limit]
    );

    res.json({
      query: q,
      results: result.rows,
      count: result.rows.length,
    });
  } catch (err) {
    // Fallback to ILIKE search if full-text search fails
    try {
      const fallback = await query(
        `SELECT
          m.id AS message_id,
          m.conversation_id,
          m.role,
          m.content,
          m.created_at AS message_date,
          c.title AS conversation_title,
          c.updated_at AS conversation_updated
        FROM conversation_messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.content ILIKE $1
        ORDER BY m.created_at DESC
        LIMIT $2`,
        [`%${q}%`, limit]
      );

      res.json({
        query: q,
        results: fallback.rows,
        count: fallback.rows.length,
        note: 'Using fallback search (ILIKE)',
      });
    } catch (fallbackErr) {
      res.status(500).json({ error: `Search failed: ${fallbackErr}` });
    }
  }
});
