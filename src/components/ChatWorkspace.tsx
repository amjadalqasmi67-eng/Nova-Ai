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
  FileText,
  Upload,
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
import { InteractiveSlideWhiteboard } from './InteractiveSlideWhiteboard';
import { ChatToolOutputCard } from './ChatToolOutputCard';
import { getOtpHeaders } from '../lib/otpSession';
import { postNdjsonOrJson } from '../lib/ndjsonFetch';
import { sanitizeUserText } from '../lib/sanitize';
import { primeOutputAudioContext } from '../lib/audioUnlock';
import { createVoiceReader, VoiceReaderController } from '../lib/voiceReader';
import { PptxDeck, PptxSlideData } from '../lib/pptxBuilder';
import { saveStudyHistoryEntry } from '../lib/studyHistory';
import {
  ChatGeneratedExam,
  ChatLessonSummary,
  ChatFlashcardsResult,
  encodeChatToolMessage,
  parseChatToolMessage,
  formatToolMessageReadableText,
} from '../lib/chatToolPayload';

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

interface ActiveToolRun {
  tool: 'create_presentation' | 'create_exam' | 'summarize_lesson' | 'create_flashcards';
  statusText: string;
  pptxTitle?: string;
  pptxSubtitle?: string;
  pptxSlides?: PptxSlideData[];
  pptxTotalExpected?: number;
  replayNonce?: number;
}

type ChatAttachment =
  | (CompressedImage & { kind: 'image'; fileName?: string })
  | {
      kind: 'pdf';
      data: string;
      mimeType: 'application/pdf';
      fileName: string;
      fileSizeLabel: string;
    }
  | {
      kind: 'text';
      mimeType: string;
      fileName: string;
      fileSizeLabel: string;
      textContent: string;
    };

function formatFileSizeKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const STARTER_PROMPTS = [
  {
    title: 'إنشاء عرض تقديمي جاهز',
    prompt: 'أنشئ عرضًا تقديميًا من 6 شرائح عن الذكاء الاصطناعي في التعليم مع أهم التطبيقات والنتائج.',
  },
  {
    title: 'إنشاء اختبار مدرسي',
    prompt: 'أنشئ لي اختبارًا من 5 أسئلة في الأحياء للصف العاشر عن درس الخلية والانقسام الخلوي.',
  },
  {
    title: 'تلخيص درس بنقاط واضحة',
    prompt: 'لخّص لي درس البناء الضوئي في نقاط واضحة مع أهم المصطلحات.',
  },
  {
    title: 'بطاقات مراجعة للمذاكرة',
    prompt: 'اصنع لي 6 بطاقات مراجعة تفاعلية (سؤال وجواب) عن قوانين نيوتن للحركة.',
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
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [isLoadingReply, setIsLoadingReply] = useState(false);
  const [streamingReply, setStreamingReply] = useState('');
  const [streamPhase, setStreamPhase] = useState<'generating' | 'thinking' | 'retrying'>('generating');
  const [activeToolRun, setActiveToolRun] = useState<ActiveToolRun | null>(null);
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
  const attachMenuRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const firestoreQueueRef = useRef<Promise<void>>(Promise.resolve());
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceReaderRef = useRef<VoiceReaderController | null>(null);
  const autoVoiceReadRef = useRef(false);
  autoVoiceReadRef.current = autoVoiceRead;
  const lastFailedActionRef = useRef<
    | { type: 'send'; text: string; attachment?: ChatAttachment; convId: string; userMsgId: string }
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
    messagesEndRef.current?.scrollIntoView({ behavior: streamingReply || activeToolRun ? 'auto' : 'smooth' });
  }, [messages, pendingMessages, isLoadingReply, streamingReply, activeToolRun]);

  useEffect(() => {
    return () => {
      voiceReaderRef.current?.stop();
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const handleOutside = (e: PointerEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAttachMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [attachMenuOpen]);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setAttachMenuOpen(false);
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf');
    const isTextLike =
      file.type.startsWith('text/') ||
      file.type === 'application/json' ||
      file.type === 'application/xml' ||
      /\.(txt|md|markdown|csv|json|html|htm|xml|js|jsx|ts|tsx|py|java|c|cpp|h|css|sql|yml|yaml|log)$/i.test(
        lowerName
      );

    if (isImage) {
      try {
        const compressed = await compressImageFile(file);
        setAttachment({ ...compressed, kind: 'image', fileName: file.name });
        setError(null);
      } catch {
        setError('تعذر تجهيز الصورة. يرجى تجربة صورة أخرى.');
      }
      return;
    }

    if (isPdf) {
      if (file.size > 4 * 1024 * 1024) {
        setError('حجم ملف PDF كبير جدًا. الحد الأقصى المسموح هو 4 ميجابايت.');
        return;
      }
      try {
        const buf = await file.arrayBuffer();
        const base64 = arrayBufferToBase64(buf);
        setAttachment({
          kind: 'pdf',
          data: base64,
          mimeType: 'application/pdf',
          fileName: file.name,
          fileSizeLabel: formatFileSizeKb(file.size),
        });
        setError(null);
      } catch {
        setError('تعذر قراءة ملف PDF. يرجى المحاولة بملف آخر.');
      }
      return;
    }

    if (isTextLike) {
      if (file.size > 512 * 1024) {
        setError('حجم الملف النصي كبير جدًا. الحد الأقصى المسموح هو 512 كيلوبايت.');
        return;
      }
      try {
        const rawText = await file.text();
        const cleanBody = sanitizeUserText(rawText, 75000);
        if (!cleanBody.trim()) {
          setError('الملف المرفق فارغ ولا يحتوي على نص مقروء.');
          return;
        }
        setAttachment({
          kind: 'text',
          mimeType: file.type || 'text/plain',
          fileName: file.name,
          fileSizeLabel: formatFileSizeKb(file.size),
          textContent: cleanBody,
        });
        setError(null);
      } catch {
        setError('تعذر قراءة الملف النصي. يرجى تجربة ملف آخر.');
      }
      return;
    }

    setError('صيغة الملف غير مدعومة للتحليل المباشر. يرجى اختيار صورة أو PDF أو ملف نصي.');
  };

  const handleToggleTts = async (msgId: string, content: string) => {
    if (!voiceReaderRef.current) {
      voiceReaderRef.current = createVoiceReader();
    }
    await voiceReaderRef.current.speak(msgId, content, user, {
      onLoadingChange: setLoadingTtsId,
      onSpeakingChange: setSpeakingMsgId,
      onError: (msg) => {
        lastFailedActionRef.current = { type: 'tts', msgId, content };
        setHasRetryAction(true);
        setError(msg);
      },
    });
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

    const readableAnswer = formatToolMessageReadableText(assistantMsg.content);
    const shareId = crypto.randomUUID();
    const sharePath = `sharedSnippets/${shareId}`;
    try {
      await setDoc(doc(db, sharePath), {
        ownerUid: user.uid,
        question: pairedQuestion.slice(0, 5000),
        answer: readableAnswer.slice(0, 20000),
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
    overrideAttachment?: ChatAttachment,
    retryTarget?: { convId: string; userMsgId: string }
  ) => {
    if (isLoadingReply) return;
    const currentAttachment = overrideAttachment ?? (retryTarget ? undefined : attachment);
    const rawText = sanitizeUserText(promptText ?? input, 20000);
    const defaultAttachmentPrompt = currentAttachment
      ? currentAttachment.kind === 'image'
        ? 'حلّل هذه الصورة بالتفصيل واشرح ما يظهر فيها بدقة.'
        : `حلّل الملف المرفق (${currentAttachment.fileName}) بالتفصيل واشرح محتواه بدقة.`
      : '';
    const text = rawText || defaultAttachmentPrompt;
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
        content: formatToolMessageReadableText(m.content).slice(0, 2500),
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

    const persistAssistantInBackground = (replyText: string, customPreview?: string) => {
      const assistantMsgId = crypto.randomUUID();
      const assistantContent = replyText.slice(0, 20000);
      const readablePreview = (customPreview || formatToolMessageReadableText(assistantContent)).slice(0, 120);

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
            lastMessagePreview: readablePreview,
            updatedAt: serverTimestamp(),
          });
        })
        .catch((persistErr) => {
          console.error('Failed to persist assistant reply:', persistErr);
          setError((prev) => prev || 'تم عرض الرد، لكن تعذر حفظه في سجل المحادثات.');
        });

      firestoreQueueRef.current = assistantPersistPromise;

      if (autoVoiceReadRef.current) {
        const spokenText = formatToolMessageReadableText(assistantContent);
        if (spokenText) {
          handleToggleTts(assistantMsgId, spokenText).catch(() => undefined);
        }
      }
    };

    const executeInChatTool = async (
      intent: { tool: ActiveToolRun['tool']; params: Record<string, unknown>; intro?: string },
      initialToken: string
    ) => {
      const runWithToken = async () => {
        let token = initialToken;
        const makeHeaders = (t: string) => ({
          Authorization: `Bearer ${t}`,
          ...getOtpHeaders(),
        });

        if (intent.tool === 'create_presentation') {
          const topic = String(intent.params.topic || '').trim() || text;
          const details = String(intent.params.details || '').trim();
          const slideCount = Math.min(12, Math.max(3, Number(intent.params.slideCount) || 6));
          const audience = String(intent.params.audience || 'عام').trim();
          const language: 'ar' | 'en' = intent.params.language === 'en' ? 'en' : 'ar';

          setActiveToolRun({
            tool: 'create_presentation',
            statusText: `جاري تصميم العرض التقديمي «${topic}» (${slideCount} شرائح)...`,
            pptxTitle: topic,
            pptxSlides: [],
            pptxTotalExpected: slideCount,
            replayNonce: Date.now(),
          });

          const pushSlide = (offset: number, idx: number, slide: PptxSlideData) => {
            setActiveToolRun((prev) => {
              if (!prev) return prev;
              const nextSlides = [...(prev.pptxSlides || [])];
              nextSlides[offset + idx] = slide;
              return { ...prev, pptxSlides: nextSlides };
            });
          };

          let finalDeck: PptxDeck;
          if (slideCount > 8) {
            const firstCount = Math.ceil(slideCount / 2);
            const secondCount = slideCount - firstCount;
            const part1 = await postNdjsonOrJson<PptxDeck>('/api/nova/generate-pptx', {
              headers: makeHeaders(token),
              body: { topic, details, slideCount: firstCount, audience, language, batchIndex: 1, totalBatches: 2 },
              onStatus: (msg) =>
                setActiveToolRun((prev) => (prev ? { ...prev, statusText: `الجزء 1/2: ${msg}` } : prev)),
              onEvent: (ev) => {
                if (ev.type === 'meta' && ev.deckTitle) {
                  setActiveToolRun((prev) =>
                    prev ? { ...prev, pptxTitle: ev.deckTitle, pptxSubtitle: ev.deckSubtitle || prev.pptxSubtitle } : prev
                  );
                } else if (ev.type === 'slide' && typeof ev.index === 'number' && ev.slide) {
                  pushSlide(0, ev.index, ev.slide as PptxSlideData);
                }
              },
            });
            token = await user.getIdToken();
            const batch2Offset = Array.isArray(part1.slides) ? part1.slides.length : firstCount;
            const part2 = await postNdjsonOrJson<PptxDeck>('/api/nova/generate-pptx', {
              headers: makeHeaders(token),
              body: {
                topic,
                details,
                slideCount: secondCount,
                audience,
                language,
                batchIndex: 2,
                totalBatches: 2,
                targetDeckTitle: part1.deckTitle || topic,
                existingSlideTitles: (part1.slides || []).map((s) => s.title).slice(0, 12),
              },
              onStatus: (msg) =>
                setActiveToolRun((prev) => (prev ? { ...prev, statusText: `الجزء 2/2: ${msg}` } : prev)),
              onEvent: (ev) => {
                if (ev.type === 'slide' && typeof ev.index === 'number' && ev.slide) {
                  pushSlide(batch2Offset, ev.index, ev.slide as PptxSlideData);
                }
              },
            });
            finalDeck = {
              deckTitle: part1.deckTitle || topic,
              deckSubtitle: part1.deckSubtitle || part2.deckSubtitle || '',
              slides: [...(part1.slides || []), ...(part2.slides || [])],
              language,
            };
          } else {
            const data = await postNdjsonOrJson<PptxDeck>('/api/nova/generate-pptx', {
              headers: makeHeaders(token),
              body: { topic, details, slideCount, audience, language },
              onStatus: (msg) => setActiveToolRun((prev) => (prev ? { ...prev, statusText: msg } : prev)),
              onEvent: (ev) => {
                if (ev.type === 'meta' && ev.deckTitle) {
                  setActiveToolRun((prev) =>
                    prev ? { ...prev, pptxTitle: ev.deckTitle, pptxSubtitle: ev.deckSubtitle || prev.pptxSubtitle } : prev
                  );
                } else if (ev.type === 'slide' && typeof ev.index === 'number' && ev.slide) {
                  pushSlide(0, ev.index, ev.slide as PptxSlideData);
                }
              },
            });
            finalDeck = {
              deckTitle: data.deckTitle || topic,
              deckSubtitle: data.deckSubtitle || '',
              slides: data.slides || [],
              language,
            };
          }

          if (!finalDeck.slides.length) {
            throw new Error('تعذر إنشاء شرائح العرض التقديمي حاليًا.');
          }

          const introText =
            intent.intro ||
            `تم تصميم العرض التقديمي «${finalDeck.deckTitle}» (${finalDeck.slides.length} شرائح). يمكنك معاينته أدناه أو تنزيله بصيغة PowerPoint وPDF.`;
          const encoded = encodeChatToolMessage(introText, {
            tool: 'presentation',
            deck: finalDeck,
            visualTheme: 'cosmos',
            language,
          });
          persistAssistantInBackground(encoded, `عرض تقديمي: ${finalDeck.deckTitle}`);
          return;
        }

        if (intent.tool === 'create_exam') {
          const subjectGrade = String(intent.params.subjectGrade || '').trim();
          const lessonOrPages = String(intent.params.lessonOrPages || '').trim();
          const curriculum = String(intent.params.curriculum || 'المناهج العُمانية (المكتبة الإلكترونية)');
          const rawLessonContent = String(intent.params.lessonContent || '').trim();
          const lessonContent =
            rawLessonContent ||
            (currentAttachment?.kind === 'text' ? currentAttachment.textContent.slice(0, 8000) : '');
          const questionCount = Math.min(25, Math.max(3, Number(intent.params.questionCount) || 5));
          const difficulty =
            intent.params.difficulty === 'easy' ||
            intent.params.difficulty === 'medium' ||
            intent.params.difficulty === 'hard'
              ? intent.params.difficulty
              : 'mixed';
          const binaryAttachment =
            currentAttachment && (currentAttachment.kind === 'image' || currentAttachment.kind === 'pdf')
              ? currentAttachment
              : null;
          const attachBinary = Boolean(binaryAttachment && (intent.params.useAttachedImage || !lessonContent));

          setActiveToolRun({
            tool: 'create_exam',
            statusText: 'جاري التحقق من محتوى الدرس وبناء أسئلة الاختبار...',
          });

          try {
            const examData = await postNdjsonOrJson<ChatGeneratedExam>('/api/nova/generate-exam', {
              headers: makeHeaders(token),
              body: {
                curriculum,
                subjectGrade,
                lessonOrPages,
                lessonContent,
                questionCount,
                difficulty,
                ...(attachBinary && binaryAttachment
                  ? { image: { data: binaryAttachment.data, mimeType: binaryAttachment.mimeType } }
                  : {}),
              },
              onStatus: (msg) => setActiveToolRun((prev) => (prev ? { ...prev, statusText: msg } : prev)),
            });

            if (!Array.isArray(examData.questions) || examData.questions.length === 0) {
              throw new Error('تعذر إنشاء أسئلة الاختبار حاليًا.');
            }

            const formattedHistory = examData.questions
              .map(
                (q, idx) =>
                  `${idx + 1}. **${q.question}**\n- الإجابة الصحيحة: ${q.options[q.correctIndex] || q.options[0]}`
              )
              .join('\n');
            saveStudyHistoryEntry({
              userId: user.uid,
              type: 'exam',
              title: examData.examTitle,
              subject: examData.subjectGrade,
              inputPreview: lessonOrPages.slice(0, 180),
              content: formattedHistory,
              itemCount: examData.questions.length,
            });

            const introText =
              intent.intro ||
              `تم إنشاء «${examData.examTitle}» (${examData.questions.length} أسئلة بأربعة خيارات). يمكنك حله مباشرة أدناه أو حفظ ورقة الاختبار.`;
            const encoded = encodeChatToolMessage(introText, { tool: 'exam', exam: examData });
            persistAssistantInBackground(encoded, `اختبار: ${examData.examTitle}`);
            return;
          } catch (examErr) {
            const msg = examErr instanceof Error ? examErr.message : '';
            if (msg.includes('لم يتمكن النظام') || msg.includes('المكتبة الإلكترونية')) {
              persistAssistantInBackground(
                `لم يتمكن النظام من قراءة محتوى درس «${lessonOrPages}» (${subjectGrade}) مباشرة من المكتبة الإلكترونية حتى لا أختلق أسئلة غير موثقة.\n\n**يمكنك الآن:** لصق نص الدرس هنا في المحادثة أو إرفاق ملف أو صورة صفحة الكتاب، وسأنشئ لك الاختبار فورًا.`
              );
              return;
            }
            throw examErr;
          }
        }

        if (intent.tool === 'summarize_lesson') {
          const subject = String(intent.params.subject || '').trim();
          const topic = String(intent.params.topic || '').trim();
          const rawLessonText = String(intent.params.lessonText || '').trim();
          const lessonText =
            rawLessonText ||
            (currentAttachment?.kind === 'text' ? currentAttachment.textContent.slice(0, 15000) : '');
          const binaryAttachment =
            currentAttachment && (currentAttachment.kind === 'image' || currentAttachment.kind === 'pdf')
              ? currentAttachment
              : null;
          const attachBinary = Boolean(binaryAttachment && (intent.params.useAttachedImage || !lessonText));

          setActiveToolRun({
            tool: 'summarize_lesson',
            statusText: 'جاري قراءة الدرس وتلخيصه في نقاط منظمة...',
          });

          const doFetch = (t: string) =>
            fetch('/api/nova/summarize-lesson', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...makeHeaders(t) },
              body: JSON.stringify({
                subject,
                topic,
                lessonText,
                ...(attachBinary && binaryAttachment
                  ? { image: { data: binaryAttachment.data, mimeType: binaryAttachment.mimeType } }
                  : {}),
              }),
            });

          let res = await doFetch(token);
          if (res.status === 401) {
            token = await user.getIdToken(true);
            res = await doFetch(token);
          }
          const raw = await res.text();
          if (raw.trimStart().startsWith('<')) throw new Error('استجابة غير صالحة من الخادم أثناء التلخيص.');
          const data = JSON.parse(raw) as ChatLessonSummary & { error?: string };
          if (!res.ok || !Array.isArray(data.bulletPoints) || data.bulletPoints.length === 0) {
            throw new Error(data.error || 'تعذر تلخيص الدرس حاليًا.');
          }

          const historyBody = [
            data.overview ? `${data.overview}\n` : '',
            ...data.bulletPoints.map((b) => `- ${b}`),
          ]
            .filter(Boolean)
            .join('\n');
          saveStudyHistoryEntry({
            userId: user.uid,
            type: 'summary',
            title: data.title,
            subject: data.subject,
            inputPreview: (lessonText || topic || currentAttachment?.fileName || 'صورة درس').slice(0, 180),
            content: historyBody,
            itemCount: data.bulletPoints.length,
          });

          const introText = intent.intro || `إليك ملخص «${data.title}» مرتبًا في نقاط واضحة:`;
          const encoded = encodeChatToolMessage(introText, { tool: 'summary', summary: data });
          persistAssistantInBackground(encoded, `ملخص: ${data.title}`);
          return;
        }

        // create_flashcards
        const subject = String(intent.params.subject || '').trim();
        const topic = String(intent.params.topic || '').trim();
        const rawLessonText = String(intent.params.lessonText || '').trim();
        const lessonText =
          rawLessonText ||
          (currentAttachment?.kind === 'text' ? currentAttachment.textContent.slice(0, 15000) : '');
        const count = Math.min(15, Math.max(4, Number(intent.params.count) || 8));
        const binaryAttachment =
          currentAttachment && (currentAttachment.kind === 'image' || currentAttachment.kind === 'pdf')
            ? currentAttachment
            : null;
        const attachBinary = Boolean(binaryAttachment && (intent.params.useAttachedImage || !lessonText));

        setActiveToolRun({
          tool: 'create_flashcards',
          statusText: `جاري إعداد ${count} بطاقات مراجعة تفاعلية...`,
        });

        const doCardsFetch = (t: string) =>
          fetch('/api/nova/generate-flashcards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...makeHeaders(t) },
            body: JSON.stringify({
              subject,
              topic,
              lessonText,
              count,
              ...(attachBinary && binaryAttachment
                ? { image: { data: binaryAttachment.data, mimeType: binaryAttachment.mimeType } }
                : {}),
            }),
          });

        let res = await doCardsFetch(token);
        if (res.status === 401) {
          token = await user.getIdToken(true);
          res = await doCardsFetch(token);
        }
        const raw = await res.text();
        if (raw.trimStart().startsWith('<')) throw new Error('استجابة غير صالحة من الخادم أثناء إنشاء البطاقات.');
        const data = JSON.parse(raw) as ChatFlashcardsResult & { error?: string };
        if (!res.ok || !Array.isArray(data.cards) || data.cards.length === 0) {
          throw new Error(data.error || 'تعذر توليد بطاقات المراجعة حاليًا.');
        }

        const formattedCards = data.cards
          .map((c, i) => `### بطاقة ${i + 1}: ${c.question}\n**الإجابة:** ${c.answer}`)
          .join('\n\n');
        saveStudyHistoryEntry({
          userId: user.uid,
          type: 'flashcards',
          title: data.deckTitle,
          subject: subject || topic || 'مراجعة سريعة',
          inputPreview: (lessonText || topic || 'صورة درس').slice(0, 180),
          content: formattedCards,
          itemCount: data.cards.length,
        });

        const introText = intent.intro || `تم إعداد ${data.cards.length} بطاقات مراجعة لـ «${data.deckTitle}»:`;
        const encoded = encodeChatToolMessage(introText, {
          tool: 'flashcards',
          flashcards: data,
          subject: subject || topic,
        });
        persistAssistantInBackground(encoded, `بطاقات: ${data.deckTitle}`);
      };

      await runWithToken();
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
          ...(currentAttachment &&
          (currentAttachment.kind === 'image' || currentAttachment.kind === 'pdf')
            ? {
                attachment: {
                  data: currentAttachment.data,
                  mimeType: currentAttachment.mimeType,
                  ...(currentAttachment.fileName ? { fileName: currentAttachment.fileName } : {}),
                },
              }
            : {}),
          ...(currentAttachment && currentAttachment.kind === 'text'
            ? {
                textAttachment: {
                  name: currentAttachment.fileName,
                  content: currentAttachment.textContent,
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
        let data: {
          reply?: string;
          text?: string;
          error?: string;
          toolIntent?: { tool: ActiveToolRun['tool']; params: Record<string, unknown>; intro?: string };
        } = {};
        if (rawBody) {
          try {
            data = JSON.parse(rawBody);
          } catch {
            throw new Error(`استجابة غير متوقعة من الخادم (HTTP ${response.status}).`);
          }
        }
        if (!response.ok) {
          throw new Error(data.error || `تعذر الحصول على رد من الخادم (رمز الخطأ ${response.status}).`);
        }
        if (data.toolIntent) {
          if (inactivityTimer) clearTimeout(inactivityTimer);
          await executeInChatTool(data.toolIntent, idToken);
          return;
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
      let detectedToolIntent: {
        tool: ActiveToolRun['tool'];
        params: Record<string, unknown>;
        intro?: string;
      } | null = null;

      const processLine = (line: string) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;
        let evt: {
          type?: string;
          phase?: 'generating' | 'thinking' | 'retrying';
          text?: string;
          reply?: string;
          error?: string;
          tool?: ActiveToolRun['tool'];
          params?: Record<string, unknown>;
          intro?: string;
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
        } else if (evt.type === 'tool_intent' && evt.tool) {
          detectedToolIntent = {
            tool: evt.tool,
            params: evt.params || {},
            intro: typeof evt.intro === 'string' ? evt.intro : '',
          };
          setStreamingReply('');
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

      if (streamError && !finalReply && !detectedToolIntent) {
        throw new Error(streamError);
      }

      if (detectedToolIntent) {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        await executeInChatTool(detectedToolIntent, idToken);
        return;
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
      setActiveToolRun(null);
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
                onClick={() => {
                  primeOutputAudioContext();
                  setVoiceModalOpen(true);
                }}
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
              {displayedMessages.map((msg, msgIdx) => {
                const parsedToolMsg = msg.role === 'assistant' ? parseChatToolMessage(msg.content) : null;
                const readableMsgText =
                  msg.role === 'assistant' ? formatToolMessageReadableText(msg.content) : msg.content;

                return (
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
                            onClick={() => handleToggleTts(msg.id, readableMsgText)}
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
                              onClick={() => onOpenPresentation(readableMsgText.slice(0, 120))}
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
                        <>
                          {parsedToolMsg?.text && <MarkdownMessage content={parsedToolMsg.text} />}
                          {parsedToolMsg?.payload && (
                            <ChatToolOutputCard
                              payload={parsedToolMsg.payload}
                              onError={(m) => setError(m)}
                            />
                          )}
                        </>
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
                );
              })}

              {isLoadingReply && (
                <div className="flex gap-2.5 sm:gap-3.5">
                  <div className="mt-1 shrink-0">
                    <NovaStarLogo size="sm" />
                  </div>
                  <div className="flex-1 min-w-0 overflow-hidden rounded-2xl px-3.5 py-3 sm:px-5 sm:py-4 bg-white dark:bg-[#070B18]/90 border border-slate-200 dark:border-white/15">
                    <div className="flex items-center gap-2 text-xs font-semibold mb-2" style={{ color: 'var(--accent-text)' }}>
                      <span>
                        {activeToolRun
                          ? activeToolRun.statusText
                          : streamingReply
                            ? 'Nova AI'
                            : statusLabel}
                      </span>
                    </div>
                    {activeToolRun?.tool === 'create_presentation' ? (
                      <div className="space-y-3">
                        <InteractiveSlideWhiteboard
                          slides={activeToolRun.pptxSlides || []}
                          totalExpected={activeToolRun.pptxTotalExpected || 6}
                          isGenerating={true}
                          visualTheme="cosmos"
                          language="ar"
                          deckTitle={activeToolRun.pptxTitle}
                          deckSubtitle={activeToolRun.pptxSubtitle}
                          statusMessage={activeToolRun.statusText}
                          replayNonce={activeToolRun.replayNonce || 1}
                        />
                      </div>
                    ) : streamingReply ? (
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
              {attachment.kind === 'image' ? (
                <img
                  src={attachment.previewUrl}
                  alt="معاينة الصورة المرفقة"
                  className="w-12 h-12 rounded-lg object-cover shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-white/10 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
                </div>
              )}
              <div className="min-w-0 flex flex-col">
                <span className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate max-w-[220px]">
                  {attachment.fileName || (attachment.kind === 'image' ? 'صورة مرفقة للتحليل' : 'ملف مرفق للتحليل')}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {attachment.kind === 'image'
                    ? 'صورة جاهزة للتحليل'
                    : `${attachment.kind === 'pdf' ? 'PDF' : 'ملف نصي'} • ${attachment.fileSizeLabel}`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                aria-label="إزالة المرفق"
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
              accept="image/*,.pdf,.txt,.md,.markdown,.csv,.json,.html,.htm,.xml,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.css,.sql,.yml,.yaml,.log"
              onChange={handleFileChange}
              className="hidden"
            />
            <div ref={attachMenuRef} className="relative shrink-0">
              {attachMenuOpen && (
                <div
                  role="menu"
                  aria-label="خيارات الإرفاق"
                  className="absolute bottom-full mb-2 start-0 z-40 w-60 max-w-[calc(100vw-2rem)] rounded-2xl bg-white dark:bg-[#0F172E] border border-slate-200 dark:border-white/15 shadow-2xl p-1.5 space-y-1"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="w-full min-h-[44px] flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-right text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/10 active:bg-slate-200 dark:active:bg-white/15 transition-colors cursor-pointer"
                  >
                    <Upload className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-primary)' }} />
                    <span>رفع ملف أو صورة من الجهاز</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      setCameraModalOpen(true);
                    }}
                    className="w-full min-h-[44px] flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-right text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/10 active:bg-slate-200 dark:active:bg-white/15 transition-colors cursor-pointer"
                  >
                    <Camera className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-primary)' }} />
                    <span>فتح الكاميرا لالتقاط صورة</span>
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => setAttachMenuOpen((prev) => !prev)}
                disabled={isLoadingReply}
                aria-label="إرفاق ملف أو صورة أو فتح الكاميرا"
                aria-expanded={attachMenuOpen}
                aria-haspopup="menu"
                title="إرفاق ملف أو صورة أو فتح الكاميرا"
                className={`min-w-[44px] min-h-[44px] p-3 rounded-xl border transition-colors shrink-0 cursor-pointer flex items-center justify-center ${
                  attachMenuOpen
                    ? 'bg-slate-100 dark:bg-[#17213E] border-slate-300 dark:border-white/30 text-slate-900 dark:text-white'
                    : 'bg-white dark:bg-[#0E152B] border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/25 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Paperclip className="w-4 h-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                primeOutputAudioContext();
                setVoiceModalOpen(true);
              }}
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
              placeholder="اكتب طلبك أو أرفق ملفًا أو تحدّث صوتيًا..."
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
            setAttachment({ ...img, kind: 'image', fileName: 'لقطة كاميرا.jpg' });
            setError(null);
            setTimeout(() => textareaRef.current?.focus(), 60);
          }}
          onAnalyzeNow={(img) => {
            sendMessage('حلّل هذه الصورة بالتفصيل واشرح ما يظهر فيها بدقة.', {
              ...img,
              kind: 'image',
              fileName: 'لقطة كاميرا.jpg',
            });
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
