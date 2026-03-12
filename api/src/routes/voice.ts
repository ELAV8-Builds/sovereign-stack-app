/**
 * Voice Routes — STT + TTS REST API
 *
 * POST /api/voice/transcribe — Upload audio, get transcription
 * POST /api/voice/speak      — Send text, get audio (mp3)
 * GET  /api/voice/voices      — List available TTS voices
 * GET  /api/voice/status      — Check voice service availability
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import {
  transcribeAudio,
  textToSpeech,
  listVoices,
  checkDeepgramHealth,
  checkElevenlabsHealth,
} from '../services/voice';

const LITELLM_URL = process.env.LITELLM_URL || 'http://localhost:4000';
const LITELLM_KEY = process.env.LITELLM_MASTER_KEY || 'sk-litellm-master';

async function summarizeForSpeech(text: string): Promise<string> {
  const res = await fetch(`${LITELLM_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LITELLM_KEY}`,
    },
    body: JSON.stringify({
      model: 'trivial',
      messages: [
        {
          role: 'system',
          content: 'You are a concise voice assistant. Summarize the following AI response into 2-3 natural spoken sentences. Be conversational and direct. Do not use markdown, bullet points, code blocks, or formatting — just plain spoken English. Focus on the key takeaway.',
        },
        { role: 'user', content: text },
      ],
      max_tokens: 300,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Summarize failed (${res.status})`);
  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content?.trim() || text.slice(0, 300);
}

export const voiceRouter = Router();

// Multer for audio upload — 10MB limit, memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ── POST /api/voice/transcribe — Speech-to-Text ──────────────────

voiceRouter.post('/transcribe', upload.single('audio'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'audio file is required' });
  }

  try {
    const result = await transcribeAudio(req.file.buffer, {
      language: (req.body?.language as string) || 'en',
      model: (req.body?.model as string) || 'nova-3',
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Transcription failed: ${(err as Error).message}` });
  }
});

// ── POST /api/voice/speak — Text-to-Speech ───────────────────────

voiceRouter.post('/speak', async (req: Request, res: Response) => {
  const { text, voice_id, model_id, stability, similarity_boost, speed, summarize = true } = req.body || {};

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }

  if (text.length > 5000) {
    return res.status(400).json({ error: 'Text exceeds 5000 character limit' });
  }

  try {
    // Summarize long responses into spoken-friendly sentences
    let spokenText = text;
    if (summarize && text.length > 200) {
      try {
        spokenText = await summarizeForSpeech(text);
      } catch {
        spokenText = text.slice(0, 500);
      }
    }

    const audioBuffer = await textToSpeech(spokenText, {
      voice_id,
      model_id,
      stability,
      similarity_boost,
      speed,
    });

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(audioBuffer.length),
      'Content-Disposition': 'inline; filename="speech.mp3"',
    });

    res.send(audioBuffer);
  } catch (err) {
    res.status(500).json({ error: `Speech generation failed: ${(err as Error).message}` });
  }
});

// ── GET /api/voice/voices — List available voices ────────────────

voiceRouter.get('/voices', async (_req: Request, res: Response) => {
  try {
    const voices = await listVoices();
    res.json({ voices });
  } catch (err) {
    res.status(500).json({ error: `Failed to list voices: ${(err as Error).message}` });
  }
});

// ── GET /api/voice/status — Voice service availability ───────────

voiceRouter.get('/status', async (_req: Request, res: Response) => {
  const [stt, tts] = await Promise.all([
    checkDeepgramHealth(),
    checkElevenlabsHealth(),
  ]);

  res.json({
    stt: { available: stt, provider: 'DeepGram', model: 'nova-3' },
    tts: { available: tts, provider: 'ElevenLabs', model: 'eleven_turbo_v2_5' },
  });
});
