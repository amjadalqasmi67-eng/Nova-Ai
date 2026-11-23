import { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import {
  Mic,
  MicOff,
  PhoneOff,
  Volume2,
  Radio,
  MessageSquarePlus,
  Sparkles,
  Play,
  RefreshCw,
} from 'lucide-react';
import { NovaStarLogo } from './NovaStarLogo';
import { getOtpSessionToken, getOtpHeaders } from '../lib/otpSession';
import { consumePrimedOutputAudioContext, createAudioContextSafe } from '../lib/audioUnlock';
import { cleanTextForSpeech, pickBestArabicBrowserVoice } from '../lib/voiceReader';

interface VoiceTurnEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  audioBase64?: string | null;
  mimeType?: string | null;
}

interface LiveVoiceModalProps {
  user: User;
  customInstruction: string;
  onClose: () => void;
  onAppendTurns?: (turns: Array<{ role: 'user' | 'assistant'; content: string }>) => void;
}

type VoiceName = 'Zephyr' | 'Kore' | 'Puck' | 'Charon' | 'Fenrir';

const VOICE_OPTIONS: Array<{ id: VoiceName; label: string }> = [
  { id: 'Zephyr', label: 'صوت دافئ طبيعي (الافتراضي)' },
  { id: 'Kore', label: 'صوت هادئ وواضح' },
  { id: 'Puck', label: 'صوت شبابي حيوي' },
  { id: 'Charon', label: 'صوت عميق رزين' },
  { id: 'Fenrir', label: 'صوت جهوري متزن' },
];

const VOICE_STORAGE_KEY = 'nova_preferred_voice';

function getInitialVoiceName(): VoiceName {
  if (typeof window === 'undefined') return 'Zephyr';
  try {
    const saved = localStorage.getItem(VOICE_STORAGE_KEY) as VoiceName | null;
    if (saved && VOICE_OPTIONS.some((v) => v.id === saved)) {
      return saved;
    }
  } catch {
    // ignore storage errors
  }
  return 'Zephyr';
}

function downsampleTo16kFloat(input: Float32Array, inputSampleRate: number): Float32Array {
  const targetRate = 16000;
  if (inputSampleRate === targetRate || input.length === 0) {
    return input;
  }
  const ratio = inputSampleRate / targetRate;
  const newLength = Math.max(1, Math.floor(input.length / ratio));
  const samples = new Float32Array(newLength);

  // Gentle anti-alias smoothing + linear interpolation for clean Arabic speech capture
  for (let i = 0; i < newLength; i++) {
    const exactIndex = i * ratio;
    const idx0 = Math.floor(exactIndex);
    const idx1 = Math.min(input.length - 1, idx0 + 1);
    const frac = exactIndex - idx0;
    const interp = input[idx0] * (1 - frac) + input[idx1] * frac;

    if (ratio >= 2 && idx0 > 0 && idx1 + 1 < input.length) {
      samples[i] = 0.25 * input[idx0 - 1] + 0.5 * interp + 0.25 * input[idx1 + 1];
    } else {
      samples[i] = interp;
    }
  }
  return samples;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function float16kToPcmBase64(samples: Float32Array): string {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return uint8ToBase64(new Uint8Array(pcm.buffer));
}

function encode16kFloatToWavBase64(samples: Float32Array): string {
  const sampleRate = 16000;
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // AudioFormat = PCM
  view.setUint16(22, 1, true); // NumChannels = 1
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeString(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return uint8ToBase64(new Uint8Array(buffer));
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64ToFloat32From24kPCM(base64: string): Float32Array {
  const bytes = base64ToUint8Array(base64);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const float32 = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < sampleCount; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}

function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

export function LiveVoiceModal({ user, customInstruction, onClose, onAppendTurns }: LiveVoiceModalProps) {
  const [voiceName, setVoiceName] = useState<VoiceName>(() => getInitialVoiceName());
  const [mode, setMode] = useState<'connecting' | 'live' | 'auto-vad'>('connecting');
  const [statusText, setStatusText] = useState('جاري فتح الميكروفون وخط المحادثة الصوتية...');
  const [isMuted, setIsMuted] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isProcessingTurn, setIsProcessingTurn] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [entries, setEntries] = useState<VoiceTurnEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isMutedRef = useRef(false);
  const isAiSpeakingRef = useRef(false);
  const isProcessingTurnRef = useRef(false);
  const vadCooldownUntilRef = useRef(0);
  const modeRef = useRef<'connecting' | 'live' | 'auto-vad'>('connecting');
  const voiceNameRef = useRef<VoiceName>(voiceName);
  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const htmlAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentUserBufferRef = useRef('');
  const currentAiBufferRef = useRef('');
  const entriesRef = useRef<VoiceTurnEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const unmountedRef = useRef(false);
  const supportsLiveWsRef = useRef(true);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTokenRef = useRef(0);
  const lastUiMeterUpdateRef = useRef(0);

  // Auto-VAD state refs (used automatically in auto-vad mode with zero button presses)
  const vadPreRollRef = useRef<Float32Array[]>([]);
  const vadPreRollSamplesRef = useRef(0);
  const vadCaptureChunksRef = useRef<Float32Array[]>([]);
  const vadCaptureSamplesRef = useRef(0);
  const vadIsCapturingRef = useRef(false);
  const vadConsecutiveSpeechRef = useRef(0);
  const vadSpeechActiveMsRef = useRef(0);
  const vadSilenceMsRef = useRef(0);
  const vadNoiseFloorRef = useRef(0.008);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    voiceNameRef.current = voiceName;
    try {
      localStorage.setItem(VOICE_STORAGE_KEY, voiceName);
    } catch {
      // ignore
    }
  }, [voiceName]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    isAiSpeakingRef.current = isAiSpeaking;
  }, [isAiSpeaking]);

  useEffect(() => {
    isProcessingTurnRef.current = isProcessingTurn;
  }, [isProcessingTurn]);

  useEffect(() => {
    entriesRef.current = entries;
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  const stopBrowserSpeech = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  };

  const resetVadCaptureBuffers = () => {
    vadIsCapturingRef.current = false;
    vadConsecutiveSpeechRef.current = 0;
    vadSpeechActiveMsRef.current = 0;
    vadSilenceMsRef.current = 0;
    vadCaptureChunksRef.current = [];
    vadCaptureSamplesRef.current = 0;
    vadPreRollRef.current = [];
    vadPreRollSamplesRef.current = 0;
    setIsUserSpeaking(false);
  };

  const setAiSpeakingState = (speaking: boolean) => {
    isAiSpeakingRef.current = speaking;
    setIsAiSpeaking(speaking);
    if (!speaking) {
      vadCooldownUntilRef.current = Date.now() + 380;
    }
  };

  const stopPlaybackQueue = () => {
    activeSourcesRef.current.forEach((src) => {
      try {
        src.stop();
      } catch {
        // ignore
      }
    });
    activeSourcesRef.current.clear();
    if (htmlAudioRef.current) {
      try {
        htmlAudioRef.current.pause();
      } catch {
        // ignore
      }
      htmlAudioRef.current = null;
    }
    stopBrowserSpeech();
    if (outputAudioCtxRef.current) {
      nextStartTimeRef.current = outputAudioCtxRef.current.currentTime;
    }
    setAiSpeakingState(false);
  };

  const unlockAudioContexts = async () => {
    try {
      if (inputAudioCtxRef.current && inputAudioCtxRef.current.state === 'suspended') {
        await inputAudioCtxRef.current.resume();
      }
      if (!outputAudioCtxRef.current || outputAudioCtxRef.current.state === 'closed') {
        outputAudioCtxRef.current = consumePrimedOutputAudioContext();
        nextStartTimeRef.current = outputAudioCtxRef.current.currentTime;
      }
      if (outputAudioCtxRef.current.state === 'suspended') {
        await outputAudioCtxRef.current.resume();
      }
      setAudioBlocked(outputAudioCtxRef.current.state === 'suspended');
    } catch {
      // ignore resume errors until user gesture
    }
  };

  const getListeningReadyStatus = () =>
    isMutedRef.current
      ? 'الميكروفون مكتوم — اضغط لفتحه والتحدث'
      : 'أنا أستمع إليك الآن... قل «السلام عليكم» أو اسأل أي شيء مباشرة';

  const speakWithBrowserFallback = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text.trim()) {
      setAiSpeakingState(false);
      setStatusText(getListeningReadyStatus());
      return;
    }
    try {
      const voices = window.speechSynthesis.getVoices();
      const arabicVoice = pickBestArabicBrowserVoice(voices);
      if (!arabicVoice) {
        setAiSpeakingState(false);
        setStatusText('تم عرض الرد كتابيًا — أستمع إليك الآن');
        return;
      }

      window.speechSynthesis.cancel();
      const cleanSpeech = cleanTextForSpeech(text);
      if (!cleanSpeech) {
        setAiSpeakingState(false);
        setStatusText(getListeningReadyStatus());
        return;
      }

      const utterance = new SpeechSynthesisUtterance(cleanSpeech);
      utterance.voice = arabicVoice;
      utterance.lang = arabicVoice.lang || 'ar-SA';
      utterance.rate = 0.98;
      utterance.onstart = () => {
        setAiSpeakingState(true);
        setStatusText('نوفا يتحدث الآن...');
      };
      utterance.onend = () => {
        setAiSpeakingState(false);
        setStatusText(getListeningReadyStatus());
      };
      utterance.onerror = () => {
        setAiSpeakingState(false);
        setStatusText(getListeningReadyStatus());
      };
      window.speechSynthesis.speak(utterance);
    } catch {
      setAiSpeakingState(false);
      setStatusText(getListeningReadyStatus());
    }
  };

  const playReplyAudio = async (
    audioBase64: string | null | undefined,
    mimeType: string | null | undefined,
    replyText: string
  ) => {
    stopPlaybackQueue();

    if (!audioBase64 || !mimeType) {
      speakWithBrowserFallback(replyText);
      return;
    }

    await unlockAudioContexts();

    // Primary: Decode Gemini WAV directly through the unlocked Output AudioContext
    try {
      const ctx = outputAudioCtxRef.current ?? consumePrimedOutputAudioContext();
      outputAudioCtxRef.current = ctx;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      if (ctx.state === 'running') {
        const bytes = base64ToUint8Array(audioBase64);
        const arrayBuf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        const audioBuffer = await ctx.decodeAudioData(arrayBuf);
        const src = ctx.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(ctx.destination);
        activeSourcesRef.current.add(src);
        setAudioBlocked(false);
        setAiSpeakingState(true);
        setStatusText('نوفا يتحدث الآن...');
        src.onended = () => {
          activeSourcesRef.current.delete(src);
          if (activeSourcesRef.current.size === 0) {
            setAiSpeakingState(false);
            setStatusText(getListeningReadyStatus());
          }
        };
        src.start(0);
        return;
      }
    } catch {
      // Fallback to HTMLAudioElement below
    }

    // Secondary: HTML5 <audio>
    try {
      const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
      htmlAudioRef.current = audio;
      setAiSpeakingState(true);
      setStatusText('نوفا يتحدث الآن...');
      audio.onended = () => {
        htmlAudioRef.current = null;
        setAiSpeakingState(false);
        setStatusText(getListeningReadyStatus());
      };
      audio.onerror = () => {
        htmlAudioRef.current = null;
        speakWithBrowserFallback(replyText);
      };
      await audio.play();
      setAudioBlocked(false);
    } catch {
      setAudioBlocked(true);
      setAiSpeakingState(false);
      speakWithBrowserFallback(replyText);
    }
  };

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const cleanupProcessorOnly = () => {
    if (processorRef.current) {
      try {
        processorRef.current.onaudioprocess = null;
        processorRef.current.disconnect();
      } catch {
        // ignore
      }
      processorRef.current = null;
    }
    if (silentGainRef.current) {
      try {
        silentGainRef.current.disconnect();
      } catch {
        // ignore
      }
      silentGainRef.current = null;
    }
  };

  const cleanupLiveSocketOnly = () => {
    clearReconnectTimer();
    cleanupProcessorOnly();
    if (wsRef.current) {
      try {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
  };

  const cleanupAllAudio = () => {
    clearReconnectTimer();
    stopPlaybackQueue();
    cleanupLiveSocketOnly();
    resetVadCaptureBuffers();
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close().catch(() => undefined);
      inputAudioCtxRef.current = null;
    }
    if (outputAudioCtxRef.current) {
      outputAudioCtxRef.current.close().catch(() => undefined);
      outputAudioCtxRef.current = null;
    }
  };

  const upsertDraftEntry = (role: 'user' | 'assistant', textChunk: string) => {
    if (!textChunk) return;
    if (role === 'user') {
      currentUserBufferRef.current += textChunk;
      const full = currentUserBufferRef.current.trim();
      setEntries((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'user' && last.id.startsWith('live-user-')) {
          return [...prev.slice(0, -1), { ...last, text: full }];
        }
        return [...prev, { id: `live-user-${Date.now()}`, role: 'user', text: full }];
      });
    } else {
      currentAiBufferRef.current += textChunk;
      const full = currentAiBufferRef.current.trim();
      setEntries((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant' && last.id.startsWith('live-ai-')) {
          return [...prev.slice(0, -1), { ...last, text: full }];
        }
        return [...prev, { id: `live-ai-${Date.now()}`, role: 'assistant', text: full }];
      });
    }
  };

  const finalizeDraftIds = () => {
    currentUserBufferRef.current = '';
    currentAiBufferRef.current = '';
    setEntries((prev) =>
      prev.map((item) =>
        item.id.startsWith('live-') ? { ...item, id: `done-${item.role}-${Math.random().toString(36).slice(2, 8)}` } : item
      )
    );
  };

  const play24kChunk = async (base64Audio: string) => {
    let ctx = outputAudioCtxRef.current;
    if (!ctx || ctx.state === 'closed') {
      ctx = consumePrimedOutputAudioContext();
      outputAudioCtxRef.current = ctx;
      nextStartTimeRef.current = ctx.currentTime;
    }
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // ignore
      }
    }
    if (ctx.state !== 'running') {
      setAudioBlocked(true);
      return;
    }
    setAudioBlocked(false);

    const float32 = base64ToFloat32From24kPCM(base64Audio);
    if (float32.length === 0) return;

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    // Gapless scheduling: add tiny 60ms cushion only at the start of an utterance or after an underrun
    const now = ctx.currentTime;
    if (nextStartTimeRef.current < now - 0.005) {
      nextStartTimeRef.current = now + 0.06;
    }
    const startAt = nextStartTimeRef.current;
    nextStartTimeRef.current = startAt + buffer.duration;

    activeSourcesRef.current.add(source);
    if (!isAiSpeakingRef.current) {
      setAiSpeakingState(true);
      setStatusText('نوفا يتحدث الآن...');
    }

    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (activeSourcesRef.current.size === 0) {
        setAiSpeakingState(false);
        if (modeRef.current === 'live' || modeRef.current === 'auto-vad') {
          setStatusText(getListeningReadyStatus());
        }
      }
    };

    source.start(startAt);
  };

  const submitAutoVadTurn = async (capturedSamples: Float32Array, attemptToken: number) => {
    if (unmountedRef.current || connectTokenRef.current !== attemptToken || capturedSamples.length < 4800) {
      return;
    }

    isProcessingTurnRef.current = true;
    setIsProcessingTurn(true);
    setStatusText('نوفا يستمع ويفكّر في الرد...');
    setError(null);

    try {
      const wavBase64 = encode16kFloatToWavBase64(capturedSamples);
      const idToken = await user.getIdToken();
      if (unmountedRef.current || connectTokenRef.current !== attemptToken) return;

      const res = await fetch('/api/nova/voice-turn', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
          ...getOtpHeaders(),
        },
        body: JSON.stringify({
          audioBase64: wavBase64,
          mimeType: 'audio/wav',
          voiceName: voiceNameRef.current,
          customInstruction,
          history: entriesRef.current.slice(-6).map((e) => ({ role: e.role, content: e.text })),
        }),
      });

      const rawText = await res.text();
      if (rawText.trimStart().startsWith('<')) {
        throw new Error('انقطع الاتصال المؤقت بالخادم. يرجى إعادة المحاولة.');
      }

      let data: {
        userTranscript?: string;
        replyText?: string;
        noSpeechDetected?: boolean;
        audioBase64?: string | null;
        mimeType?: string | null;
        error?: string;
      };
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error('استجابة غير صالحة من الخادم.');
      }

      if (data.noSpeechDetected) {
        setStatusText(getListeningReadyStatus());
        return;
      }

      if (!res.ok || !data.replyText) {
        throw new Error(data.error || 'تعذر معالجة الصوت');
      }

      const newTurns: VoiceTurnEntry[] = [];
      if (data.userTranscript) {
        newTurns.push({ id: `u-${Date.now()}`, role: 'user', text: data.userTranscript });
      }
      newTurns.push({
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: data.replyText,
        audioBase64: data.audioBase64,
        mimeType: data.mimeType,
      });
      setEntries((prev) => [...prev, ...newTurns]);

      await playReplyAudio(data.audioBase64, data.mimeType, data.replyText);
    } catch (err) {
      if (!unmountedRef.current && connectTokenRef.current === attemptToken) {
        setError(err instanceof Error ? err.message : 'تعذر إرسال الصوت');
        setStatusText(getListeningReadyStatus());
      }
    } finally {
      if (!unmountedRef.current && connectTokenRef.current === attemptToken) {
        isProcessingTurnRef.current = false;
        setIsProcessingTurn(false);
        vadCooldownUntilRef.current = Date.now() + 350;
      }
    }
  };

  const startHandsFreeAutoVad = (stream: MediaStream, inputCtx: AudioContext, attemptToken: number) => {
    if (unmountedRef.current || connectTokenRef.current !== attemptToken) return;

    cleanupLiveSocketOnly();
    resetVadCaptureBuffers();
    modeRef.current = 'auto-vad';
    setMode('auto-vad');
    setError(null);
    setStatusText(getListeningReadyStatus());

    inputCtx.resume().catch(() => undefined);

    const bufferSize = inputCtx.sampleRate >= 44100 ? 4096 : 2048;
    const source = inputCtx.createMediaStreamSource(stream);
    const processor = inputCtx.createScriptProcessor(bufferSize, 1, 1);
    const silentGain = inputCtx.createGain();
    silentGain.gain.value = 0;

    processorRef.current = processor;
    silentGainRef.current = silentGain;

    const maxPreRollSamples = 9600; // 600ms @ 16kHz so first syllable ("السلام") is never clipped
    const maxCaptureSamples = 16000 * 15; // 15 seconds max per turn

    processor.onaudioprocess = (ev) => {
      if (unmountedRef.current || connectTokenRef.current !== attemptToken || modeRef.current !== 'auto-vad') {
        return;
      }
      if (
        isMutedRef.current ||
        isAiSpeakingRef.current ||
        isProcessingTurnRef.current ||
        Date.now() < vadCooldownUntilRef.current
      ) {
        if (vadIsCapturingRef.current) {
          resetVadCaptureBuffers();
        }
        setMicLevel(0);
        return;
      }

      const rawChannel = ev.inputBuffer.getChannelData(0);
      const samples16k = downsampleTo16kFloat(rawChannel, inputCtx.sampleRate);
      const frameMs = (samples16k.length / 16000) * 1000;
      const rms = computeRms(samples16k);

      const now = Date.now();
      if (now - lastUiMeterUpdateRef.current > 90) {
        lastUiMeterUpdateRef.current = now;
        setMicLevel(Math.min(1, rms * 10));
      }

      // Copy samples because ScriptProcessor reuses underlying buffer
      const frameCopy = new Float32Array(samples16k);
      const startThreshold = Math.max(0.02, vadNoiseFloorRef.current * 2.5);
      const sustainThreshold = Math.max(0.014, vadNoiseFloorRef.current * 1.8);

      if (!vadIsCapturingRef.current) {
        // Maintain rolling 600ms pre-roll buffer while listening
        vadPreRollRef.current.push(frameCopy);
        vadPreRollSamplesRef.current += frameCopy.length;
        while (vadPreRollSamplesRef.current > maxPreRollSamples && vadPreRollRef.current.length > 1) {
          const removed = vadPreRollRef.current.shift()!;
          vadPreRollSamplesRef.current -= removed.length;
        }

        if (rms >= startThreshold) {
          vadConsecutiveSpeechRef.current += 1;
          if (vadConsecutiveSpeechRef.current >= 2) {
            vadIsCapturingRef.current = true;
            vadCaptureChunksRef.current = [...vadPreRollRef.current];
            vadCaptureSamplesRef.current = vadPreRollSamplesRef.current;
            vadPreRollRef.current = [];
            vadPreRollSamplesRef.current = 0;
            vadSpeechActiveMsRef.current = frameMs * 2;
            vadSilenceMsRef.current = 0;
            setIsUserSpeaking(true);
            setStatusText('أستمع لكلامك الآن...');
          }
        } else {
          vadConsecutiveSpeechRef.current = 0;
          vadNoiseFloorRef.current = Math.min(0.025, Math.max(0.004, vadNoiseFloorRef.current * 0.92 + rms * 0.08));
        }
      } else {
        vadCaptureChunksRef.current.push(frameCopy);
        vadCaptureSamplesRef.current += frameCopy.length;

        if (rms >= sustainThreshold) {
          vadSpeechActiveMsRef.current += frameMs;
          vadSilenceMsRef.current = 0;
        } else {
          vadSilenceMsRef.current += frameMs;
        }

        const reachedSilenceEnd = vadSilenceMsRef.current >= 1150;
        const reachedMaxDuration = vadCaptureSamplesRef.current >= maxCaptureSamples;

        if (reachedSilenceEnd || reachedMaxDuration) {
          const chunks = vadCaptureChunksRef.current;
          const totalLen = vadCaptureSamplesRef.current;
          const speechDurationMs = vadSpeechActiveMsRef.current;
          resetVadCaptureBuffers();

          if (speechDurationMs >= 260 && totalLen >= 4800) {
            const combined = new Float32Array(totalLen);
            let offset = 0;
            for (const c of chunks) {
              combined.set(c, offset);
              offset += c.length;
            }
            submitAutoVadTurn(combined, attemptToken).catch(() => undefined);
          } else {
            setStatusText(getListeningReadyStatus());
          }
        }
      }
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(inputCtx.destination);
  };

  const openLiveWebSocket = async (
    stream: MediaStream,
    inputCtx: AudioContext,
    outputCtx: AudioContext,
    attemptToken: number
  ) => {
    if (unmountedRef.current || connectTokenRef.current !== attemptToken) {
      return;
    }

    cleanupLiveSocketOnly();

    let idToken = '';
    try {
      idToken = await user.getIdToken();
    } catch {
      startHandsFreeAutoVad(stream, inputCtx, attemptToken);
      return;
    }

    if (unmountedRef.current || connectTokenRef.current !== attemptToken) {
      return;
    }

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${window.location.host}/api/nova/live`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    let openedSuccessfully = false;
    let settledFailure = false;

    const scheduleAutoReconnectOrVad = () => {
      if (settledFailure || unmountedRef.current || connectTokenRef.current !== attemptToken) {
        return;
      }
      settledFailure = true;
      cleanupLiveSocketOnly();

      if (supportsLiveWsRef.current && reconnectAttemptsRef.current < 2) {
        reconnectAttemptsRef.current += 1;
        const attemptNum = reconnectAttemptsRef.current;
        setMode('connecting');
        modeRef.current = 'connecting';
        setError(null);
        setStatusText(`جاري إعادة وصل الصوت المباشر تلقائيًا (${attemptNum} من 2)...`);
        reconnectTimerRef.current = setTimeout(() => {
          openLiveWebSocket(stream, inputCtx, outputCtx, attemptToken).catch(() => undefined);
        }, attemptNum * 900);
      } else {
        // Seamlessly switch to Hands-Free Auto-VAD with ZERO manual button required
        startHandsFreeAutoVad(stream, inputCtx, attemptToken);
      }
    };

    const connectTimeout = setTimeout(() => {
      if (!openedSuccessfully) {
        scheduleAutoReconnectOrVad();
      }
    }, 12000);

    ws.onopen = () => {
      if (unmountedRef.current || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: 'auth',
          token: idToken,
          otpToken: getOtpSessionToken() || '',
          voice: voiceNameRef.current,
          instruction: customInstruction.slice(0, 400),
        })
      );
    };

    ws.onmessage = (event) => {
      if (unmountedRef.current || connectTokenRef.current !== attemptToken) return;
      try {
        const msg = JSON.parse(event.data as string) as {
          ready?: boolean;
          audio?: string;
          inputTranscript?: string;
          outputTranscript?: string;
          interrupted?: boolean;
          turnComplete?: boolean;
          error?: string;
        };

        if (msg.ready) {
          openedSuccessfully = true;
          clearTimeout(connectTimeout);
          reconnectAttemptsRef.current = 0;
          setError(null);
          setMode('live');
          modeRef.current = 'live';
          setStatusText(getListeningReadyStatus());

          inputCtx.resume().catch(() => undefined);
          outputCtx.resume().catch(() => undefined);

          cleanupProcessorOnly();
          const bufferSize = inputCtx.sampleRate >= 44100 ? 4096 : 2048;
          const source = inputCtx.createMediaStreamSource(stream);
          const processor = inputCtx.createScriptProcessor(bufferSize, 1, 1);
          const silentGain = inputCtx.createGain();
          silentGain.gain.value = 0;
          processorRef.current = processor;
          silentGainRef.current = silentGain;

          processor.onaudioprocess = (ev) => {
            if (isMutedRef.current || ws.readyState !== WebSocket.OPEN) {
              setMicLevel(0);
              return;
            }
            const channel = ev.inputBuffer.getChannelData(0);
            const samples16k = downsampleTo16kFloat(channel, inputCtx.sampleRate);
            const rms = computeRms(samples16k);
            const now = Date.now();
            if (now - lastUiMeterUpdateRef.current > 90) {
              lastUiMeterUpdateRef.current = now;
              setMicLevel(Math.min(1, rms * 10));
            }
            const base64 = float16kToPcmBase64(samples16k);
            ws.send(JSON.stringify({ audio: base64 }));
          };

          source.connect(processor);
          processor.connect(silentGain);
          silentGain.connect(inputCtx.destination);
        } else if (msg.audio) {
          play24kChunk(msg.audio).catch(() => undefined);
        } else if (msg.inputTranscript) {
          upsertDraftEntry('user', msg.inputTranscript);
        } else if (msg.outputTranscript) {
          upsertDraftEntry('assistant', msg.outputTranscript);
        } else if (msg.interrupted) {
          stopPlaybackQueue();
          finalizeDraftIds();
        } else if (msg.turnComplete) {
          finalizeDraftIds();
        } else if (msg.error) {
          clearTimeout(connectTimeout);
          scheduleAutoReconnectOrVad();
        }
      } catch {
        // ignore
      }
    };

    ws.onerror = () => {
      clearTimeout(connectTimeout);
      scheduleAutoReconnectOrVad();
    };

    ws.onclose = () => {
      clearTimeout(connectTimeout);
      if (modeRef.current !== 'auto-vad') {
        scheduleAutoReconnectOrVad();
      }
    };
  };

  const startLiveVoiceSession = async () => {
    const attemptToken = ++connectTokenRef.current;
    unmountedRef.current = false;
    reconnectAttemptsRef.current = 0;

    cleanupAllAudio();
    setMode('connecting');
    modeRef.current = 'connecting';
    setError(null);
    setStatusText('جاري فتح الميكروفون وخط المحادثة الصوتية...');

    // Synchronously consume/resume primed output audio context as early as possible
    const outputCtx = consumePrimedOutputAudioContext();
    outputAudioCtxRef.current = outputCtx;
    nextStartTimeRef.current = outputCtx.currentTime;
    outputCtx.resume().catch(() => undefined);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (unmountedRef.current || connectTokenRef.current !== attemptToken) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      mediaStreamRef.current = stream;

      const inputCtx = createAudioContextSafe(16000);
      inputAudioCtxRef.current = inputCtx;

      await inputCtx.resume().catch(() => undefined);
      await outputCtx.resume().catch(() => undefined);
      setAudioBlocked(outputCtx.state === 'suspended');

      supportsLiveWsRef.current = true;
      try {
        const healthRes = await fetch('/api/health', { signal: AbortSignal.timeout(2500) });
        if (healthRes.ok) {
          const health = (await healthRes.json()) as { liveWsSupported?: boolean };
          if (health.liveWsSupported === false) {
            supportsLiveWsRef.current = false;
          }
        }
      } catch {
        // Proceed to WebSocket attempt if health check fails transiently
      }

      if (unmountedRef.current || connectTokenRef.current !== attemptToken) return;

      if (!supportsLiveWsRef.current) {
        startHandsFreeAutoVad(stream, inputCtx, attemptToken);
        return;
      }

      await openLiveWebSocket(stream, inputCtx, outputCtx, attemptToken);
    } catch {
      if (!unmountedRef.current && connectTokenRef.current === attemptToken) {
        setError('يرجى السماح بالوصول إلى الميكروفون من المتصفح ليتمكن نوفا من سماعك فورًا.');
        setMode('auto-vad');
        modeRef.current = 'auto-vad';
        setStatusText('الميكروفون يحتاج إلى إذن الوصول');
      }
    }
  };

  useEffect(() => {
    startLiveVoiceSession().catch(() => undefined);

    return () => {
      unmountedRef.current = true;
      connectTokenRef.current += 1;
      cleanupAllAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceName]);

  const handleCloseAndSave = () => {
    const cleanTurns = entriesRef.current
      .filter((e) => e.text.trim().length > 0)
      .map((e) => ({ role: e.role, content: e.text.trim() }));
    if (cleanTurns.length > 0 && onAppendTurns) {
      onAppendTurns(cleanTurns);
    }
    cleanupAllAudio();
    onClose();
  };

  const replayEntryAudio = async (item: VoiceTurnEntry) => {
    if (item.audioBase64 && item.mimeType) {
      await playReplyAudio(item.audioBase64, item.mimeType, item.text);
      return;
    }
    try {
      await unlockAudioContexts();
      const idToken = await user.getIdToken();
      const res = await fetch('/api/nova/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
          ...getOtpHeaders(),
        },
        body: JSON.stringify({ text: item.text, voiceName: voiceNameRef.current }),
      });
      if (res.ok) {
        const data = (await res.json()) as { audioBase64?: string; mimeType?: string };
        if (data.audioBase64 && data.mimeType) {
          setEntries((prev) =>
            prev.map((e) => (e.id === item.id ? { ...e, audioBase64: data.audioBase64, mimeType: data.mimeType } : e))
          );
          await playReplyAudio(data.audioBase64, data.mimeType, item.text);
          return;
        }
      }
    } catch {
      // fall through
    }
    await playReplyAudio(null, null, item.text);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="محادثة صوتية مباشرة مع Nova AI"
      onPointerDown={() => {
        unlockAudioContexts().catch(() => undefined);
      }}
    >
      <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-[#0B1020] border border-slate-200 dark:border-white/15 shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Radio className="w-4 h-4 animate-pulse" style={{ color: 'var(--accent-primary)' }} />
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">المحادثة الصوتية التلقائية</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {mode === 'live'
                  ? 'استماع مباشر وفوري بدون أزرار'
                  : mode === 'connecting'
                    ? 'جاري تجهيز الميكروفون...'
                    : 'استماع تلقائي ذكي بدون أزرار'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={voiceName}
              onChange={(e) => setVoiceName(e.target.value as VoiceName)}
              aria-label="اختيار نبرة الصوت"
              className="rounded-xl bg-slate-100 dark:bg-[#070B18] border border-slate-200 dark:border-white/10 px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              {VOICE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Center Voice Orb */}
        <div className="px-6 py-6 flex flex-col items-center text-center gap-4 bg-slate-50/70 dark:bg-[#070B17]/80 border-b border-slate-200 dark:border-white/10">
          <div className="relative flex items-center justify-center">
            <div
              className="w-28 h-28 rounded-full flex items-center justify-center transition-transform duration-150"
              style={{
                transform: `scale(${
                  isAiSpeaking
                    ? 1.1
                    : isUserSpeaking || micLevel > 0.12
                      ? 1 + Math.min(0.14, micLevel * 0.22)
                      : 1
                })`,
                background: 'radial-gradient(circle, var(--accent-soft), transparent 70%)',
                boxShadow:
                  isAiSpeaking || isUserSpeaking || mode === 'live'
                    ? '0 0 42px var(--accent-glow)'
                    : 'none',
              }}
            >
              <NovaStarLogo size="lg" />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-slate-900 dark:text-white flex items-center justify-center gap-2">
              {isAiSpeaking && <Volume2 className="w-4 h-4 animate-pulse" style={{ color: 'var(--accent-primary)' }} />}
              <span>{statusText}</span>
            </div>

            {!isMuted && mode !== 'connecting' && !isAiSpeaking && !isProcessingTurn && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                تحدّث بحرية الآن — سيلتقط نوفا صوتك تلقائيًا ويرد عليك فور انتهائك من الكلام
              </p>
            )}

            {audioBlocked && (
              <button
                type="button"
                onClick={() => {
                  unlockAudioContexts().catch(() => undefined);
                }}
                className="accent-btn inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-white text-xs font-semibold cursor-pointer"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>اضغط هنا لتفعيل السماعة</span>
              </button>
            )}

            {error && (
              <div
                role="alert"
                className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs text-rose-600 dark:text-rose-200 flex flex-wrap items-center justify-center gap-2"
              >
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => {
                    startLiveVoiceSession().catch(() => undefined);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>إعادة المحاولة</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Live Transcript Feed */}
        <div className="flex-1 min-h-[140px] max-h-56 overflow-y-auto p-4 space-y-2.5">
          {entries.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400 flex flex-col items-center gap-2">
              <Sparkles className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <span>بمجرد فتح هذه النافذة قل «السلام عليكم» مباشرة وسيجيبك نوفا بصوته الطبيعي فورًا.</span>
            </div>
          ) : (
            entries.map((item) => (
              <div
                key={item.id}
                className={`rounded-xl px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed flex items-start justify-between gap-2 ${
                  item.role === 'user'
                    ? 'bg-slate-100 dark:bg-[#121A33] text-slate-900 dark:text-slate-100'
                    : 'bg-white dark:bg-[#070B18] border border-slate-200 dark:border-white/10 text-slate-800 dark:text-slate-200'
                }`}
              >
                <div>
                  <span className="font-bold ml-1.5" style={{ color: 'var(--accent-text)' }}>
                    {item.role === 'user' ? 'أنت:' : 'نوفا:'}
                  </span>
                  <span>{item.text}</span>
                </div>
                {item.role === 'assistant' && item.text.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      replayEntryAudio(item).catch(() => undefined);
                    }}
                    aria-label="إعادة تشغيل الصوت"
                    title="إعادة تشغيل الصوت"
                    className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 shrink-0 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                  </button>
                )}
              </div>
            ))
          )}
          <div ref={scrollRef} />
        </div>

        {/* Hands-Free Controls Footer (Zero Push-to-Talk Button) */}
        <div className="p-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#070B17] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              unlockAudioContexts().catch(() => undefined);
              setIsMuted((prev) => {
                const next = !prev;
                isMutedRef.current = next;
                setStatusText(
                  next
                    ? 'الميكروفون مكتوم — اضغط لفتحه والتحدث'
                    : 'أنا أستمع إليك الآن... قل «السلام عليكم» أو اسأل أي شيء مباشرة'
                );
                return next;
              });
            }}
            className={`flex-1 inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold cursor-pointer border transition-colors ${
              isMuted
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-300'
                : 'bg-white dark:bg-[#101830] border-slate-200 dark:border-white/15 text-slate-900 dark:text-white'
            }`}
          >
            {isMuted ? (
              <MicOff className="w-4 h-4" />
            ) : (
              <Mic className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            )}
            <span>{isMuted ? 'الميكروفون مكتوم' : 'الميكروفون مفتوح (تلقائي)'}</span>
          </button>

          <button
            type="button"
            onClick={handleCloseAndSave}
            className="inline-flex items-center gap-2 py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold cursor-pointer shrink-0"
          >
            {entries.length > 0 ? <MessageSquarePlus className="w-4 h-4" /> : <PhoneOff className="w-4 h-4" />}
            <span>{entries.length > 0 ? 'إنهاء وحفظ بالمحادثة' : 'إنهاء'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
