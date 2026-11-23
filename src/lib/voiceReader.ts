import { User } from 'firebase/auth';
import { getOtpHeaders } from './otpSession';

export interface VoiceReaderController {
  speak: (
    id: string,
    text: string,
    user: User,
    callbacks: {
      onLoadingChange?: (loadingId: string | null) => void;
      onSpeakingChange: (speakingId: string | null) => void;
      onError?: (msg: string) => void;
    }
  ) => Promise<void>;
  stop: () => void;
}

export function cleanTextForSpeech(content: string): string {
  return content
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\bNova AI\b/gi, 'نوفا')
    .replace(/[*#`>_~[\](){}|\\]/g, ' ')
    .replace(/\s*&\s*/g, ' و ')
    .replace(/%/g, ' بالمئة ')
    .replace(/\r?\n+/g, '، ')
    .replace(/\s*([،؛.؟!])\s*/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1500);
}

export function pickBestArabicBrowserVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const arVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('ar'));
  if (arVoices.length === 0) return undefined;
  return (
    arVoices.find((v) => /natural|neural|google|online|enhanced/i.test(v.name)) ||
    arVoices.find((v) => !v.localService) ||
    arVoices[0]
  );
}

export function createVoiceReader(): VoiceReaderController {
  let activeAudio: HTMLAudioElement | null = null;
  let activeId: string | null = null;

  const stopAll = (onSpeakingChange?: (speakingId: string | null) => void) => {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    activeId = null;
    onSpeakingChange?.(null);
  };

  return {
    stop: () => stopAll(),
    speak: async (id, text, user, { onLoadingChange, onSpeakingChange, onError }) => {
      if (activeId === id) {
        stopAll(onSpeakingChange);
        return;
      }

      stopAll(onSpeakingChange);

      const speakWithBrowserFallback = (): boolean => {
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
        const voices = window.speechSynthesis.getVoices();
        const arabicVoice = pickBestArabicBrowserVoice(voices);
        const clean = cleanTextForSpeech(text);
        if (!clean || (!arabicVoice && voices.length > 0)) return false;
        const utterance = new SpeechSynthesisUtterance(clean);
        if (arabicVoice) {
          utterance.voice = arabicVoice;
          utterance.lang = arabicVoice.lang;
        } else {
          utterance.lang = 'ar-SA';
        }
        utterance.rate = 0.98;
        utterance.onend = () => {
          activeId = null;
          onSpeakingChange(null);
        };
        utterance.onerror = () => {
          activeId = null;
          onSpeakingChange(null);
        };
        activeId = id;
        onSpeakingChange(id);
        window.speechSynthesis.speak(utterance);
        return true;
      };

      onLoadingChange?.(id);
      try {
        const idToken = await user.getIdToken();
        const res = await fetch('/api/nova/tts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
            ...getOtpHeaders(),
          },
          body: JSON.stringify({ text, voiceName: 'Zephyr' }),
        });
        const rawText = await res.text();
        if (rawText.trimStart().startsWith('<')) {
          throw new Error('تعذر تشغيل القراءة الصوتية من الخادم.');
        }
        const data = JSON.parse(rawText) as { audioBase64?: string; mimeType?: string; error?: string };
        if (!res.ok || !data.audioBase64 || !data.mimeType) {
          throw new Error(data.error || 'تعذر تشغيل القراءة الصوتية.');
        }
        const audio = new Audio(`data:${data.mimeType};base64,${data.audioBase64}`);
        activeAudio = audio;
        activeId = id;
        onSpeakingChange(id);
        audio.onended = () => {
          activeAudio = null;
          activeId = null;
          onSpeakingChange(null);
        };
        audio.onerror = () => {
          activeAudio = null;
          if (!speakWithBrowserFallback()) {
            activeId = null;
            onSpeakingChange(null);
          }
        };
        await audio.play();
      } catch (err) {
        if (!speakWithBrowserFallback()) {
          activeId = null;
          onSpeakingChange(null);
          onError?.(err instanceof Error ? err.message : 'تعذر قراءة النص صوتيًا.');
        }
      } finally {
        onLoadingChange?.(null);
      }
    },
  };
}
