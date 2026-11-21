import { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import { Mic, MicOff, PhoneOff, Volume2, Radio, MessageSquarePlus, Sparkles } from 'lucide-react';
import { NovaStarLogo } from './NovaStarLogo';
import { getOtpSessionToken, getOtpHeaders } from '../lib/otpSession';

interface VoiceTurnEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
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
    const newLength = Math.max(1, Math.round(input.length / ratio));
    samples = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const idx = Math.min(input.length - 1, Math.floor(i * ratio));
      samples[i] = input[idx];
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

function base64ToFloat32From24kPCM(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

export function LiveVoiceModal({ user, customInstruction, onClose, onAppendTurns }: LiveVoiceModalProps) {
  const [voiceName, setVoiceName] = useState<VoiceName>('Kore');
  const [mode, setMode] = useState<'connecting' | 'live' | 'turn-fallback'>('connecting');
  const [statusText, setStatusText] = useState('جاري فتح خط المحادثة الصوتية المباشرة...');
  const [isMuted, setIsMuted] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isRecordingTurn, setIsRecordingTurn] = useState(false);
  const [isProcessingTurn, setIsProcessingTurn] = useState(false);
  const [entries, setEntries] = useState<VoiceTurnEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isMutedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const currentUserBufferRef = useRef('');
  const currentAiBufferRef = useRef('');
  const entriesRef = useRef<VoiceTurnEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    entriesRef.current = entries;
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  const stopPlaybackQueue = () => {
    activeSourcesRef.current.forEach((src) => {
      try {
        src.stop();
      } catch {
        // ignore
      }
    });
    activeSourcesRef.current.clear();
    if (outputAudioCtxRef.current) {
      nextStartTimeRef.current = outputAudioCtxRef.current.currentTime;
    }
    setIsAiSpeaking(false);
  };

  const cleanupAllAudio = () => {
    stopPlaybackQueue();
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // ignore
      }
      processorRef.current = null;
    }
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
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
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

  const play24kChunk = (base64Audio: string) => {
    const ctx = outputAudioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => undefined);
    }

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

  useEffect(() => {
    let cancelled = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const initLiveVoice = async () => {
      cleanupAllAudio();
      setMode('connecting');
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
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaStreamRef.current = stream;

        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const inputCtx = new AudioCtx({ sampleRate: 16000 });
        const outputCtx = new AudioCtx({ sampleRate: 24000 });
        inputAudioCtxRef.current = inputCtx;
        outputAudioCtxRef.current = outputCtx;
        nextStartTimeRef.current = outputCtx.currentTime;

        const idToken = await user.getIdToken();
        if (cancelled) return;

        const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProto}//${window.location.host}/api/nova/live`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled || ws.readyState !== WebSocket.OPEN) return;
          ws.send(
            JSON.stringify({
              type: 'auth',
              token: idToken,
              otpToken: getOtpSessionToken() || '',
              voice: voiceName,
              instruction: customInstruction.slice(0, 400),
            })
          );
        };

        let openedSuccessfully = false;
        fallbackTimer = setTimeout(() => {
          if (!openedSuccessfully && !cancelled) {
            try {
              ws.close();
            } catch {
              // ignore
            }
            setMode('turn-fallback');
            setStatusText('اضغط مطولًا أو انقر للتحدث مع Nova AI صوتيًا');
          }
        }, 6500);

        ws.onmessage = (event) => {
          if (cancelled) return;
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
              if (fallbackTimer) clearTimeout(fallbackTimer);
              setMode('live');
              setStatusText('أنا أستمع إليك الآن... تكلّم بحرية وسأرد عليك صوتيًا!');

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
              // Connect through zero-gain node to prevent local mic echo
              const silentGain = inputCtx.createGain();
              silentGain.gain.value = 0;
              processor.connect(silentGain);
              silentGain.connect(inputCtx.destination);
            } else if (msg.audio) {
              play24kChunk(msg.audio);
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
              if (!openedSuccessfully) {
                setMode('turn-fallback');
                setStatusText('اضغط للتحدث مع Nova AI صوتيًا');
              } else {
                setError(msg.error);
              }
            }
          } catch {
            // ignore
          }
        };

        ws.onerror = () => {
          if (!openedSuccessfully && !cancelled) {
            if (fallbackTimer) clearTimeout(fallbackTimer);
            setMode('turn-fallback');
            setStatusText('اضغط للتحدث مع Nova AI صوتيًا');
          }
        };

        ws.onclose = () => {
          if (!openedSuccessfully && !cancelled) {
            if (fallbackTimer) clearTimeout(fallbackTimer);
            setMode('turn-fallback');
            setStatusText('اضغط للتحدث مع Nova AI صوتيًا');
          }
        };
      } catch {
        if (!cancelled) {
          setError('يرجى السماح بالوصول إلى الميكروفون للتحدث مع Nova AI.');
          setMode('turn-fallback');
          setStatusText('الميكروفون غير متاح أو يحتاج إذنًا');
        }
      }
    };

    initLiveVoice();

    return () => {
      cancelled = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      cleanupAllAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceName]);

  const startTurnRecording = () => {
    if (!mediaStreamRef.current || isRecordingTurn || isProcessingTurn) return;
    setError(null);
    recordedChunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
    const recorder = new MediaRecorder(mediaStreamRef.current, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
    };

    recorder.onstop = async () => {
      const blob = new Blob(recordedChunksRef.current, { type: mimeType });
      if (blob.size < 400) return;

      setIsProcessingTurn(true);
      setStatusText('Nova AI يستمع ويفكر في الرد...');

      try {
        const reader = new FileReader();
        const dataUrl: string = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('تعذر قراءة الصوت'));
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
            mimeType,
            voiceName,
            customInstruction,
            history: entriesRef.current.slice(-6).map((e) => ({ role: e.role, content: e.text })),
          }),
        });

        const data = (await res.json()) as {
          userTranscript?: string;
          replyText?: string;
          audioBase64?: string | null;
          mimeType?: string | null;
          error?: string;
        };

        if (!res.ok || !data.replyText) {
          throw new Error(data.error || 'تعذر معالجة الصوت');
        }

        const newTurns: VoiceTurnEntry[] = [];
        if (data.userTranscript) {
          newTurns.push({ id: `u-${Date.now()}`, role: 'user', text: data.userTranscript });
        }
        newTurns.push({ id: `a-${Date.now()}`, role: 'assistant', text: data.replyText });
        setEntries((prev) => [...prev, ...newTurns]);

        if (data.audioBase64 && data.mimeType) {
          setIsAiSpeaking(true);
          setStatusText('Nova AI يتحدث...');
          const audio = new Audio(`data:${data.mimeType};base64,${data.audioBase64}`);
          audio.onended = () => {
            setIsAiSpeaking(false);
            setStatusText('اضغط للتحدث مجددًا مع Nova AI');
          };
          audio.onerror = () => {
            setIsAiSpeaking(false);
            setStatusText('اضغط للتحدث مجددًا مع Nova AI');
          };
          await audio.play().catch(() => {
            setIsAiSpeaking(false);
          });
        } else {
          setStatusText('اضغط للتحدث مجددًا مع Nova AI');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'تعذر إرسال الصوت');
        setStatusText('اضغط للتحدث مع Nova AI صوتيًا');
      } finally {
        setIsProcessingTurn(false);
      }
    };

    recorder.start();
    setIsRecordingTurn(true);
    setStatusText('جاري التسجيل... تحدّث الآن ثم اضغط إيقاف');
  };

  const stopTurnRecording = () => {
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

          <div className="space-y-1">
            <div className="text-sm font-semibold text-slate-900 dark:text-white flex items-center justify-center gap-2">
              {isAiSpeaking && <Volume2 className="w-4 h-4 animate-pulse" style={{ color: 'var(--accent-primary)' }} />}
              <span>{statusText}</span>
            </div>
            {error && <p className="text-xs text-rose-500">{error}</p>}
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
                className={`rounded-xl px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed ${
                  item.role === 'user'
                    ? 'bg-slate-100 dark:bg-[#121A33] text-slate-900 dark:text-slate-100'
                    : 'bg-white dark:bg-[#070B18] border border-slate-200 dark:border-white/10 text-slate-800 dark:text-slate-200'
                }`}
              >
                <span className="font-bold ml-1.5" style={{ color: 'var(--accent-text)' }}>
                  {item.role === 'user' ? 'أنت:' : 'Nova AI:'}
                </span>
                <span>{item.text}</span>
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
              onClick={() => setIsMuted((prev) => !prev)}
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
