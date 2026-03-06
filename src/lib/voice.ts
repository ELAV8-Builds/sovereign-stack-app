/**
 * Voice API Client — STT + TTS
 *
 * Communicates with /api/sovereign/voice/* endpoints.
 * Provides:
 * - Speech-to-Text (microphone recording → transcription)
 * - Text-to-Speech (agent response → audio playback)
 * - Voice status checking
 */

const API_BASE = '/api/sovereign/voice';

// ── Types ────────────────────────────────────────────────

export interface TranscriptionResult {
  transcript: string;
  confidence: number;
  words?: Array<{ word: string; start: number; end: number }>;
}

export interface VoiceStatus {
  stt: { available: boolean; provider: string; model: string };
  tts: { available: boolean; provider: string; model: string };
}

export interface VoiceInfo {
  voice_id: string;
  name: string;
  category: string;
  description: string;
  preview_url: string;
}

// ── Check voice availability ─────────────────────────────

export async function getVoiceStatus(): Promise<VoiceStatus> {
  try {
    const res = await fetch(`${API_BASE}/status`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error('Failed');
    return res.json();
  } catch {
    return {
      stt: { available: false, provider: 'DeepGram', model: 'nova-3' },
      tts: { available: false, provider: 'ElevenLabs', model: 'eleven_turbo_v2_5' },
    };
  }
}

// ── Speech-to-Text ───────────────────────────────────────

/**
 * Send recorded audio for transcription.
 * @param audioBlob - The recorded audio blob (wav/webm)
 */
export async function transcribeAudio(audioBlob: Blob): Promise<TranscriptionResult> {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.wav');

  const res = await fetch(`${API_BASE}/transcribe`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Transcription failed' }));
    throw new Error(err.error || `Transcription failed (${res.status})`);
  }

  return res.json();
}

// ── Text-to-Speech ───────────────────────────────────────

/**
 * Convert text to speech audio.
 * Returns audio URL that can be played in an <audio> element.
 * @param text - Text to speak
 * @param voiceId - Optional ElevenLabs voice ID
 */
export async function speakText(
  text: string,
  voiceId?: string
): Promise<string> {
  const res = await fetch(`${API_BASE}/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice_id: voiceId }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Speech generation failed' }));
    throw new Error(err.error || `Speech generation failed (${res.status})`);
  }

  // Convert response to blob URL for audio playback
  const audioBlob = await res.blob();
  return URL.createObjectURL(audioBlob);
}

// ── List voices ──────────────────────────────────────────

export async function listVoices(): Promise<VoiceInfo[]> {
  try {
    const res = await fetch(`${API_BASE}/voices`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.voices || [];
  } catch {
    return [];
  }
}

// ── Audio Recording Helper ───────────────────────────────

/**
 * Simple audio recording using MediaRecorder API.
 * Returns start/stop functions and the recorded blob.
 */
export function createAudioRecorder(): {
  start: () => Promise<void>;
  stop: () => Promise<Blob>;
  isRecording: () => boolean;
} {
  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let stream: MediaStream | null = null;

  return {
    start: async () => {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });

      chunks = [];
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.start(100); // Capture in 100ms chunks
    },

    stop: () => {
      return new Promise<Blob>((resolve) => {
        if (!mediaRecorder) {
          resolve(new Blob([], { type: 'audio/webm' }));
          return;
        }

        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: mediaRecorder!.mimeType });
          // Stop all tracks to release microphone
          stream?.getTracks().forEach((t) => t.stop());
          stream = null;
          mediaRecorder = null;
          resolve(blob);
        };

        mediaRecorder.stop();
      });
    },

    isRecording: () => mediaRecorder?.state === 'recording',
  };
}
