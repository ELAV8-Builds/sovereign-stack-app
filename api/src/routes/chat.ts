import { Router, Request, Response } from 'express';
import { chatCompletion, streamChatCompletion, ChatMessage } from '../services/litellm';
import { query } from '../services/database';
import { logActivity } from '../services/activity-broadcaster';

export const chatRouter = Router();

// Get chat history
chatRouter.get('/history', async (req: Request, res: Response) => {
  try {
    const channel = (req.query.channel as string) || 'chat';
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await query(
      'SELECT id, role, content, metadata, created_at FROM messages WHERE channel = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [channel, limit, offset]
    );

    res.json({ messages: result.rows.reverse(), total: result.rowCount });
  } catch (e) {
    res.json({ messages: [], total: 0 });
  }
});

// Send a message and get AI response
chatRouter.post('/send', async (req: Request, res: Response) => {
  try {
    const { message, channel = 'chat', model = 'coder', history = [] } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    logActivity('nanoclaw', 'info', `User message received (${channel})`);

    // Save user message
    try {
      await query(
        'INSERT INTO messages (channel, role, content) VALUES ($1, $2, $3)',
        [channel, 'user', message]
      );
    } catch { /* DB might be down */ }

    // Build conversation context
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are a helpful AI assistant in the Sovereign Stack. You can help with coding, design, writing, research, and general tasks. Be concise and practical. If the user asks about tools or capabilities, mention the built-in tools available (image generation, component library generator, copy generator, color palette analyzer, user flow simulator, responsive preview).`,
      },
      ...history.slice(-20).map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: message },
    ];

    logActivity('litellm', 'thinking', `Processing with ${model} tier...`);

    const response = await chatCompletion({ model, messages });

    // Save assistant response
    try {
      await query(
        'INSERT INTO messages (channel, role, content) VALUES ($1, $2, $3)',
        [channel, 'assistant', response]
      );
    } catch { /* DB might be down */ }

    logActivity('nanoclaw', 'success', `Response sent (${response.length} chars)`);

    res.json({ response, model });
  } catch (e) {
    logActivity('nanoclaw', 'error', `Chat failed: ${(e as Error).message}`);
    res.status(500).json({ error: (e as Error).message });
  }
});

// Stream a message response (SSE)
chatRouter.post('/stream', async (req: Request, res: Response) => {
  try {
    const { message, channel = 'chat', model = 'coder', history = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are a helpful AI assistant in the Sovereign Stack. Be concise and practical.`,
      },
      ...history.slice(-20).map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: message },
    ];

    const fullResponse = await streamChatCompletion(
      { model, messages },
      (chunk) => {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }
    );

    // Save both messages
    try {
      await query('INSERT INTO messages (channel, role, content) VALUES ($1, $2, $3)', [channel, 'user', message]);
      await query('INSERT INTO messages (channel, role, content) VALUES ($1, $2, $3)', [channel, 'assistant', fullResponse]);
    } catch { /* DB might be down */ }

    res.write(`data: ${JSON.stringify({ done: true, fullResponse })}\n\n`);
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: (e as Error).message })}\n\n`);
    res.end();
  }
});
