import { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import {
  History,
  BookOpen,
  Layers,
  ListChecks,
  ClipboardCheck,
  Trash2,
  ChevronDown,
  ChevronUp,
  Volume2,
  Square,
  GraduationCap,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { StudyHistoryType } from '../lib/studyHistory';
import { createVoiceReader } from '../lib/voiceReader';
import { MarkdownMessage } from './MarkdownMessage';

interface UsageHistoryPageProps {
  user: User;
  onOpenStudyTool: () => void;
  onOpenExamTool: () => void;
}

interface HistoryRecord {
  id: string;
  userId: string;
  type: StudyHistoryType;
  title: string;
  subject: string;
  inputPreview: string;
  content: string;
  itemCount?: number;
  createdAtMs: number;
}

const TYPE_META: Record<
  StudyHistoryType,
  { label: string; icon: typeof BookOpen; unitLabel: string }
> = {
  summary: { label: 'تلخيص درس', icon: BookOpen, unitLabel: 'نقطة' },
  flashcards: { label: 'بطاقات مراجعة', icon: Layers, unitLabel: 'بطاقة' },
  homework: { label: 'مساعد الواجبات', icon: ListChecks, unitLabel: 'خطوة' },
  exam: { label: 'اختبار مدرسي', icon: ClipboardCheck, unitLabel: 'سؤال' },
};

export function UsageHistoryPage({
  user,
  onOpenStudyTool,
  onOpenExamTool,
}: UsageHistoryPageProps) {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | StudyHistoryType>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [loadingTtsId, setLoadingTtsId] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);

  const readerRef = useRef<ReturnType<typeof createVoiceReader> | null>(null);
  if (!readerRef.current) {
    readerRef.current = createVoiceReader();
  }

  useEffect(() => {
    return () => {
      readerRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    const path = `users/${user.uid}/studyHistory`;
    const q = query(collection(db, path), where('userId', '==', user.uid));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: HistoryRecord[] = snapshot.docs.map((d) => {
          const data = d.data();
          const created = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now();
          const rawType = String(data.type || 'summary');
          const safeType: StudyHistoryType =
            rawType === 'flashcards' || rawType === 'homework' || rawType === 'exam'
              ? rawType
              : 'summary';
          return {
            id: d.id,
            userId: String(data.userId || ''),
            type: safeType,
            title: String(data.title || 'نشاط دراسي'),
            subject: String(data.subject || ''),
            inputPreview: String(data.inputPreview || ''),
            content: String(data.content || ''),
            itemCount: typeof data.itemCount === 'number' ? data.itemCount : undefined,
            createdAtMs: created,
          };
        });
        list.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setRecords(list);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );

    return () => unsubscribe();
  }, [user.uid]);

  const handleDelete = async (recordId: string) => {
    const path = `users/${user.uid}/studyHistory/${recordId}`;
    try {
      await deleteDoc(doc(db, path));
      if (expandedId === recordId) setExpandedId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const handleSpeak = async (item: HistoryRecord) => {
    if (!readerRef.current) return;
    setTtsError(null);
    await readerRef.current.speak(item.id, `${item.title}. ${item.content}`, user, {
      onLoadingChange: setLoadingTtsId,
      onSpeakingChange: setSpeakingId,
      onError: (msg) => setTtsError(msg),
    });
  };

  const filtered = filterType === 'all' ? records : records.filter((r) => r.type === filterType);
  const summaryCount = records.filter((r) => r.type === 'summary').length;
  const flashcardCount = records.filter((r) => r.type === 'flashcards').length;
  const homeworkCount = records.filter((r) => r.type === 'homework').length;
  const examCount = records.filter((r) => r.type === 'exam').length;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto max-w-6xl w-full mx-auto px-3.5 sm:px-6 py-5 sm:py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <History className="w-6 h-6" style={{ color: 'var(--accent-primary)' }} />
            <span>سجل الاستخدام الشخصي</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
            استعرض آخر الدروس التي لخصتها، بطاقات المراجعة، خطوات الواجبات، والاختبارات التي أنشأتها في حسابك الخاص.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenStudyTool}
            className="inline-flex items-center gap-2 min-h-[42px] px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-xs sm:text-sm font-semibold text-slate-900 dark:text-white cursor-pointer border border-slate-200 dark:border-white/10"
          >
            <GraduationCap className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            <span>أدوات المذاكرة</span>
          </button>
          <button
            type="button"
            onClick={onOpenExamTool}
            className="accent-btn inline-flex items-center gap-2 min-h-[42px] px-3.5 py-2 rounded-xl text-white text-xs sm:text-sm font-semibold cursor-pointer"
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>صانع الاختبارات</span>
          </button>
        </div>
      </div>

      {/* Compact Usage Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-white/85 dark:bg-[#0B1020]/85 border border-slate-200 dark:border-white/10 p-4 backdrop-blur-md">
          <div className="text-xs text-slate-500 dark:text-slate-400">الدروس الملخصة</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums mt-1">{summaryCount}</div>
        </div>
        <div className="rounded-2xl bg-white/85 dark:bg-[#0B1020]/85 border border-slate-200 dark:border-white/10 p-4 backdrop-blur-md">
          <div className="text-xs text-slate-500 dark:text-slate-400">مجموعات البطاقات</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums mt-1">{flashcardCount}</div>
        </div>
        <div className="rounded-2xl bg-white/85 dark:bg-[#0B1020]/85 border border-slate-200 dark:border-white/10 p-4 backdrop-blur-md">
          <div className="text-xs text-slate-500 dark:text-slate-400">شروحات الواجبات</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums mt-1">{homeworkCount}</div>
        </div>
        <div className="rounded-2xl bg-white/85 dark:bg-[#0B1020]/85 border border-slate-200 dark:border-white/10 p-4 backdrop-blur-md">
          <div className="text-xs text-slate-500 dark:text-slate-400">الاختبارات المنشأة</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums mt-1">{examCount}</div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { id: 'all', label: `الكل (${records.length})` },
            { id: 'summary', label: 'تلخيص الدروس' },
            { id: 'flashcards', label: 'بطاقات المراجعة' },
            { id: 'homework', label: 'مساعد الواجبات' },
            { id: 'exam', label: 'الاختبارات' },
          ] as Array<{ id: 'all' | StudyHistoryType; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilterType(tab.id)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors border tabular-nums ${
              filterType === tab.id
                ? 'accent-active-tab text-slate-900 dark:text-white'
                : 'bg-white/80 dark:bg-[#0B1020]/80 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {ttsError && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-700 dark:text-rose-200">
          {ttsError}
        </div>
      )}

      {/* Records List */}
      {loading ? (
        <div className="rounded-2xl bg-white/85 dark:bg-[#0B1020]/85 border border-slate-200 dark:border-white/10 p-8 text-center text-sm text-slate-500">
          جاري تحميل سجل الاستخدام الشخصي...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-white/85 dark:bg-[#0B1020]/85 border border-slate-200 dark:border-white/10 p-8 text-center space-y-3 backdrop-blur-md">
          <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10">
            <History className="w-6 h-6" style={{ color: 'var(--accent-primary)' }} />
          </div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
            لا توجد عناصر محفوظة في هذا القسم بعد
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
            عند استخدام تلخيص الدروس أو بطاقات المراجعة أو مساعد الواجبات أو صانع الاختبارات، ستظهر آخر أعمالك هنا تلقائيًا للرجوع إليها في أي وقت.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const meta = TYPE_META[item.type];
            const Icon = meta.icon;
            const isExpanded = expandedId === item.id;
            const formattedDate = new Intl.DateTimeFormat('ar', {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(item.createdAtMs));

            return (
              <article
                key={item.id}
                className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-5 backdrop-blur-md space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-semibold" style={{ color: 'var(--accent-text)' }}>
                          {meta.label}
                        </span>
                        {item.subject && (
                          <>
                            <span>·</span>
                            <span>{item.subject}</span>
                          </>
                        )}
                        {typeof item.itemCount === 'number' && item.itemCount > 0 && (
                          <>
                            <span>·</span>
                            <span className="tabular-nums">
                              {item.itemCount} {meta.unitLabel}
                            </span>
                          </>
                        )}
                        <span>·</span>
                        <span>{formattedDate}</span>
                      </div>
                      <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white break-words">
                        {item.title}
                      </h2>
                      {item.inputPreview && !isExpanded && (
                        <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-1">
                          {item.inputPreview}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleSpeak(item)}
                      disabled={loadingTtsId === item.id}
                      aria-label={speakingId === item.id ? 'إيقاف القراءة' : 'قراءة صوتية'}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer"
                    >
                      {speakingId === item.id ? (
                        <>
                          <Square className="w-3.5 h-3.5 text-rose-500" />
                          <span>إيقاف</span>
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                          <span>{loadingTtsId === item.id ? 'جاري التحميل...' : 'قراءة'}</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer"
                    >
                      <span>{isExpanded ? 'إخفاء' : 'عرض'}</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      aria-label="حذف السجل"
                      className="p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="pt-3 border-t border-slate-200 dark:border-white/10">
                    <MarkdownMessage content={item.content} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
