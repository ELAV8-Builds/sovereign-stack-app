/**
 * Voice Services — DeepGram STT + ElevenLabs TTS
 *
 * Two modes:
 * 1. LISTENING (STT): User speaks → DeepGram transcribes → text input
 * 2. TALK (TTS): Agent response → ElevenLabs speaks → audio output
 *
 * API keys come from the encrypted vault.
 */
import crypto from 'crypto';
import { query } from './database';
import { logActivity } from './activity-broadcaster';

// ── Vault key lookup ─────────────────────────────────────

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

async function getApiKey(keyName: string): Promise<string | null> {
  try {
    const result = await query(
      `SELECT value, encrypted FROM settings WHERE key = $1`,
      [`vault.${keyName}`]
    );
    if (result.rows.length > 0) {
      const row = result.rows[0];
      return row.encrypted ? decryptVaultValue(row.value) : row.value;
    }
  } catch {
    // DB might be down
  }
  const envKey = keyName.toUpperCase().replace(/-/g, '_') + '_API_KEY';
  return process.env[envKey] || null;
}

// ── Configuration ────────────────────────────────────────

const DEEPGRAM_API = 'https://api.deepgram.com/v1';
const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // Sarah — natural conversational voice

// ── DeepGram Speech-to-Text ──────────────────────────────

/**
 * Transcribe audio using DeepGram.
 * Accepts audio as a Buffer (WAV, MP3, OGG, FLAC, etc.)
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  options?: {
    language?: string;
    model?: string;
    punctuate?: boolean;
    smart_format?: boolean;
  }
): Promise<{ transcript: string; confidence: number; words?: Array<{ word: string; start: number; end: number }> }> {
  const apiKey = await getApiKey('deepgram');
  if (!apiKey) {
    throw new Error('DeepGram API key not configured — add it in Settings → Key Vault');
  }

  const params = new URLSearchParams({
    model: options?.model || 'nova-3',
    language: options?.language || 'en',
    punctuate: String(options?.punctuate ?? true),
    smart_format: String(options?.smart_format ?? true),
  });

  const response = await fetch(`${DEEPGRAM_API}/listen?${params}`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'audio/wav',
    },
    body: audioBuffer,
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`DeepGram STT failed (${response.status}): ${text}`);
  }

  const data = await response.json() as any;
  const result = data.results?.channels?.[0]?.alternatives?.[0];

  if (!result) {
    throw new Error('DeepGram returned no transcription results');
  }

  logActivity('voice', 'info', `STT: "${result.transcript.slice(0, 50)}..." (confidence: ${(result.confidence * 100).toFixed(0)}%)`);

  return {
    transcript: result.transcript,
    confidence: result.confidence,
    words: result.words,
  };
}

// ── ElevenLabs Text-to-Speech ────────────────────────────

/**
 * Convert text to speech using ElevenLabs.
 * Returns audio as a Buffer (mp3).
 */
export async function textToSpeech(
  text: string,
  options?: {
    voice_id?: string;
    model_id?: string;
    stability?: number;
    similarity_boost?: number;
    speed?: number;
  }
): Promise<Buffer> {
  const apiKey = await getApiKey('elevenlabs');
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured — add it in Settings → Key Vault');
  }

  const voiceId = options?.voice_id || DEFAULT_VOICE_ID;

  const response = await fetch(`${ELEVENLABS_API}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: options?.model_id || 'eleven_turbo_v2_5',
      voice_settings: {
        stability: options?.stability ?? 0.5,
        similarity_boost: options?.similarity_boost ?? 0.75,
        speed: options?.speed ?? 1.0,
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${text}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = Buffer.from(arrayBuffer);

  logActivity('voice', 'info', `TTS: Generated ${(audioBuffer.length / 1024).toFixed(0)}KB audio for "${text.slice(0, 40)}..."`);

  return audioBuffer;
}

// ── List ElevenLabs voices ───────────────────────────────

export interface VoiceInfo {
  voice_id: string;
  name: string;
  category: string;
  description: string;
  preview_url: string;
}

export async function listVoices(): Promise<VoiceInfo[]> {
  const apiKey = await getApiKey('elevenlabs');
  if (!apiKey) {
    return [];
  }

  try {
    const response = await fetch(`${ELEVENLABS_API}/voices`, {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return [];

    const data = await response.json() as any;
    return (data.voices || []).map((v: any) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category || 'premade',
      description: v.labels?.description || '',
      preview_url: v.preview_url || '',
    }));
  } catch {
    return [];
  }
}

// ── Health checks ────────────────────────────────────────

export async function checkDeepgramHealth(): Promise<boolean> {
  try {
    const apiKey = await getApiKey('deepgram');
    return !!apiKey;
  } catch {
    return false;
  }
}

export async function checkElevenlabsHealth(): Promise<boolean> {
  try {
    const apiKey = await getApiKey('elevenlabs');
    return !!apiKey;
  } catch {
    return false;
  }
}
