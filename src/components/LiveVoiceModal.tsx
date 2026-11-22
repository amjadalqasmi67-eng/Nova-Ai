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

type VoiceName = 'Kore' | 'Zephyr' | 'Puck' | 'Charon';

const VOICE_OPTIONS: Array<{ id: VoiceName; label: string }> = [
  { id: 'Kore', label: 'صوت ناعم وواضح' },
  { id: 'Zephyr', label: 'صوت حيوي دافئ' },
  { id: 'Puck', label: 'صوت شبابي سريع' },
  { id: 'Charon', label: 'صوت عميق رزين' },
];

function downsampleTo16kPCM(input: Float32Array, inputSampleRate: number): string {
  const targetRate = 16000;
  let samples: Float32Array;
  if (inputSampleRate === targetRate) {
    samples = input;
  } else {
    const ratio = inputSampleRate / targetRate;
    const newLength = Math.max(1, Math.floor(input.length / ratio));
    samples = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += input[j];
      }
      samples[i] = sum / (end - start);
    }
  }

  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const bytes = new Uint8Array(pcm.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
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
  const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

function pickSupportedRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return 'audio/webm';
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

function createAudioContextSafe(preferredSampleRate?: number): AudioContext {
  const AudioCtx =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (preferredSampleRate) {
    try {
      return new AudioCtx({ sampleRate: preferredSampleRate });
    } catch {
      return new AudioCtx();
    }
  }
  return new AudioCtx();
}

export function LiveVoiceModal({ user, customInstruction, onClose, onAppendTurns }: LiveVoiceModalProps) {
  const [voiceName, setVoiceName] = useState<VoiceName>('Kore');
  const [mode, setMode] = useState<'connecting' | 'live' | 'turn-fallback'>('connecting');
  const [statusText, setStatusText] = useState('جاري فتح خط المحادثة الصوتية المباشرة...');
  const [isMuted, setIsMuted] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isRecordingTurn, setIsRecordingTurn] = useState(false);
  const [isProcessingTurn, setIsProcessingTurn] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [entries, setEntries] = useState<VoiceTurnEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isMutedRef = useRef(false);
  const modeRef = useRef<'connecting' | 'live' | 'turn-fallback'>('connecting');
  const voiceNameRef = useRef<VoiceName>(voiceName);
  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const htmlAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const currentUserBufferRef = useRef('');
  const currentAiBufferRef = useRef('');
  const entriesRef = useRef<VoiceTurnEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const unmountedRef = useRef(false);
  const manualFallbackRef = useRef(false);
  const supportsLiveWsRef = useRef(true);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTokenRef = useRef(0);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    voiceNameRef.current = voiceName;
  }, [voiceName]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

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
    setIsAiSpeaking(false);
  };

  const unlockAudioContexts = async () => {
    try {
      if (inputAudioCtxRef.current && inputAudioCtxRef.current.state === 'suspended') {
        await inputAudioCtxRef.current.resume();
      }
      if (!outputAudioCtxRef.current) {
        outputAudioCtxRef.current = createAudioContextSafe(24000);
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

  const speakWithBrowserFallback = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text.trim()) {
      setIsAiSpeaking(false);
      return;
    }
    try {
      const voices = window.speechSynthesis.getVoices();
      const arabicVoice = voices.find((v) => v.lang.toLowerCase().startsWith('ar'));
      if (!arabicVoice) {
        setIsAiSpeaking(false);
        setStatusText('تم عرض الرد كتابيًا (الصوت العربي المحلي غير متوفر على هذا الجهاز)');
        return;
      }

      window.speechSynthesis.cancel();
      const cleanSpeech = text
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[*#`>_~[\](){}|\\]/g, ' ')
        .replace(/\bNova AI\b/gi, 'نوفا')
        .replace(/%/g, ' بالمئة ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleanSpeech) {
        setIsAiSpeaking(false);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(cleanSpeech);
      utterance.voice = arabicVoice;
      utterance.lang = arabicVoice.lang || 'ar-SA';
      utterance.rate = 0.98;
      utterance.onstart = () => {
        setIsAiSpeaking(true);
        setStatusText('Nova AI يتحدث الآن...');
      };
      utterance.onend = () => {
        setIsAiSpeaking(false);
        setStatusText('اضغط للتحدث مجددًا مع Nova AI');
      };
      utterance.onerror = () => {
        setIsAiSpeaking(false);
        setStatusText('اضغط للتحدث مجددًا مع Nova AI');
      };
      window.speechSynthesis.speak(utterance);
    } catch {
      setIsAiSpeaking(false);
    }
  };

  const playReplyAudio = async (audioBase64: string | null | undefined, mimeType: string | null | undefined, replyText: string) => {
    stopPlaybackQueue();

    if (!audioBase64 || !mimeType) {
      speakWithBrowserFallback(replyText);
      return;
    }

    await unlockAudioContexts();

    // Primary: Decode WAV directly through the unlocked Output AudioContext (reliable on mobile & iframe)
    try {
      const ctx = outputAudioCtxRef.current ?? createAudioContextSafe(24000);
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
        setIsAiSpeaking(true);
        setStatusText('Nova AI يتحدث الآن...');
        src.onended = () => {
          activeSourcesRef.current.delete(src);
          if (activeSourcesRef.current.size === 0) {
            setIsAiSpeaking(false);
            setStatusText('اضغط للتحدث مجددًا مع Nova AI');
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
      setIsAiSpeaking(true);
      setStatusText('Nova AI يتحدث الآن...');
      audio.onended = () => {
        htmlAudioRef.current = null;
        setIsAiSpeaking(false);
        setStatusText('اضغط للتحدث مجددًا مع Nova AI');
      };
      audio.onerror = () => {
        htmlAudioRef.current = null;
        speakWithBrowserFallback(replyText);
      };
      await audio.play();
      setAudioBlocked(false);
    } catch {
      setAudioBlocked(true);
      setIsAiSpeaking(false);
      speakWithBrowserFallback(replyText);
    }
  };

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const cleanupLiveSocketOnly = () => {
    clearReconnectTimer();
    if (processorRef.current) {
      try {
        processorRef.current.onaudioprocess = null;
        processorRef.current.disconnect();
      } catch {
        // ignore
      }
      processorRef.current = null;
    }
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

  const switchToTurnFallback = (message?: string, userInitiated = false) => {
    if (userInitiated) {
      manualFallbackRef.current = true;
    }
    cleanupLiveSocketOnly();
    modeRef.current = 'turn-fallback';
    setMode('turn-fallback');
    setStatusText(message || 'اضغط «اضغط للتحدث الآن» وسيرد عليك Nova AI صوتيًا');
  };

  const cleanupAllAudio = () => {
    clearReconnectTimer();
    stopPlaybackQueue();
    cleanupLiveSocketOnly();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
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
    if (!ctx) {
      ctx = createAudioContextSafe(24000);
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

    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.02, nextStartTimeRef.current);
    nextStartTimeRef.current = startAt + buffer.duration;

    activeSourcesRef.current.add(source);
    setIsAiSpeaking(true);

    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (activeSourcesRef.current.size === 0) {
        setIsAiSpeaking(false);
      }
    };

    source.start(startAt);
  };

  const openLiveWebSocket = async (
    stream: MediaStream,
    inputCtx: AudioContext,
    outputCtx: AudioContext,
    attemptToken: number
  ) => {
    if (unmountedRef.current || manualFallbackRef.current || connectTokenRef.current !== attemptToken) {
      return;
    }

    cleanupLiveSocketOnly();

    let idToken = '';
    try {
      idToken = await user.getIdToken();
    } catch {
      setError('تعذر تجديد جلسة التحقق للصوت المباشر.');
      switchToTurnFallback('تم التحويل للمحادثة الصوتية التفاعلية — اضغط للتحدث');
      return;
    }

    if (unmountedRef.current || manualFallbackRef.current || connectTokenRef.current !== attemptToken) {
      return;
    }

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${window.location.host}/api/nova/live`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    let openedSuccessfully = false;
    let settledFailure = false;

    const scheduleAutoReconnectOrFallback = (reasonText?: string) => {
      if (
        settledFailure ||
        unmountedRef.current ||
        manualFallbackRef.current ||
        connectTokenRef.current !== attemptToken
      ) {
        return;
      }
      settledFailure = true;
      cleanupLiveSocketOnly();

      if (supportsLiveWsRef.current && reconnectAttemptsRef.current < 3) {
        reconnectAttemptsRef.current += 1;
        const attemptNum = reconnectAttemptsRef.current;
        setMode('connecting');
        modeRef.current = 'connecting';
        setError(null);
        setStatusText(`انقطع الاتصال الصوتي، جاري إعادة الاتصال تلقائيًا (المحاولة ${attemptNum} من 3)...`);
        reconnectTimerRef.current = setTimeout(() => {
          openLiveWebSocket(stream, inputCtx, outputCtx, attemptToken).catch(() => undefined);
        }, attemptNum * 1000);
      } else {
        setError(
          reasonText ||
            'انقطع الاتصال بالبث الصوتي المباشر وتعذر استعادته تلقائيًا. يمكنك المتابعة عبر الضغط للتحدث أو إعادة المحاولة.'
        );
        switchToTurnFallback('تم التحويل لوضع الضغط للتحدث مع Nova AI');
      }
    };

    const connectTimeout = setTimeout(() => {
      if (!openedSuccessfully) {
        scheduleAutoReconnectOrFallback();
      }
    }, 6000);

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
          setStatusText('أنا أستمع إليك الآن... تكلّم وسأرد عليك بصوتي!');

          inputCtx.resume().catch(() => undefined);
          outputCtx.resume().catch(() => undefined);

          const source = inputCtx.createMediaStreamSource(stream);
          const processor = inputCtx.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;

          processor.onaudioprocess = (ev) => {
            if (isMutedRef.current || ws.readyState !== WebSocket.OPEN) return;
            const channel = ev.inputBuffer.getChannelData(0);
            const base64 = downsampleTo16kPCM(channel, inputCtx.sampleRate);
            ws.send(JSON.stringify({ audio: base64 }));
          };

          source.connect(processor);
          const silentGain = inputCtx.createGain();
          silentGain.gain.value = 0;
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
          scheduleAutoReconnectOrFallback(msg.error);
        }
      } catch {
        // ignore
      }
    };

    ws.onerror = () => {
      clearTimeout(connectTimeout);
      scheduleAutoReconnectOrFallback();
    };

    ws.onclose = () => {
      clearTimeout(connectTimeout);
      if (modeRef.current !== 'turn-fallback') {
        scheduleAutoReconnectOrFallback();
      }
    };
  };

  const startLiveVoiceSession = async () => {
    const attemptToken = ++connectTokenRef.current;
    unmountedRef.current = false;
    manualFallbackRef.current = false;
    reconnectAttemptsRef.current = 0;

    cleanupAllAudio();
    setMode('connecting');
    modeRef.current = 'connecting';
    setError(null);
    setStatusText('جاري فتح خط المحادثة الصوتية المباشرة...');

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
      const outputCtx = createAudioContextSafe(24000);
      inputAudioCtxRef.current = inputCtx;
      outputAudioCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      await inputCtx.resume().catch(() => undefined);
      await outputCtx.resume().catch(() => undefined);
      if (outputCtx.state === 'suspended') {
        setAudioBlocked(true);
      }

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
        // Proceed to WebSocket probe if health check fails transiently
      }

      if (unmountedRef.current || connectTokenRef.current !== attemptToken) return;

      if (!supportsLiveWsRef.current) {
        switchToTurnFallback('المحادثة الصوتية التفاعلية جاهزة — اضغط للتحدث وسيرد عليك Nova AI بصوته');
        return;
      }

      await openLiveWebSocket(stream, inputCtx, outputCtx, attemptToken);
    } catch {
      if (!unmountedRef.current && connectTokenRef.current === attemptToken) {
        setError('يرجى السماح بالوصول إلى الميكروفون للتحدث مع Nova AI.');
        setMode('turn-fallback');
        modeRef.current = 'turn-fallback';
        setStatusText('الميكروفون غير متاح أو يحتاج إذنًا');
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

  const startTurnRecording = async () => {
    await unlockAudioContexts();
    stopPlaybackQueue();
    if (isRecordingTurn || isProcessingTurn) return;

    if (!mediaStreamRef.current) {
      try {
        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        setError('يرجى السماح بالوصول إلى الميكروفون من إعدادات المتصفح.');
        return;
      }
    }

    setError(null);
    recordedChunksRef.current = [];

    const preferredMime = pickSupportedRecorderMime();
    const recorder = preferredMime
      ? new MediaRecorder(mediaStreamRef.current, { mimeType: preferredMime })
      : new MediaRecorder(mediaStreamRef.current);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
    };

    recorder.onstop = async () => {
      const actualMime = recorder.mimeType || preferredMime || 'audio/webm';
      const blob = new Blob(recordedChunksRef.current, { type: actualMime });
      if (blob.size < 400) {
        setError('التسجيل قصير جدًا أو لم يتم التقاط صوت. تحدّث لمدة ثانية على الأقل ثم أوقف التسجيل.');
        setStatusText('اضغط للتحدث مع Nova AI صوتيًا');
        return;
      }

      setIsProcessingTurn(true);
      setStatusText('Nova AI يستمع ويفكر في الرد...');

      try {
        const reader = new FileReader();
        const dataUrl: string = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('تعذر قراءة التسجيل الصوتي'));
          reader.readAsDataURL(blob);
        });
        const base64 = dataUrl.split(',')[1] || '';

        const idToken = await user.getIdToken();
        const res = await fetch('/api/nova/voice-turn', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
            ...getOtpHeaders(),
          },
          body: JSON.stringify({
            audioBase64: base64,
            mimeType: actualMime,
            voiceName,
            customInstruction,
            history: entriesRef.current.slice(-6).map((e) => ({ role: e.role, content: e.text })),
          }),
        });

        const rawText = await res.text();
        if (rawText.trimStart().startsWith('<')) {
          throw new Error('انقطع الاتصال المؤقت بالخادم. يرجى المحاولة مرة أخرى.');
        }

        let data: {
          userTranscript?: string;
          replyText?: string;
          audioBase64?: string | null;
          mimeType?: string | null;
          error?: string;
        };
        try {
          data = JSON.parse(rawText);
        } catch {
          throw new Error('استجابة غير صالحة من الخادم.');
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
        setError(err instanceof Error ? err.message : 'تعذر إرسال الصوت');
        setStatusText('اضغط للتحدث مع Nova AI صوتيًا');
      } finally {
        setIsProcessingTurn(false);
      }
    };

    recorder.start();
    setIsRecordingTurn(true);
    setStatusText('جاري التسجيل... تحدّث الآن ثم اضغط «إيقاف وإرسال»');
  };

  const stopTurnRecording = async () => {
    await unlockAudioContexts();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecordingTurn(false);
    }
  };

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
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">المحادثة الصوتية المباشرة</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {mode === 'live' ? 'بث صوتي ثنائي فوري' : mode === 'connecting' ? 'جاري الاتصال...' : 'محادثة صوتية تفاعلية'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {mode === 'live' && (
              <button
                type="button"
                onClick={() => switchToTurnFallback('التسجيل اليدوي: اضغط للتحدث الآن وسيرد Nova AI بصوته', true)}
                className="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer whitespace-nowrap"
              >
                وضع الضغط للتحدث
              </button>
            )}
            {mode === 'turn-fallback' && supportsLiveWsRef.current && (
              <button
                type="button"
                onClick={() => {
                  startLiveVoiceSession().catch(() => undefined);
                }}
                className="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer whitespace-nowrap"
              >
                الاتصال المباشر
              </button>
            )}
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
              className={`w-28 h-28 rounded-full flex items-center justify-center transition-transform duration-300 ${
                isAiSpeaking ? 'scale-110' : isRecordingTurn ? 'scale-105' : 'scale-100'
              }`}
              style={{
                background: 'radial-gradient(circle, var(--accent-soft), transparent 70%)',
                boxShadow: isAiSpeaking || mode === 'live' ? '0 0 42px var(--accent-glow)' : 'none',
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

            {audioBlocked && (
              <button
                type="button"
                onClick={() => {
                  unlockAudioContexts().catch(() => undefined);
                }}
                className="accent-btn inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-white text-xs font-semibold cursor-pointer"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>اضغط هنا لتفعيل صوت الرد</span>
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
              <span>ابدأ الكلام الآن باللغة العربية وسيتحاور معك Nova AI صوتيًا وكتابيًا.</span>
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
                    {item.role === 'user' ? 'أنت:' : 'Nova AI:'}
                  </span>
                  <span>{item.text}</span>
                </div>
                {item.role === 'assistant' && item.text.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      playReplyAudio(item.audioBase64, item.mimeType, item.text).catch(() => undefined);
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

        {/* Controls Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#070B17] flex items-center justify-between gap-3">
          {mode === 'turn-fallback' ? (
            <button
              type="button"
              disabled={isProcessingTurn}
              onClick={isRecordingTurn ? stopTurnRecording : startTurnRecording}
              className={`flex-1 inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-white text-sm font-semibold cursor-pointer transition-all ${
                isRecordingTurn ? 'bg-rose-600 hover:bg-rose-500' : 'accent-btn'
              } disabled:opacity-50`}
            >
              {isRecordingTurn ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              <span>
                {isProcessingTurn
                  ? 'جاري معالجة صوتك...'
                  : isRecordingTurn
                    ? 'إيقاف وإرسال الصوت'
                    : 'اضغط للتحدث الآن'}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                unlockAudioContexts().catch(() => undefined);
                setIsMuted((prev) => !prev);
              }}
              className={`flex-1 inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold cursor-pointer border transition-colors ${
                isMuted
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-300'
                  : 'bg-white dark:bg-[#101830] border-slate-200 dark:border-white/15 text-slate-900 dark:text-white'
              }`}
            >
              {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />}
              <span>{isMuted ? 'الميكروفون مكتوم' : 'الميكروفون مفتوح'}</span>
            </button>
          )}

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
