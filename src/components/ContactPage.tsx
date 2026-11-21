import { useState, useEffect, FormEvent } from 'react';
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
import {
  Send,
  Mail,
  AlertCircle,
  CheckCircle2,
  Trash2,
  MessageSquarePlus,
  Lightbulb,
  Bug,
  HelpCircle,
  AlertTriangle,
  Sparkles,
  RefreshCw,
  ShieldCheck,
  Inbox,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { NovaStarLogo } from './NovaStarLogo';
import { getOtpHeaders } from '../lib/otpSession';

type MessageCategory = 'issue' | 'suggestion' | 'general';
type TriageLevel = 'pending' | 'simple' | 'urgent';

interface ContactMessageRecord {
  id: string;
  userId: string;
  senderName: string;
  senderEmail: string;
  category: MessageCategory;
  message: string;
  status: 'new' | 'reviewed';
  triageLevel: TriageLevel;
  aiReply: string;
  aiSummary: string;
  createdAtMs: number;
}

interface ContactPageProps {
  user: User;
  onGoToChat: () => void;
  onGoToOwnerDashboard?: () => void;
}

const CATEGORY_OPTIONS: Array<{
  id: MessageCategory;
  label: string;
  description: string;
  icon: typeof Bug;
}> = [
  {
    id: 'issue',
    label: 'مشكلة تقنية',
    description: 'الإبلاغ عن خطأ أو عطل واجهك',
    icon: Bug,
  },
  {
    id: 'suggestion',
    label: 'اقتراح تطوير',
    description: 'فكرة أو ميزة جديدة تود إضافتها',
    icon: Lightbulb,
  },
  {
    id: 'general',
    label: 'استفسار عام',
    description: 'سؤال عن الاستخدام أو تواصل مباشر',
    icon: HelpCircle,
  },
];

export function ContactPage({ user, onGoToChat, onGoToOwnerDashboard }: ContactPageProps) {
  const [senderName, setSenderName] = useState(user.displayName || '');
  const [category, setCategory] = useState<MessageCategory>('general');
  const [messageText, setMessageText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [latestResult, setLatestResult] = useState<{
    messageId: string;
    triageLevel: TriageLevel;
    reply: string;
  } | null>(null);

  const [records, setRecords] = useState<ContactMessageRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(true);

  useEffect(() => {
    const colRef = collection(db, 'contactMessages');
    const q = query(colRef, where('userId', '==', user.uid));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: ContactMessageRecord[] = snapshot.docs.map((d) => {
          const data = d.data();
          const created = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now();
          const cat: MessageCategory =
            data.category === 'issue' || data.category === 'suggestion' || data.category === 'general'
              ? data.category
              : 'general';
          const triage: TriageLevel =
            data.triageLevel === 'urgent' || data.triageLevel === 'simple' ? data.triageLevel : 'pending';
          return {
            id: d.id,
            userId: String(data.userId || ''),
            senderName: String(data.senderName || ''),
            senderEmail: String(data.senderEmail || ''),
            category: cat,
            message: String(data.message || ''),
            status: data.status === 'reviewed' ? 'reviewed' : 'new',
            triageLevel: triage,
            aiReply: String(data.aiReply || ''),
            aiSummary: String(data.aiSummary || ''),
            createdAtMs: created,
          };
        });
        items.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setRecords(items);
        setLoadingRecords(false);
      },
      (err) => {
        setLoadingRecords(false);
        handleFirestoreError(err, OperationType.LIST, 'contactMessages');
      }
    );

    return () => unsubscribe();
  }, [user.uid]);

  const runAiTriage = async (
    msgId: string,
    payload: { senderName: string; category: MessageCategory; message: string }
  ) => {
    setAnalyzingId(msgId);
    try {
      const idToken = await user.getIdToken();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);

      let response: Response;
      try {
        response = await fetch('/api/nova/contact-triage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
            ...getOtpHeaders(),
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const rawBody = await response.text();
      let data: {
        classification?: 'simple' | 'urgent';
        reply?: string;
        summary?: string;
        error?: string;
      } = {};
      if (rawBody) {
        try {
          data = JSON.parse(rawBody) as typeof data;
        } catch {
          throw new Error(`استجابة غير متوقعة أثناء تحليل الرسالة (HTTP ${response.status}).`);
        }
      }

      if (!response.ok) {
        throw new Error(data.error || `تعذر تحليل الرسالة بالمساعد (رمز الخطأ ${response.status}).`);
      }

      const triageLevel: 'simple' | 'urgent' = data.classification === 'urgent' ? 'urgent' : 'simple';
      const reply = (data.reply || '').trim();
      const summary = (data.summary || payload.message.slice(0, 120)).trim();

      if (!reply) {
        throw new Error('لم يرسل المساعد نصًا في نتيجة التحليل.');
      }

      const path = `contactMessages/${msgId}`;
      await updateDoc(doc(db, path), {
        triageLevel,
        aiReply: reply.slice(0, 4000),
        aiSummary: summary.slice(0, 500),
        triagedAt: serverTimestamp(),
      });

      setLatestResult({
        messageId: msgId,
        triageLevel,
        reply,
      });

      setFeedback({
        type: 'ok',
        text:
          triageLevel === 'urgent'
            ? 'تم حفظ رسالتك كرسالة عاجلة وإبلاغ مطور الموقع بها مباشرة.'
            : 'تم حفظ رسالتك وردّ المساعد عليها مباشرة أدناه.',
      });
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'استغرق تحليل الرسالة وقتًا أطول من المعتاد. تم حفظ رسالتك في قاعدة البيانات ويمكنك إعادة التحليل.'
          : err instanceof Error
            ? err.message
            : 'تم حفظ رسالتك، لكن تعذر تحليلها تلقائيًا بالمساعد.';
      setFeedback({ type: 'err', text: msg });
    } finally {
      setAnalyzingId(null);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanName = senderName.trim();
    const cleanMessage = messageText.trim();

    if (cleanName.length < 1) {
      setFeedback({ type: 'err', text: 'يرجى كتابة اسمك قبل إرسال الرسالة.' });
      return;
    }
    if (cleanMessage.length < 5) {
      setFeedback({ type: 'err', text: 'يرجى كتابة تفاصيل المشكلة أو السؤال أو الاقتراح (5 أحرف على الأقل).' });
      return;
    }
    if (!user.email) {
      setFeedback({ type: 'err', text: 'لا يتوفر بريد إلكتروني موثق في الحساب الحالي.' });
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    setLatestResult(null);

    const msgId = crypto.randomUUID();
    const path = `contactMessages/${msgId}`;
    try {
      // 1. Save message to Firestore first
      await setDoc(doc(db, path), {
        userId: user.uid,
        senderName: cleanName.slice(0, 120),
        senderEmail: user.email.slice(0, 200),
        category,
        message: cleanMessage.slice(0, 3000),
        status: 'new',
        triageLevel: 'pending',
        createdAt: serverTimestamp(),
      });

      setMessageText('');
      setSubmitting(false);

      // 2. Automatically analyze message with Nova AI
      await runAiTriage(msgId, {
        senderName: cleanName.slice(0, 120),
        category,
        message: cleanMessage.slice(0, 3000),
      });
    } catch (err) {
      setSubmitting(false);
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر حفظ الرسالة حاليًا، يرجى المحاولة مجددًا.',
      });
      if (err instanceof Error && err.message.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
    }
  };

  const handleDelete = async (id: string) => {
    const path = `contactMessages/${id}`;
    try {
      await deleteDoc(doc(db, path));
      if (latestResult?.messageId === id) {
        setLatestResult(null);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const formatDate = (ms: number) =>
    new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ms));

  const categoryLabel = (cat: MessageCategory) =>
    CATEGORY_OPTIONS.find((c) => c.id === cat)?.label || 'استفسار عام';

  return (
    <div className="flex-1 min-h-0 overflow-y-auto max-w-5xl w-full mx-auto px-3.5 sm:px-6 py-5 sm:py-6 space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--accent-text)' }}>
            الدعم الذكي والتواصل المباشر
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            تواصل معنا
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1.5 max-w-2xl leading-relaxed">
            أرسل سؤالك أو مشكلتك أو اقتراحك؛ تُحفظ كل رسالة في قاعدة البيانات ويحللها{' '}
            <span dir="ltr">Nova AI</span> تلقائيًا للرد عليك فورًا أو رفع الحالات التقنية العاجلة إلى مطور الموقع.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0 self-start sm:self-auto">
          {onGoToOwnerDashboard && (
            <button
              type="button"
              onClick={onGoToOwnerDashboard}
              className="accent-btn inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-xs sm:text-sm font-semibold cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>لوحة المالك</span>
            </button>
          )}
          <button
            type="button"
            onClick={onGoToChat}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-[#0B1020] border border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/25 text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
          >
            <MessageSquarePlus className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            <span>العودة إلى المحادثة</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Form + Saved Messages */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left / Right Primary Column: Form + Instant AI Triage Result */}
        <div className="lg:col-span-6 space-y-5 min-w-0">
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-6 space-y-5 backdrop-blur-md"
          >
            <div className="flex items-center gap-2.5 text-base font-bold text-slate-900 dark:text-white">
              <Mail className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <span>إرسال رسالة جديدة</span>
            </div>

            {/* Sender Name */}
            <div>
              <label
                htmlFor="contact-name"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2"
              >
                الاسم الكامل
              </label>
              <input
                id="contact-name"
                type="text"
                required
                maxLength={120}
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder="اكتب اسمك هنا..."
                className="accent-focus w-full rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 focus:outline-none px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
              />
            </div>

            {/* Category Selector */}
            <div>
              <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                نوع الرسالة
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {CATEGORY_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const active = category === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setCategory(opt.id)}
                      className={`p-3 rounded-xl border text-right transition-all cursor-pointer ${
                        active
                          ? 'accent-active-tab text-slate-900 dark:text-white'
                          : 'bg-slate-50 dark:bg-[#060916] border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-white/25'
                      }`}
                    >
                      <div className="flex items-center gap-2 text-xs font-bold mb-1">
                        <Icon
                          className="w-3.5 h-3.5 shrink-0"
                          style={active ? { color: 'var(--accent-primary)' } : undefined}
                        />
                        <span>{opt.label}</span>
                      </div>
                      <p className="text-[11px] opacity-80 leading-snug">{opt.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Message */}
            <div>
              <label
                htmlFor="contact-message"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2"
              >
                تفاصيل المشكلة أو السؤال أو الاقتراح
              </label>
              <textarea
                id="contact-message"
                rows={5}
                required
                minLength={5}
                maxLength={3000}
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="اشرح مشكلتك أو اكتب سؤالك أو اقتراحك بوضوح..."
                className="accent-focus w-full rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 focus:outline-none px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 resize-y"
              />
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span className="min-w-0 break-all">
                  الحساب: <span dir="ltr" className="font-mono">{user.email}</span>
                </span>
                <span className="tabular-nums shrink-0" dir="ltr">
                  {messageText.length} / 3000
                </span>
              </div>
            </div>

            {feedback && (
              <div
                role="alert"
                className={`rounded-xl px-4 py-3 text-xs sm:text-sm border flex items-start gap-2.5 leading-relaxed ${
                  feedback.type === 'ok'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-200'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-200'
                }`}
              >
                {feedback.type === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                )}
                <span>{feedback.text}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || Boolean(analyzingId)}
              className="accent-btn w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl disabled:opacity-60 text-white text-sm font-semibold transition-all cursor-pointer"
            >
              <Send className="w-4 h-4 rotate-180" />
              <span>
                {submitting
                  ? 'جاري حفظ الرسالة...'
                  : analyzingId
                    ? 'جاري التحليل والرد عبر المساعد...'
                    : 'إرسال وتحليل الرسالة'}
              </span>
            </button>
          </form>

          {/* Live AI Analysis Feedback Card */}
          {(analyzingId || latestResult) && (
            <div
              className={`rounded-2xl border p-5 space-y-3 backdrop-blur-md ${
                latestResult?.triageLevel === 'urgent'
                  ? 'bg-rose-500/10 border-rose-500/35'
                  : 'bg-white/90 dark:bg-[#0B1020]/90 border-slate-200 dark:border-white/15'
              }`}
            >
              {analyzingId && !latestResult ? (
                <div className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200">
                  <NovaStarLogo size="xs" />
                  <span className="font-medium">
                    تم حفظ رسالتك في قاعدة البيانات، ويقوم Nova AI بتحليلها الآن...
                  </span>
                </div>
              ) : latestResult?.triageLevel === 'urgent' ? (
                <>
                  <div className="flex items-center gap-2.5 text-sm font-bold text-rose-700 dark:text-rose-300">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>رسالة عاجلة — تم إبلاغ مطور الموقع</span>
                  </div>
                  <p className="text-sm text-slate-800 dark:text-slate-100 leading-relaxed whitespace-pre-wrap">
                    {latestResult.reply}
                  </p>
                </>
              ) : latestResult ? (
                <>
                  <div className="flex items-center gap-2.5 text-sm font-bold text-slate-900 dark:text-white">
                    <Sparkles className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-primary)' }} />
                    <span>رد Nova AI المباشر</span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                    {latestResult.reply}
                  </p>
                </>
              ) : null}
            </div>
          )}
        </div>

        {/* User's Saved Messages & AI Replies */}
        <section className="lg:col-span-6 min-w-0 rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-6 space-y-4 backdrop-blur-md">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
              <Inbox className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <span>سجل رسائلك وردود المساعد</span>
            </div>
            <span className="text-xs text-slate-500 tabular-nums">{records.length} رسالة</span>
          </div>

          {loadingRecords ? (
            <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
              جاري تحميل رسائلك من قاعدة البيانات...
            </div>
          ) : records.length === 0 ? (
            <div className="py-12 px-4 rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 text-center space-y-2">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                لا توجد رسائل محفوظة في سجلك بعد
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                أرسل أي استفسار أو مشكلة عبر النموذج ليقوم المساعد بتحليلها والرد عليك فورًا.
              </p>
            </div>
          ) : (
            <div className="space-y-3.5 max-h-[580px] overflow-y-auto pl-1">
              {records.map((item) => {
                const isAnalyzingThis = analyzingId === item.id;
                return (
                  <article
                    key={item.id}
                    className={`p-4 rounded-xl border space-y-3 ${
                      item.triageLevel === 'urgent'
                        ? 'bg-rose-500/5 border-rose-500/30'
                        : 'bg-slate-50 dark:bg-[#060916] border-slate-200 dark:border-white/10'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-900 dark:text-white">
                          {item.senderName}
                        </span>
                        <span
                          className="text-[11px] font-semibold px-2 py-0.5 rounded-md border"
                          style={{
                            borderColor: 'var(--accent-border)',
                            backgroundColor: 'var(--accent-soft)',
                            color: 'var(--accent-text)',
                          }}
                        >
                          {categoryLabel(item.category)}
                        </span>
                        {item.triageLevel === 'urgent' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-500/15 border border-rose-500/35 text-rose-700 dark:text-rose-300">
                            <AlertTriangle className="w-3 h-3" />
                            <span>عاجلة · وصلت للمطور</span>
                          </span>
                        ) : item.triageLevel === 'simple' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>ردّ المساعد مباشرة</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-amber-600 dark:text-amber-300 font-medium">
                            بانتظار التحليل
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDelete(item.id)}
                        aria-label="حذف الرسالة"
                        title="حذف الرسالة"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <p className="text-sm text-slate-800 dark:text-slate-100 leading-relaxed whitespace-pre-wrap break-words">
                      {item.message}
                    </p>

                    {item.aiReply ? (
                      <div className="p-3.5 rounded-xl bg-white dark:bg-[#0B1020] border border-slate-200 dark:border-white/10 space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--accent-text)' }}>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>
                            {item.triageLevel === 'urgent' ? 'إشعار التصعيد للمطور' : 'رد Nova AI'}
                          </span>
                        </div>
                        <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                          {item.aiReply}
                        </p>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={isAnalyzingThis}
                        onClick={() =>
                          runAiTriage(item.id, {
                            senderName: item.senderName,
                            category: item.category,
                            message: item.message,
                          })
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-[#0B1020] border border-slate-200 dark:border-white/15 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-slate-300 cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzingThis ? 'animate-spin' : ''}`} />
                        <span>{isAnalyzingThis ? 'جاري التحليل...' : 'تحليل الرسالة بالمساعد'}</span>
                      </button>
                    )}

                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span>{formatDate(item.createdAtMs)}</span>
                      <span>
                        {item.status === 'reviewed' ? 'حالة الإدارة: تمت المراجعة' : 'حالة الإدارة: جديدة'}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
