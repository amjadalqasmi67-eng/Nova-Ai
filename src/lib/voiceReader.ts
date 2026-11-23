import { User } from 'firebase/auth';
import { getOtpHeaders } from './otpSession';
import { primeOutputAudioContext, consumePrimedOutputAudioContext } from './audioUnlock';
import {
  cleanTextForSpeech as sharedCleanTextForSpeech,
  decodeAudioBytesToPcmFloat32,
  splitArabicSpeechSentences,
} from '../../speechUtils';

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
  return sharedCleanTextForSpeech(content, 1800);
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

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function createVoiceReader(): VoiceReaderController {
  let activeAudio: HTMLAudioElement | null = null;
  let activeId: string | null = null;
  let activeAbortController: AbortController | null = null;
  let audioCtx: AudioContext | null = null;
  const activeSources = new Set<AudioBufferSourceNode>();
  let playSessionToken = 0;
  let activeOnSpeakingChange: ((speakingId: string | null) => void) | null = null;

  const stopAll = (onSpeakingChange?: (speakingId: string | null) => void) => {
    playSessionToken += 1;
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    activeSources.forEach((src) => {
      try {
        src.stop();
      } catch {
        // ignore
      }
    });
    activeSources.clear();
    if (activeAudio) {
      activeAudio.pause();
      activeAudio = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    activeId = null;
    const cb = onSpeakingChange || activeOnSpeakingChange;
    activeOnSpeakingChange = null;
    cb?.(null);
  };

  return {
    stop: () => stopAll(),
    speak: async (id, text, user, { onLoadingChange, onSpeakingChange, onError }) => {
      if (activeId === id) {
        stopAll(onSpeakingChange);
        return;
      }

      stopAll(onSpeakingChange);
      primeOutputAudioContext();

      const sessionToken = ++playSessionToken;
      activeOnSpeakingChange = onSpeakingChange;

      const speakWithBrowserFallback = (): boolean => {
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
        const voices = window.speechSynthesis.getVoices();
        const arabicVoice = pickBestArabicBrowserVoice(voices);
        const sentences = splitArabicSpeechSentences(text, 110, 28);
        if (sentences.length === 0 || (!arabicVoice && voices.length > 0)) return false;

        activeId = id;
        onSpeakingChange(id);

        let idx = 0;
        const speakNext = () => {
          if (playSessionToken !== sessionToken || idx >= sentences.length) {
            if (playSessionToken === sessionToken) {
              activeId = null;
              onSpeakingChange(null);
            }
            return;
          }
          const utterance = new SpeechSynthesisUtterance(sentences[idx++]);
          if (arabicVoice) {
            utterance.voice = arabicVoice;
            utterance.lang = arabicVoice.lang;
          } else {
            utterance.lang = 'ar-SA';
          }
          utterance.rate = 0.98;
          utterance.onend = speakNext;
          utterance.onerror = () => {
            if (playSessionToken === sessionToken) {
              activeId = null;
              onSpeakingChange(null);
            }
          };
          window.speechSynthesis.speak(utterance);
        };

        speakNext();
        return true;
      };

      const abortController = new AbortController();
      activeAbortController = abortController;
      onLoadingChange?.(id);

      try {
        if (!audioCtx || audioCtx.state === 'closed') {
          audioCtx = consumePrimedOutputAudioContext();
        }
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume().catch(() => undefined);
        }

        const idToken = await user.getIdToken();
        if (playSessionToken !== sessionToken) return;

        const res = await fetch('/api/nova/tts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
            ...getOtpHeaders(),
          },
          body: JSON.stringify({ text, voiceName: 'Zephyr', stream: true }),
          signal: abortController.signal,
        });

        const contentType = res.headers.get('content-type') || '';

        if (!res.ok) {
          const errRaw = await res.text();
          if (errRaw.trimStart().startsWith('<')) {
            throw new Error('تعذر تشغيل القراءة الصوتية من الخادم.');
          }
          const parsed = JSON.parse(errRaw) as { error?: string };
          throw new Error(parsed.error || 'تعذر تشغيل القراءة الصوتية.');
        }

        // Legacy non-streamed JSON fallback
        if (!contentType.includes('application/x-ndjson') || !res.body) {
          const rawText = await res.text();
          if (rawText.trimStart().startsWith('<')) {
            throw new Error('تعذر تشغيل القراءة الصوتية من الخادم.');
          }
          const data = JSON.parse(rawText) as { audioBase64?: string; mimeType?: string; error?: string };
          if (!data.audioBase64 || !data.mimeType) {
            throw new Error(data.error || 'تعذر تشغيل القراءة الصوتية.');
          }
          const audio = new Audio(`data:${data.mimeType};base64,${data.audioBase64}`);
          activeAudio = audio;
          activeId = id;
          onSpeakingChange(id);
          audio.onended = () => {
            activeAudio = null;
            if (playSessionToken === sessionToken) {
              activeId = null;
              onSpeakingChange(null);
            }
          };
          audio.onerror = () => {
            activeAudio = null;
            if (playSessionToken === sessionToken && !speakWithBrowserFallback()) {
              activeId = null;
              onSpeakingChange(null);
            }
          };
          await audio.play();
          return;
        }

        // Gapless sequential sentence-stream playback with pre-buffering
        const pendingChunks: Array<{ samples: Float32Array; sampleRate: number }> = [];
        let pendingDurationSec = 0;
        let expectedSentences = 1;
        let streamDone = false;
        let playbackStarted = false;
        let nextStartTime = audioCtx.currentTime;
        let scheduledCount = 0;
        let receivedAudioChunks = 0;
        let loadingCleared = false;

        const schedulePcmBlock = (samples: Float32Array, sampleRate: number) => {
          if (!audioCtx || playSessionToken !== sessionToken || samples.length === 0) return;
          const buffer = audioCtx.createBuffer(1, samples.length, sampleRate);
          buffer.getChannelData(0).set(samples);

          const src = audioCtx.createBufferSource();
          src.buffer = buffer;
          src.connect(audioCtx.destination);

          const now = audioCtx.currentTime;
          if (nextStartTime < now + 0.015) {
            nextStartTime = now + 0.08;
          }
          const startAt = nextStartTime;
          nextStartTime = startAt + buffer.duration;

          scheduledCount += 1;
          activeSources.add(src);
          src.onended = () => {
            activeSources.delete(src);
            if (
              playSessionToken === sessionToken &&
              streamDone &&
              pendingChunks.length === 0 &&
              activeSources.size === 0
            ) {
              activeId = null;
              onSpeakingChange(null);
            }
          };
          src.start(startAt);
        };

        const flushIfReady = (forceFlush = false) => {
          if (playSessionToken !== sessionToken || pendingChunks.length === 0) return;
          // Pre-buffer at least ~0.55s (or 2 sentences when multi-sentence) before starting playback
          const readyToStart =
            playbackStarted ||
            forceFlush ||
            streamDone ||
            (pendingDurationSec >= 0.55 && (expectedSentences <= 1 || pendingChunks.length >= 2 || pendingDurationSec >= 1.4));

          if (!readyToStart) return;

          if (!playbackStarted) {
            playbackStarted = true;
            activeId = id;
            onSpeakingChange(id);
            if (!loadingCleared) {
              loadingCleared = true;
              onLoadingChange?.(null);
            }
          }

          while (pendingChunks.length > 0) {
            const next = pendingChunks.shift()!;
            pendingDurationSec -= next.samples.length / next.sampleRate;
            schedulePcmBlock(next.samples, next.sampleRate);
          }
          pendingDurationSec = 0;
        };

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const processLine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          let evt: {
            type?: string;
            sentenceCount?: number;
            audioBase64?: string;
            error?: string;
          };
          try {
            evt = JSON.parse(trimmed);
          } catch {
            return;
          }
          if (evt.type === 'meta' && typeof evt.sentenceCount === 'number') {
            expectedSentences = Math.max(1, evt.sentenceCount);
          } else if (evt.type === 'audio_chunk' && evt.audioBase64) {
            const bytes = base64ToUint8(evt.audioBase64);
            const { samples, sampleRate } = decodeAudioBytesToPcmFloat32(bytes);
            if (samples.length > 0) {
              receivedAudioChunks += 1;
              pendingChunks.push({ samples, sampleRate });
              pendingDurationSec += samples.length / sampleRate;
              flushIfReady(false);
            }
          } else if (evt.type === 'done') {
            streamDone = true;
            flushIfReady(true);
          } else if (evt.type === 'error') {
            throw new Error(evt.error || 'تعذر تشغيل القراءة الصوتية.');
          }
        };

        while (true) {
          if (playSessionToken !== sessionToken) {
            reader.cancel().catch(() => undefined);
            return;
          }
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            processLine(line);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) processLine(buffer);

        streamDone = true;
        flushIfReady(true);

        if (receivedAudioChunks === 0 || scheduledCount === 0) {
          throw new Error('لم يتم استلام مقاطع صوتية صالحة من الخادم.');
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError' || playSessionToken !== sessionToken) {
          return;
        }
        if (!speakWithBrowserFallback()) {
          activeId = null;
          onSpeakingChange(null);
          onError?.(err instanceof Error ? err.message : 'تعذر قراءة النص صوتيًا.');
        }
      } finally {
        if (activeAbortController === abortController) {
          activeAbortController = null;
        }
        if (playSessionToken === sessionToken) {
          onLoadingChange?.(null);
        }
      }
    },
  };
}
