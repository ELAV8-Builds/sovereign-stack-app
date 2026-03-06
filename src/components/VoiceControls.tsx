/**
 * Voice Controls — Mic button (STT) + Speaker button (TTS)
 *
 * Mic: Hold/click to record → transcribe → insert into chat input
 * Speaker: Click on agent message → read aloud via TTS
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { createAudioRecorder, transcribeAudio, speakText, getVoiceStatus } from "@/lib/voice";
import toast from "react-hot-toast";

interface VoiceControlsProps {
  /** Callback when transcription completes — inserts text into chat input */
  onTranscription: (text: string) => void;
  /** Whether the voice feature should be visible */
  className?: string;
}

export function VoiceMicButton({ onTranscription, className = "" }: VoiceControlsProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [sttAvailable, setSttAvailable] = useState<boolean | null>(null);
  const recorderRef = useRef(createAudioRecorder());

  // Check STT availability on mount
  useEffect(() => {
    getVoiceStatus().then((status) => {
      setSttAvailable(status.stt.available);
    });
  }, []);

  const handleToggleRecording = useCallback(async () => {
    if (isRecording) {
      // Stop recording and transcribe
      setIsRecording(false);
      try {
        const audioBlob = await recorderRef.current.stop();

        if (audioBlob.size < 100) {
          toast.error("No audio captured — try speaking louder");
          return;
        }

        const toastId = toast.loading("Transcribing...");

        try {
          const result = await transcribeAudio(audioBlob);
          toast.dismiss(toastId);

          if (result.transcript.trim()) {
            onTranscription(result.transcript.trim());
            toast.success(`Transcribed (${(result.confidence * 100).toFixed(0)}% confidence)`);
          } else {
            toast.error("Could not understand audio — try again");
          }
        } catch (err) {
          toast.dismiss(toastId);
          toast.error(`Transcription failed: ${(err as Error).message}`);
        }
      } catch (err) {
        toast.error(`Recording error: ${(err as Error).message}`);
      }
    } else {
      // Start recording
      try {
        recorderRef.current = createAudioRecorder();
        await recorderRef.current.start();
        setIsRecording(true);
      } catch (err) {
        toast.error(`Microphone access denied: ${(err as Error).message}`);
      }
    }
  }, [isRecording, onTranscription]);

  // Don't render if STT not available
  if (sttAvailable === false) return null;

  return (
    <button
      onClick={handleToggleRecording}
      className={`p-2 rounded-lg transition-all ${
        isRecording
          ? "bg-red-600 text-white animate-pulse shadow-lg shadow-red-900/30"
          : "text-slate-400 hover:text-white hover:bg-slate-700"
      } ${className}`}
      title={isRecording ? "Stop recording" : "Start voice input"}
    >
      {isRecording ? (
        // Stop icon
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
          <rect x="3" y="3" width="10" height="10" rx="1" />
        </svg>
      ) : (
        // Microphone icon
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="5.5" y="1" width="5" height="9" rx="2.5" />
          <path d="M3 7v1a5 5 0 0010 0V7" />
          <line x1="8" y1="13" x2="8" y2="15" />
          <line x1="5.5" y1="15" x2="10.5" y2="15" />
        </svg>
      )}
    </button>
  );
}

// ── Speaker Button for TTS (placed on agent messages) ────

interface SpeakButtonProps {
  text: string;
  className?: string;
}

export function SpeakButton({ text, className = "" }: SpeakButtonProps) {
  const [playing, setPlaying] = useState(false);
  const [ttsAvailable, setTtsAvailable] = useState<boolean | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    getVoiceStatus().then((status) => {
      setTtsAvailable(status.tts.available);
    });
  }, []);

  const handleSpeak = useCallback(async () => {
    if (playing) {
      // Stop playing
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlaying(false);
      return;
    }

    setPlaying(true);
    try {
      // Clean markdown/code blocks from text before speaking
      const cleanText = text
        .replace(/```[\s\S]*?```/g, "(code block)")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/`(.*?)`/g, "$1")
        .replace(/#{1,6}\s/g, "")
        .slice(0, 4000); // Limit length

      const audioUrl = await speakText(cleanText);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        setPlaying(false);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        setPlaying(false);
        toast.error("Audio playback failed");
      };

      await audio.play();
    } catch (err) {
      setPlaying(false);
      toast.error(`Speech failed: ${(err as Error).message}`);
    }
  }, [playing, text]);

  // Don't render if TTS not available
  if (ttsAvailable === false) return null;

  return (
    <button
      onClick={handleSpeak}
      className={`p-1 rounded transition-all ${
        playing
          ? "text-blue-400 animate-pulse"
          : "text-slate-600 hover:text-slate-400 opacity-0 group-hover:opacity-100"
      } ${className}`}
      title={playing ? "Stop speaking" : "Read aloud"}
    >
      {playing ? (
        // Stop icon
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <rect x="3" y="3" width="10" height="10" rx="1" />
        </svg>
      ) : (
        // Speaker icon
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 6h2l4-3v10L4 10H2V6z" fill="currentColor" />
          <path d="M10.5 5.5a3.5 3.5 0 010 5" />
          <path d="M12.5 3.5a6 6 0 010 9" />
        </svg>
      )}
    </button>
  );
}
