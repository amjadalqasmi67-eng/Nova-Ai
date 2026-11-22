import { useState, useEffect, useRef, FormEvent, ChangeEvent } from 'react';
import {
  Send,
  Plus,
  Trash2,
  Paperclip,
  Camera,
  Mic,
  Volume2,
  Square,
  Presentation,
  X,
  MessageSquare,
  Menu,
  Sparkles,
  Brain,
  Zap,
  AlertCircle,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  Share2,
  Check,
  Copy,
  Headphones,
} from 'lucide-react';
import { User } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  where,
  Timestamp,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { CompressedImage, compressImageFile } from '../lib/imageUtils';
import { MarkdownMessage } from './MarkdownMessage';
import { NovaStarLogo } from './NovaStarLogo';
import { CameraCaptureModal } from './CameraCaptureModal';
import { LiveVoiceModal } from './LiveVoiceModal';
import { getOtpHeaders } from '../lib/otpSession';
import { sanitizeUserText } from '../lib/sanitize';

interface Conversation {
  id: string;
  userId: string;
  title: string;
  lastMessagePreview: string;
  createdAtMs: number;
  updatedAtMs: number;
}

interface ChatMessage {
  id: string;
  userId: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  hasAttachment: boolean;
  rating?: 'none' | 'like' | 'dislike';
  createdAtMs: number;
}

interface ChatWorkspaceProps {
  user: User;
  displayName?: string;
  userAvatarUrl?: string | null;
  customInstruction: string;
  draftPrompt?: string | null;
  onConsumeDraftPrompt?: () => void;
  onOpenPresentation?: (topic?: string) => void;
}

const STARTER_PROMPTS = [
  {
    title: 'تخطيط مشروع تقني متكامل',
    prompt: 'ساعدني في وضع خطة عمل مفصلة لإطلاق تطبيق ويب مبتكر من الفكرة حتى الإطلاق خلال 30 يومًا.',
  },
  {
    title: 'كتابة وصياغة احترافية',
    prompt: 'اكتب لي رسالة بريد إلكتروني رسمية ومقنعة باللغة العربية لتقديم مقترح شراكة استراتيجية.',
  },
  {
    title: 'مساعدة برمجية فورية',
    prompt: 'اشرح لي أفضل ممارسات تحسين أداء تطبيقات React و TypeScript مع أمثلة عملية واضحة.',
  },
  {
    title: 'تحليل وتلخيص الأفكار',
    prompt: 'لخّص لي أهم استراتيجيات بناء علامة تجارية شخصية قوية في العالم الرقمي.',
  },
];

export function ChatWorkspace({
  user,
  displayName,
  userAvatarUrl,
  customInstruction,
  draftPrompt,
  onConsumeDraftPrompt,
  onOpenPresentation,
}: ChatWorkspaceProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinkingDepth, setThinkingDepth] = useState<'low' | 'high'>('low');
  const [attachment, setAttachment] = useState<CompressedImage | null>(null);
  const [isLoadingReply, setIsLoadingReply] = useState(false);
  const [streamingReply, setStreamingReply] = useState('');
  const [streamPhase, setStreamPhase] = useState<'generating' | 'thinking' | 'retrying'>('generating');
  const [pendingMessages, setPendingMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasRetryAction, setHasRetryAction] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [loadingTtsId, setLoadingTtsId] = useState<string | null>(null);
  const [autoVoiceRead, setAutoVoiceRead] = useState(false);
  const [sharingMsgId, setSharingMsgId] = useState<string | null>(null);
  const [shareModal, setShareModal] = useState<{ url: string; question: string; copied: boolean } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const firestoreQueueRef = useRef<Promise<void>>(Promise.resolve());
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const autoVoiceReadRef = useRef(false);
  autoVoiceReadRef.current = autoVoiceRead;
  const lastFailedActionRef = useRef<
    | { type: 'send'; text: string; attachment?: CompressedImage; convId: string; userMsgId: string }
    | { type: 'tts'; msgId: string; content: string }
    | null
  >(null);

  useEffect(() => {
    if (draftPrompt) {
      setInput(draftPrompt);
      onConsumeDraftPrompt?.();
      setTimeout(() => textareaRef.current?.focus(), 60);
    }
  }, [draftPrompt, onConsumeDraftPrompt]);

  useEffect(() => {
    const path = `users/${user.uid}/conversations`;
    const q = query(collection(db, path), where('userId', '==', user.uid));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: Conversation[] = snapshot.docs.map((d) => {
          const data = d.data();
          const created = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now();
          const updated = data.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : created;
          return {
            id: d.id,
            userId: String(data.userId || ''),
            title: String(data.title || 'محادثة جديدة'),
            lastMessagePreview: String(data.lastMessagePreview || ''),
            createdAtMs: created,
            updatedAtMs: updated,
          };
        });
        items.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
        setConversations(items);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );

    return () => unsubscribe();
  }, [user.uid]);

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      return;
    }

    const path = `users/${user.uid}/conversations/${activeConversationId}/messages`;
    const q = query(
      collection(db, path),
      where('userId', '==', user.uid),
      where('conversationId', '==', activeConversationId)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: ChatMessage[] = snapshot.docs.map((d) => {
          const data = d.data();
          const created = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now();
          return {
            id: d.id,
            userId: String(data.userId || ''),
            conversationId: String(data.conversationId || ''),
            role: data.role === 'assistant' ? 'assistant' : 'user',
            content: String(data.content || ''),
            hasAttachment: Boolean(data.hasAttachment),
            rating:
              data.rating === 'like' || data.rating === 'dislike'
                ? data.rating
                : ('none' as const),
            createdAtMs: created,
          };
        });
        list.sort((a, b) => a.createdAtMs - b.createdAtMs);
        setMessages(list);
        setPendingMessages((prev) => {
          if (prev.length === 0) return prev;
          const syncedIds = new Set(list.map((m) => m.id));
          const remaining = prev.filter((m) => !syncedIds.has(m.id));
          return remaining.length === prev.length ? prev : remaining;
        });
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );

    return () => unsubscribe();
  }, [user.uid, activeConversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: streamingReply ? 'auto' : 'smooth' });
  }, [messages, pendingMessages, isLoadingReply, streamingReply]);

  useEffect(() => {
    return () => {
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }
    };
  }, []);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('يمكن إرفاق ملفات الصور فقط في المحادثة.');
      return;
    }

    try {
      const compressed = await compressImageFile(file);
      setAttachment(compressed);
      setError(null);
    } catch {
      setError('تعذر تجهيز الصورة. يرجى تجربة صورة أخرى.');
    }
  };

  const handleToggleTts = async (msgId: string, content: string) => {
    if (speakingMsgId === msgId) {
      ttsAudioRef.current?.pause();
      ttsAudioRef.current = null;
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setSpeakingMsgId(null);
      return;
    }

    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
      setSpeakingMsgId(null);
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    const speakWithBrowserFallback = (): boolean => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
      const voices = window.speechSynthesis.getVoices();
      const arabicVoice = voices.find((v) => v.lang.toLowerCase().startsWith('ar'));
      if (!arabicVoice) return false;
      const clean = content
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[*#`>_~[\](){}|\\]/g, ' ')
        .replace(/\bNova AI\b/gi, 'نوفا')
        .replace(/%/g, ' بالمئة ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1500);
      if (!clean) return false;
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.voice = arabicVoice;
      utterance.lang = arabicVoice.lang || 'ar-SA';
      utterance.rate = 0.98;
      utterance.onend = () => setSpeakingMsgId(null);
      utterance.onerror = () => setSpeakingMsgId(null);
      setSpeakingMsgId(msgId);
      window.speechSynthesis.speak(utterance);
      return true;
    };

    setLoadingTtsId(msgId);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/nova/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
          ...getOtpHeaders(),
        },
        body: JSON.stringify({ text: content }),
      });
      const rawText = await res.text();
      if (rawText.trimStart().startsWith('<')) {
        throw new Error('تعذر تشغيل الصوت من الخادم');
      }
      const data = JSON.parse(rawText) as { audioBase64?: string; mimeType?: string; error?: string };
      if (!res.ok || !data.audioBase64 || !data.mimeType) {
        throw new Error(data.error || 'تعذر تشغيل الصوت');
      }
      const audio = new Audio(`data:${data.mimeType};base64,${data.audioBase64}`);
      ttsAudioRef.current = audio;
      setSpeakingMsgId(msgId);
      audio.onended = () => {
        setSpeakingMsgId(null);
        ttsAudioRef.current = null;
      };
      audio.onerror = () => {
        ttsAudioRef.current = null;
        if (!speakWithBrowserFallback()) {
          setSpeakingMsgId(null);
        }
      };
      await audio.play();
    } catch (err) {
      if (!speakWithBrowserFallback()) {
        lastFailedActionRef.current = { type: 'tts', msgId, content };
        setHasRetryAction(true);
        setError(err instanceof Error ? err.message : 'تعذر قراءة الرد صوتيًا.');
      }
    } finally {
      setLoadingTtsId(null);
    }
  };

  const handleAppendVoiceTurns = (turns: Array<{ role: 'user' | 'assistant'; content: string }>) => {
    if (turns.length === 0) return;
    const existingConvId = activeConversationIdRef.current;
    const isNewConv = !existingConvId;
    const convId = existingConvId || crypto.randomUUID();
    if (isNewConv) {
      activeConversationIdRef.current = convId;
    }

    const nowBase = Date.now();
    const mapped: ChatMessage[] = turns.map((t, idx) => ({
      id: crypto.randomUUID(),
      userId: user.uid,
      conversationId: convId,
      role: t.role,
      content: t.content.slice(0, 20000),
      hasAttachment: false,
      createdAtMs: nowBase + idx,
    }));

    setPendingMessages((prev) => [...prev, ...mapped]);

    const firstTitle = turns[0].content.slice(0, 60) || 'محادثة صوتية مع Nova AI';
    const lastPreview = turns[turns.length - 1].content.slice(0, 120);

    firestoreQueueRef.current = firestoreQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const convPath = `users/${user.uid}/conversations/${convId}`;
        if (isNewConv) {
          await setDoc(doc(db, convPath), {
            userId: user.uid,
            title: firstTitle,
            lastMessagePreview: lastPreview,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          if (activeConversationIdRef.current === convId) {
            setActiveConversationId(convId);
          }
        } else {
          await updateDoc(doc(db, convPath), {
            lastMessagePreview: lastPreview,
            updatedAt: serverTimestamp(),
          });
        }

        for (const item of mapped) {
          await setDoc(doc(db, `users/${user.uid}/conversations/${convId}/messages/${item.id}`), {
            userId: user.uid,
            conversationId: convId,
            role: item.role,
            content: item.content,
            hasAttachment: false,
            createdAt: serverTimestamp(),
          });
        }
      })
      .catch((err) => {
        console.error('Failed to persist voice turns:', err);
      });
  };

  const selectConversation = (convId: string | null) => {
    activeConversationIdRef.current = convId;
    setActiveConversationId(convId);
    setPendingMessages([]);
    setError(null);
  };

  const handleRateMessage = (msg: ChatMessage, choice: 'like' | 'dislike') => {
    if (msg.role !== 'assistant' || !msg.conversationId) return;
    const nextRating: 'none' | 'like' | 'dislike' = msg.rating === choice ? 'none' : choice;

    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, rating: nextRating } : m)));
    setPendingMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, rating: nextRating } : m)));

    const msgPath = `users/${user.uid}/conversations/${msg.conversationId}/messages/${msg.id}`;
    firestoreQueueRef.current = firestoreQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await updateDoc(doc(db, msgPath), { rating: nextRating });
      })
      .catch((err) => {
        console.error('Failed to persist rating:', err);
        setError('تعذر حفظ التقييم حاليًا. يرجى المحاولة مجددًا.');
      });
  };

  const handleShareQa = async (assistantMsg: ChatMessage, msgIdx: number) => {
    if (sharingMsgId) return;
    setSharingMsgId(assistantMsg.id);
    setError(null);

    let pairedQuestion = '';
    for (let i = msgIdx - 1; i >= 0; i--) {
      const candidate = displayedMessages[i];
      if (candidate && candidate.role === 'user' && candidate.content.trim()) {
        pairedQuestion = candidate.content.trim();
        break;
      }
    }
    if (!pairedQuestion) {
      pairedQuestion = 'سؤال مشارَك من محادثة Nova AI';
    }

    const shareId = crypto.randomUUID();
    const sharePath = `sharedSnippets/${shareId}`;
    try {
      await setDoc(doc(db, sharePath), {
        ownerUid: user.uid,
        question: pairedQuestion.slice(0, 5000),
        answer: assistantMsg.content.slice(0, 20000),
        createdAt: serverTimestamp(),
      });
      const shareUrl = `${window.location.origin}/?share=${shareId}`;
      let copied = false;
      try {
        await navigator.clipboard.writeText(shareUrl);
        copied = true;
      } catch {
        copied = false;
      }
      setShareModal({ url: shareUrl, question: pairedQuestion.slice(0, 140), copied });
    } catch (err) {
      console.error('Share Q&A error:', err);
      setError('تعذر إنشاء رابط المشاركة حاليًا. يرجى المحاولة مرة أخرى.');
    } finally {
      setSharingMsgId(null);
    }
  };

  const handleDeleteConversation = async (convId: string) => {
    const path = `users/${user.uid}/conversations/${convId}`;
    try {
      await deleteDoc(doc(db, path));
      if (activeConversationIdRef.current === convId || activeConversationId === convId) {
        selectConversation(null);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const sendMessage = async (
    promptText?: string,
    overrideAttachment?: CompressedImage,
    retryTarget?: { convId: string; userMsgId: string }
  ) => {
    if (isLoadingReply) return;
    const currentAttachment = overrideAttachment ?? (retryTarget ? undefined : attachment);
    const rawText = sanitizeUserText(promptText ?? input, 20000);
    const text = rawText || (currentAttachment ? 'حلّل هذه الصورة بالتفصيل واشرح ما يظهر فيها بدقة.' : '');
    if (!text) return;

    lastFailedActionRef.current = null;
    setHasRetryAction(false);
    setError(null);
    if (!promptText && !overrideAttachment && !retryTarget) {
      setInput('');
    }
    if (!overrideAttachment && !retryTarget) {
      setAttachment(null);
    }
    setIsLoadingReply(true);
    setStreamingReply('');
    setStreamPhase(thinkingDepth === 'high' || currentAttachment ? 'thinking' : 'generating');

    const existingConvId = retryTarget?.convId || activeConversationIdRef.current;
    const isNewConversation = !existingConvId;
    const convId = existingConvId || crypto.randomUUID();
    if (isNewConversation) {
      activeConversationIdRef.current = convId;
    }

    const userMsgId = retryTarget?.userMsgId || crypto.randomUUID();
    const userMsgContent = text.slice(0, 20000);

    const combinedPrior = [
      ...messages,
      ...pendingMessages.filter(
        (pm) => pm.conversationId === convId && !messages.some((m) => m.id === pm.id)
      ),
    ];

    const historySnapshot = combinedPrior
      .filter((m) => m.id !== userMsgId)
      .slice(-7)
      .map((m) => ({
        role: m.role,
        content: m.content.slice(0, 2500),
      }));

    if (!retryTarget) {
      setPendingMessages((prev) => [
        ...prev,
        {
          id: userMsgId,
          userId: user.uid,
          conversationId: convId,
          role: 'user',
          content: userMsgContent,
          hasAttachment: Boolean(currentAttachment),
          createdAtMs: Date.now(),
        },
      ]);
    }

    // Queue Firestore writes sequentially in the background so parent doc always precedes child messages
    const userPersistPromise = retryTarget
      ? firestoreQueueRef.current.catch(() => undefined)
      : firestoreQueueRef.current
          .catch(() => undefined)
          .then(async () => {
            const convPath = `users/${user.uid}/conversations/${convId}`;
            if (isNewConversation) {
              await setDoc(doc(db, convPath), {
                userId: user.uid,
                title: text.slice(0, 60),
                lastMessagePreview: text.slice(0, 120),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
              if (activeConversationIdRef.current === convId) {
                setActiveConversationId(convId);
              }
            } else {
              await updateDoc(doc(db, convPath), {
                lastMessagePreview: text.slice(0, 120),
                updatedAt: serverTimestamp(),
              });
            }

            const userMsgPath = `users/${user.uid}/conversations/${convId}/messages/${userMsgId}`;
            await setDoc(doc(db, userMsgPath), {
              userId: user.uid,
              conversationId: convId,
              role: 'user',
              content: userMsgContent,
              hasAttachment: Boolean(currentAttachment),
              createdAt: serverTimestamp(),
            });
          });

    firestoreQueueRef.current = userPersistPromise;

    const persistAssistantInBackground = (replyText: string) => {
      const assistantMsgId = crypto.randomUUID();
      const assistantContent = replyText.slice(0, 20000);

      setPendingMessages((prev) => [
        ...prev,
        {
          id: assistantMsgId,
          userId: user.uid,
          conversationId: convId,
          role: 'assistant',
          content: assistantContent,
          hasAttachment: false,
          createdAtMs: Date.now(),
        },
      ]);

      const assistantPersistPromise = userPersistPromise
        .then(async () => {
          const assistantMsgPath = `users/${user.uid}/conversations/${convId}/messages/${assistantMsgId}`;
          await setDoc(doc(db, assistantMsgPath), {
            userId: user.uid,
            conversationId: convId,
            role: 'assistant',
            content: assistantContent,
            hasAttachment: false,
            createdAt: serverTimestamp(),
          });

          await updateDoc(doc(db, `users/${user.uid}/conversations/${convId}`), {
            lastMessagePreview: replyText.slice(0, 120),
            updatedAt: serverTimestamp(),
          });
        })
        .catch((persistErr) => {
          console.error('Failed to persist assistant reply:', persistErr);
          setError((prev) => prev || 'تم عرض الرد، لكن تعذر حفظه في سجل المحادثات.');
        });

      firestoreQueueRef.current = assistantPersistPromise;

      if (autoVoiceReadRef.current) {
        handleToggleTts(assistantMsgId, assistantContent).catch(() => undefined);
      }
    };

    const controller = new AbortController();
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
    const resetInactivityTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        controller.abort(new Error('INACTIVITY_TIMEOUT'));
      }, 60000);
    };
    const maxTotalTimer = setTimeout(() => {
      controller.abort(new Error('MAX_TOTAL_TIMEOUT'));
    }, 180000);

    try {
      const historyPayload = [
        ...historySnapshot,
        {
          role: 'user' as const,
          content: text,
          ...(currentAttachment
            ? {
                attachment: {
                  data: currentAttachment.data,
                  mimeType: currentAttachment.mimeType,
                },
              }
            : {}),
        },
      ];

      let idToken = await user.getIdToken();
      resetInactivityTimer();

      const performChatFetch = (token: string) =>
        fetch('/api/nova/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...getOtpHeaders(),
          },
          body: JSON.stringify({
            messages: historyPayload,
            customInstruction,
            thinkingDepth,
            stream: true,
          }),
          signal: controller.signal,
        });

      let response = await performChatFetch(idToken);
      if (response.status === 401) {
        idToken = await user.getIdToken(true);
        response = await performChatFetch(idToken);
      }

      const contentType = response.headers.get('content-type') || '';

      if (!response.ok || !contentType.includes('application/x-ndjson') || !response.body) {
        const rawBody = await response.text();
        let data: { reply?: string; text?: string; error?: string } = {};
        if (rawBody) {
          try {
            data = JSON.parse(rawBody) as { reply?: string; text?: string; error?: string };
          } catch {
            throw new Error(`استجابة غير متوقعة من الخادم (HTTP ${response.status}).`);
          }
        }
        if (!response.ok) {
          throw new Error(data.error || `تعذر الحصول على رد من الخادم (رمز الخطأ ${response.status}).`);
        }
        const fallbackReply = (data.reply || data.text || '').trim();
        if (!fallbackReply) {
          throw new Error(data.error || 'لم يرجع النموذج نصًا في الرد. يرجى المحاولة مجددًا.');
        }

        persistAssistantInBackground(fallbackReply);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulated = '';
      let finalReply = '';
      let streamError: string | null = null;

      const processLine = (line: string) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;
        let evt: {
          type?: string;
          phase?: 'generating' | 'thinking' | 'retrying';
          text?: string;
          reply?: string;
          error?: string;
        };
        try {
          evt = JSON.parse(trimmedLine);
        } catch {
          return;
        }

        if (evt.type === 'status' && evt.phase) {
          setStreamPhase(evt.phase);
        } else if (evt.type === 'delta' && typeof evt.text === 'string') {
          accumulated += evt.text;
          setStreamingReply(accumulated);
        } else if (evt.type === 'done' && typeof evt.reply === 'string') {
          finalReply = evt.reply.trim();
          setStreamingReply(finalReply);
        } else if (evt.type === 'error') {
          streamError = evt.error || 'تعذر الحصول على رد من المساعد.';
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        resetInactivityTimer();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          processLine(line);
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        processLine(buffer);
      }

      if (streamError && !finalReply) {
        throw new Error(streamError);
      }

      const replyText = (finalReply || accumulated).trim();
      if (!replyText) {
        throw new Error('لم يرجع النموذج نصًا في الرد. يرجى المحاولة مجددًا.');
      }

      persistAssistantInBackground(replyText);
    } catch (err) {
      await userPersistPromise.catch(() => undefined);
      lastFailedActionRef.current = {
        type: 'send',
        text,
        attachment: currentAttachment ?? undefined,
        convId,
        userMsgId,
      };
      setHasRetryAction(true);
      const errMsg = err instanceof Error ? err.message : '';
      if (
        (err instanceof DOMException && err.name === 'AbortError') ||
        errMsg === 'INACTIVITY_TIMEOUT' ||
        errMsg === 'MAX_TOTAL_TIMEOUT'
      ) {
        setError('استغرق الخادم وقتًا أطول من المعتاد للرد. يرجى المحاولة مرة أخرى.');
      } else {
        setError(errMsg || 'حدث خطأ أثناء الاتصال بالمساعد.');
      }
    } finally {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      clearTimeout(maxTotalTimer);
      setStreamingReply('');
      setIsLoadingReply(false);
    }
  };

  const handleRetryFailed = () => {
    const failed = lastFailedActionRef.current;
    if (!failed) return;
    if (failed.type === 'send') {
      sendMessage(failed.text, failed.attachment, {
        convId: failed.convId,
        userMsgId: failed.userMsgId,
      });
    } else if (failed.type === 'tts') {
      lastFailedActionRef.current = null;
      setHasRetryAction(false);
      setError(null);
      handleToggleTts(failed.msgId, failed.content);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendMessage();
  };

  const firstName = (displayName || user.displayName || '').trim().split(/\s+/)[0] || 'بك';

  const currentTargetConvId = activeConversationIdRef.current;
  const displayedMessages = [
    ...messages,
    ...pendingMessages.filter(
      (pm) =>
        (!currentTargetConvId || pm.conversationId === currentTargetConvId) &&
        !messages.some((m) => m.id === pm.id)
    ),
  ];

  const statusLabel =
    streamPhase === 'retrying'
      ? 'Nova AI يعيد المحاولة لضمان أفضل إجابة...'
      : streamPhase === 'thinking'
        ? 'Nova AI يحلل سؤالك بعمق...'
        : 'Nova AI يكتب الرد...';

  return (
    <div className="flex-1 flex min-h-0 max-w-7xl w-full mx-auto px-2.5 sm:px-6 py-2.5 sm:py-4 gap-4 lg:gap-5">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-72 shrink-0 rounded-2xl bg-white/85 dark:bg-[#0B1020]/85 border border-slate-200 dark:border-white/10 overflow-hidden backdrop-blur-md">
        <div className="p-4 border-b border-slate-200 dark:border-white/10">
          <button
            type="button"
            onClick={() => selectConversation(null)}
            className="accent-btn w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold transition-all cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>محادثة جديدة</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {conversations.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-slate-500 leading-relaxed">
              لا توجد محادثات محفوظة بعد. ابدأ بسؤال Nova AI في المساحة المقابلة.
            </div>
          ) : (
            conversations.map((conv) => {
              const isActive = conv.id === activeConversationId;
              return (
                <div
                  key={conv.id}
                  className={`group flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 transition-colors border ${
                    isActive
                      ? 'accent-active-tab text-slate-900 dark:text-white'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 border-transparent'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => selectConversation(conv.id)}
                    className="flex-1 min-w-0 text-right cursor-pointer"
                  >
                    <div className="text-sm font-medium truncate">{conv.title}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {conv.lastMessagePreview}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteConversation(conv.id)}
                    aria-label="حذف المحادثة"
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-all cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-72 max-w-[85vw] bg-white dark:bg-[#0B1020] border-l border-slate-200 dark:border-white/15 flex flex-col h-full p-4 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-white/10">
              <span className="text-sm font-bold text-slate-900 dark:text-white">سجل المحادثات</span>
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                selectConversation(null);
                setMobileSidebarOpen(false);
              }}
              className="accent-btn mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold"
            >
              <Plus className="w-4 h-4" />
              <span>محادثة جديدة</span>
            </button>
            <div className="flex-1 overflow-y-auto mt-4 space-y-1.5">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 border ${
                    conv.id === activeConversationId
                      ? 'accent-active-tab text-slate-900 dark:text-white'
                      : 'text-slate-700 dark:text-slate-300 border-transparent'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      selectConversation(conv.id);
                      setMobileSidebarOpen(false);
                    }}
                    className="flex-1 min-w-0 text-right"
                  >
                    <div className="text-sm font-medium truncate">{conv.title}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteConversation(conv.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-500"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex-1 bg-black/50" onClick={() => setMobileSidebarOpen(false)} />
        </div>
      )}

      {/* Main Chat Viewport */}
      <section className="flex-1 flex flex-col min-w-0 rounded-2xl bg-white/85 dark:bg-[#0B1020]/80 border border-slate-200 dark:border-white/10 overflow-hidden backdrop-blur-md">
        {/* Sub-bar inside Chat */}
        <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 sm:gap-4 px-3.5 sm:px-5 py-2.5 sm:py-3 border-b border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="سجل المحادثات"
              className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer shrink-0"
            >
              <Menu className="w-4 h-4" />
            </button>
            <MessageSquare className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-primary)' }} />
            <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate">
              {conversations.find((c) => c.id === activeConversationId)?.title || 'محادثة جديدة مع Nova AI'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setVoiceModalOpen(true)}
                className="accent-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                <Mic className="w-3.5 h-3.5" />
                <span>محادثة صوتية</span>
              </button>
              <button
                type="button"
                onClick={() => setAutoVoiceRead((v) => !v)}
                aria-pressed={autoVoiceRead}
                title="تشغيل أو إيقاف القراءة الصوتية التلقائية لردود المساعد"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                  autoVoiceRead
                    ? 'accent-active-tab text-slate-900 dark:text-white'
                    : 'bg-slate-100 dark:bg-[#050814] border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-white/25'
                }`}
              >
                <Headphones className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                <span>{autoVoiceRead ? 'القراءة الصوتية: مفعّلة' : 'وضع القراءة الصوتية'}</span>
              </button>
              {onOpenPresentation && (
                <button
                  type="button"
                  onClick={() => onOpenPresentation()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-[#050814] border border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/25 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer whitespace-nowrap"
                >
                  <Presentation className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                  <span>عرض PowerPoint</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#050814] border border-slate-200 dark:border-white/10 shrink-0">
              <button
                type="button"
                onClick={() => setThinkingDepth('low')}
                className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap border ${
                  thinkingDepth === 'low'
                    ? 'accent-active-tab text-slate-900 dark:text-white'
                    : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>استجابة سريعة</span>
              </button>
              <button
                type="button"
                onClick={() => setThinkingDepth('high')}
                className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap border ${
                  thinkingDepth === 'high'
                    ? 'accent-active-tab text-slate-900 dark:text-white'
                    : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Brain className="w-3.5 h-3.5" />
                <span>تحليل عميق</span>
              </button>
            </div>
          </div>
        </div>

        {/* Messages Stream */}
        <div className="flex-1 overflow-y-auto px-3.5 sm:px-8 py-4 sm:py-6 space-y-5 sm:space-y-6">
          {displayedMessages.length === 0 && !isLoadingReply ? (
            <div className="h-full flex flex-col items-center justify-center max-w-2xl mx-auto text-center py-8">
              <div className="mb-6">
                <NovaStarLogo size="lg" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mb-2">
                مرحبًا {firstName}، كيف أساعدك اليوم؟
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md leading-relaxed mb-8">
                اكتب طلبك بالعربية أو أرفق صورة لتحليلها، وسيرد عليك Nova AI فورًا بوضوح ودقة.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-right">
                {STARTER_PROMPTS.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => sendMessage(item.prompt)}
                    className="p-4 rounded-xl bg-slate-50 dark:bg-[#070B18] border border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/25 hover:bg-slate-100 dark:hover:bg-[#0D142B] transition-all text-right cursor-pointer group"
                  >
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
                      <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent-primary)' }} />
                      <span>{item.title}</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed">
                      {item.prompt}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6">
              {displayedMessages.map((msg, msgIdx) => (
                <div key={msg.id} className="flex gap-2.5 sm:gap-3.5 justify-start">
                  {msg.role === 'assistant' ? (
                    <div className="mt-1 shrink-0">
                      <NovaStarLogo size="sm" />
                    </div>
                  ) : userAvatarUrl ? (
                    <img
                      src={userAvatarUrl}
                      alt={firstName}
                      referrerPolicy="no-referrer"
                      className="w-8 h-8 sm:w-9 sm:h-9 rounded-full object-cover shrink-0 mt-1 border border-slate-300 dark:border-white/20"
                    />
                  ) : (
                    <div className="accent-btn w-8 h-8 sm:w-9 sm:h-9 rounded-full text-white flex items-center justify-center text-xs font-bold shrink-0 mt-1">
                      {firstName.slice(0, 1)}
                    </div>
                  )}

                  <div
                    className={`flex-1 min-w-0 overflow-hidden rounded-2xl px-3.5 py-3 sm:px-5 sm:py-4 border ${
                      msg.role === 'user'
                        ? 'bg-slate-100/90 dark:bg-[#121A33] border-slate-200 dark:border-blue-500/20 text-slate-900 dark:text-slate-100'
                        : 'bg-white dark:bg-[#070B18]/90 border-slate-200 dark:border-white/10 text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {msg.role === 'user' ? 'أنت' : 'Nova AI'}
                        </span>
                        {msg.hasAttachment && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span style={{ color: 'var(--accent-text)' }}>مرفق صورة</span>
                          </>
                        )}
                      </div>

                      {msg.role === 'assistant' && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleToggleTts(msg.id, msg.content)}
                            disabled={loadingTtsId === msg.id}
                            aria-label={speakingMsgId === msg.id ? 'إيقاف القراءة الصوتية' : 'قراءة الرد بصوت عالٍ'}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-[11px] font-medium cursor-pointer transition-colors"
                          >
                            {speakingMsgId === msg.id ? (
                              <>
                                <Square className="w-3 h-3 text-rose-500" />
                                <span>إيقاف</span>
                              </>
                            ) : (
                              <>
                                <Volume2 className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                                <span>{loadingTtsId === msg.id ? 'جاري التحميل...' : 'قراءة صوتية'}</span>
                              </>
                            )}
                          </button>
                          {onOpenPresentation && (
                            <button
                              type="button"
                              onClick={() => onOpenPresentation(msg.content.slice(0, 120))}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-[11px] font-medium cursor-pointer transition-colors"
                            >
                              <Presentation className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                              <span className="hidden sm:inline">PowerPoint</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="nova-themed-text">
                      {msg.role === 'assistant' ? (
                        <MarkdownMessage content={msg.content} />
                      ) : (
                        <p className="text-sm sm:text-[15px] leading-[1.75] whitespace-pre-wrap break-words">{msg.content}</p>
                      )}
                    </div>

                    {msg.role === 'assistant' && (
                      <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleRateMessage(msg, 'like')}
                            aria-pressed={msg.rating === 'like'}
                            aria-label="إعجاب بالرد"
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer transition-colors ${
                              msg.rating === 'like'
                                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 font-semibold'
                                : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
                            }`}
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                            <span>إعجاب</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRateMessage(msg, 'dislike')}
                            aria-pressed={msg.rating === 'dislike'}
                            aria-label="عدم إعجاب بالرد"
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer transition-colors ${
                              msg.rating === 'dislike'
                                ? 'bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-rose-300 font-semibold'
                                : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
                            }`}
                          >
                            <ThumbsDown className="w-3.5 h-3.5" />
                            <span>عدم إعجاب</span>
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleShareQa(msg, msgIdx)}
                          disabled={sharingMsgId === msg.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-[11px] font-medium text-slate-700 dark:text-slate-200 cursor-pointer transition-colors disabled:opacity-50"
                        >
                          <Share2 className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                          <span>{sharingMsgId === msg.id ? 'جاري التجهيز...' : 'مشاركة السؤال والجواب'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isLoadingReply && (
                <div className="flex gap-2.5 sm:gap-3.5">
                  <div className="mt-1 shrink-0">
                    <NovaStarLogo size="sm" />
                  </div>
                  <div className="flex-1 min-w-0 overflow-hidden rounded-2xl px-3.5 py-3 sm:px-5 sm:py-4 bg-white dark:bg-[#070B18]/90 border border-slate-200 dark:border-white/15">
                    <div className="flex items-center gap-2 text-xs font-semibold mb-2" style={{ color: 'var(--accent-text)' }}>
                      <span>{streamingReply ? 'Nova AI' : statusLabel}</span>
                    </div>
                    {streamingReply ? (
                      <MarkdownMessage content={streamingReply} />
                    ) : (
                      <div className="flex items-center gap-2 py-1.5">
                        <span
                          className="w-2 h-2 rounded-full animate-bounce"
                          style={{ backgroundColor: 'var(--accent-primary)' }}
                        />
                        <span
                          className="w-2 h-2 rounded-full animate-bounce [animation-delay:120ms]"
                          style={{ backgroundColor: 'var(--accent-secondary)' }}
                        />
                        <span
                          className="w-2 h-2 rounded-full animate-bounce [animation-delay:240ms]"
                          style={{ backgroundColor: 'var(--accent-primary)' }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Clear, Visible Error Alert */}
        {/* Clear, Visible Error Alert with Retry */}
        {error && (
          <div
            role="alert"
            className="mx-3.5 sm:mx-5 mb-3 rounded-xl bg-rose-500/10 border border-rose-500/35 px-4 py-3 text-xs sm:text-sm text-rose-700 dark:text-rose-200 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex items-start gap-2.5 leading-relaxed min-w-0">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {hasRetryAction && (
                <button
                  type="button"
                  onClick={handleRetryFailed}
                  disabled={isLoadingReply}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>إعادة المحاولة</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  lastFailedActionRef.current = null;
                  setHasRetryAction(false);
                  setError(null);
                }}
                aria-label="إغلاق التنبيه"
                className="p-1 text-rose-500 hover:text-rose-700 dark:hover:text-white shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Composer */}
        <form
          onSubmit={handleSubmit}
          className="p-3 sm:p-4 border-t border-slate-200 dark:border-white/10 bg-slate-50/90 dark:bg-[#080D1B]"
        >
          {attachment && (
            <div className="mb-3 inline-flex items-center gap-3 p-2 rounded-xl bg-white dark:bg-[#0F172E] border border-slate-200 dark:border-white/15 max-w-full">
              <img
                src={attachment.previewUrl}
                alt="معاينة الصورة المرفقة"
                className="w-12 h-12 rounded-lg object-cover shrink-0"
              />
              <span className="text-xs text-slate-700 dark:text-slate-300 truncate">صورة مرفقة للتحليل</span>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                aria-label="إزالة الصورة"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-1.5 sm:gap-2.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => setCameraModalOpen(true)}
              disabled={isLoadingReply}
              aria-label="التصوير بالكاميرا"
              title="التصوير بالكاميرا والتحليل"
              className="min-w-[44px] min-h-[44px] p-3 rounded-xl bg-white dark:bg-[#0E152B] border border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/25 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors shrink-0 cursor-pointer flex items-center justify-center"
            >
              <Camera className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoadingReply}
              aria-label="إرفاق صورة"
              title="إرفاق صورة من الجهاز"
              className="min-w-[44px] min-h-[44px] p-3 rounded-xl bg-white dark:bg-[#0E152B] border border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/25 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors shrink-0 cursor-pointer flex items-center justify-center"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setVoiceModalOpen(true)}
              disabled={isLoadingReply}
              aria-label="التحدث صوتيًا"
              title="محادثة صوتية مباشرة"
              className="min-w-[44px] min-h-[44px] p-3 rounded-xl bg-white dark:bg-[#0E152B] border border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/25 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors shrink-0 cursor-pointer flex items-center justify-center"
            >
              <Mic className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            </button>

            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="اكتب طلبك أو التقط صورة أو تحدّث صوتيًا..."
              className="accent-focus flex-1 min-w-0 min-h-[44px] max-h-36 rounded-xl bg-white dark:bg-[#0E152B] border border-slate-200 dark:border-white/15 focus:outline-none px-3.5 sm:px-4 py-2.5 sm:py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 resize-none"
            />

            <button
              type="submit"
              disabled={isLoadingReply || (!input.trim() && !attachment)}
              className="accent-btn inline-flex items-center justify-center gap-1.5 sm:gap-2 min-h-[44px] px-3.5 sm:px-5 py-2.5 sm:py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-semibold transition-all shrink-0 cursor-pointer"
            >
              <span>إرسال</span>
              <Send className="w-4 h-4 rotate-180" />
            </button>
          </div>
        </form>
      </section>

      {cameraModalOpen && (
        <CameraCaptureModal
          onClose={() => setCameraModalOpen(false)}
          onAttach={(img) => {
            setAttachment(img);
            setError(null);
            setTimeout(() => textareaRef.current?.focus(), 60);
          }}
          onAnalyzeNow={(img) => {
            sendMessage('حلّل هذه الصورة بالتفصيل واشرح ما يظهر فيها بدقة.', img);
          }}
        />
      )}

      {voiceModalOpen && (
        <LiveVoiceModal
          user={user}
          customInstruction={customInstruction}
          onClose={() => setVoiceModalOpen(false)}
          onAppendTurns={handleAppendVoiceTurns}
        />
      )}

      {shareModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#0B1020] border border-slate-200 dark:border-white/15 p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
                <Share2 className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
                <span>رابط مشاركة السؤال والجواب</span>
              </div>
              <button
                type="button"
                onClick={() => setShareModal(null)}
                aria-label="إغلاق"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              هذا الرابط يتيح لمن تشاركه معه قراءة هذا السؤال وهذه الإجابة فقط، دون كشف بريدك الإلكتروني أو بقية محادثاتك وحسابك.
            </p>

            <div className="rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 p-3 text-xs text-slate-700 dark:text-slate-300 line-clamp-2">
              {shareModal.question}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                dir="ltr"
                value={shareModal.url}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15 px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-200"
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(shareModal.url);
                    setShareModal((prev) => (prev ? { ...prev, copied: true } : prev));
                  } catch {
                    // user can copy directly from selected input
                  }
                }}
                className="accent-btn inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-white text-xs font-semibold cursor-pointer shrink-0"
              >
                {shareModal.copied ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>تم النسخ</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>نسخ</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
