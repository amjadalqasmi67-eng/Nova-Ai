import { useState, useRef, useEffect, FormEvent, ChangeEvent } from 'react';
import { User } from 'firebase/auth';
import {
  BookOpen,
  Layers,
  GraduationCap,
  Upload,
  Camera,
  X,
  Sparkles,
  AlertCircle,
  RefreshCw,
  Volume2,
  Square,
  RotateCw,
  ChevronRight,
  ChevronLeft,
  Lightbulb,
  Shuffle,
  CheckCircle2,
  ListChecks,
} from 'lucide-react';
import { CompressedImage, compressImageFile } from '../lib/imageUtils';
import { getOtpHeaders } from '../lib/otpSession';
import { sanitizeUserText } from '../lib/sanitize';
import { saveStudyHistoryEntry } from '../lib/studyHistory';
import { createVoiceReader } from '../lib/voiceReader';
import { CameraCaptureModal } from './CameraCaptureModal';

type StudyMode = 'summary' | 'flashcards' | 'homework';

interface StudyStudioProps {
  user: User;
  initialMode?: StudyMode;
}

interface LessonSummaryResult {
  title: string;
  subject: string;
  overview: string;
  bulletPoints: string[];
  keyTerms: Array<{ term: string; definition: string }>;
}

interface FlashcardItem {
  question: string;
  answer: string;
  hint: string;
}

interface FlashcardsResult {
  deckTitle: string;
  cards: FlashcardItem[];
}

interface HomeworkHelpResult {
  title: string;
  concept: string;
  steps: string[];
  hint: string;
  nextCheckQuestion: string;
}

export function StudyStudio({ user, initialMode = 'summary' }: StudyStudioProps) {
  const [mode, setMode] = useState<StudyMode>(initialMode);

  // Shared lesson input state for Summary & Flashcards
  const [subject, setSubject] = useState('');
  const [lessonText, setLessonText] = useState('');
  const [lessonImage, setLessonImage] = useState<CompressedImage | null>(null);
  const [cardCount, setCardCount] = useState<number>(8);

  // Homework Helper input state
  const [hwSubject, setHwSubject] = useState('');
  const [hwQuestion, setHwQuestion] = useState('');
  const [hwAttempt, setHwAttempt] = useState('');
  const [hwImage, setHwImage] = useState<CompressedImage | null>(null);

  // Camera modal target
  const [cameraTarget, setCameraTarget] = useState<'lesson' | 'homework' | null>(null);
  const lessonFileInputRef = useRef<HTMLInputElement | null>(null);
  const hwFileInputRef = useRef<HTMLInputElement | null>(null);

  // Output & loading states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryResult, setSummaryResult] = useState<LessonSummaryResult | null>(null);
  const [flashcardsResult, setFlashcardsResult] = useState<FlashcardsResult | null>(null);
  const [homeworkResult, setHomeworkResult] = useState<HomeworkHelpResult | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // Flashcards interactive state
  const [activeCardIdx, setActiveCardIdx] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [showAllCards, setShowAllCards] = useState(false);

  // Voice Reader state
  const readerRef = useRef<ReturnType<typeof createVoiceReader> | null>(null);
  if (!readerRef.current) {
    readerRef.current = createVoiceReader();
  }
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [loadingTtsId, setLoadingTtsId] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    return () => {
      readerRef.current?.stop();
    };
  }, []);

  const handleImageFileSelect = async (
    e: ChangeEvent<HTMLInputElement>,
    target: 'lesson' | 'homework'
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('يمكن رفع ملفات الصور فقط (JPG / PNG / WEBP).');
      return;
    }
    try {
      const compressed = await compressImageFile(file);
      if (target === 'lesson') {
        setLessonImage(compressed);
      } else {
        setHwImage(compressed);
      }
      setError(null);
    } catch {
      setError('تعذر تجهيز الصورة. يرجى تجربة صورة أخرى.');
    }
  };

  const handleReadAloud = async (id: string, text: string) => {
    if (!readerRef.current || !text.trim()) return;
    await readerRef.current.speak(id, text, user, {
      onLoadingChange: setLoadingTtsId,
      onSpeakingChange: setSpeakingId,
      onError: (msg) => setError(msg),
    });
  };

  const runSummary = async () => {
    const cleanText = sanitizeUserText(lessonText, 20000);
    const cleanSubject = sanitizeUserText(subject, 120, false);
    if (!lessonImage && cleanText.length < 15) {
      setError('يرجى لصق نص الدرس (15 حرفًا على الأقل) أو رفع صورة صفحة الدرس.');
      return;
    }

    setLoading(true);
    setError(null);
    setSavedNotice(null);

    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/nova/summarize-lesson', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
          ...getOtpHeaders(),
        },
        body: JSON.stringify({
          lessonText: cleanText,
          subject: cleanSubject,
          ...(lessonImage ? { image: { data: lessonImage.data, mimeType: lessonImage.mimeType } } : {}),
        }),
      });

      const raw = await res.text();
      if (raw.trimStart().startsWith('<')) {
        throw new Error('استجابة غير صالحة من الخادم أثناء تلخيص الدرس.');
      }
      const data = JSON.parse(raw) as LessonSummaryResult & { error?: string };
      if (!res.ok || !Array.isArray(data.bulletPoints) || data.bulletPoints.length === 0) {
        throw new Error(data.error || 'تعذر تلخيص الدرس حاليًا. يرجى المحاولة مجددًا.');
      }

      setSummaryResult(data);

      const formattedHistoryContent = [
        data.overview ? `${data.overview}\n` : '',
        '### النقاط الرئيسية:',
        ...data.bulletPoints.map((b) => `- ${b}`),
        ...(data.keyTerms.length > 0
          ? ['', '### أهم المصطلحات:', ...data.keyTerms.map((k) => `- **${k.term}:** ${k.definition}`)]
          : []),
      ]
        .filter(Boolean)
        .join('\n');

      const savedId = await saveStudyHistoryEntry({
        userId: user.uid,
        type: 'summary',
        title: data.title,
        subject: data.subject,
        inputPreview: cleanText ? cleanText.slice(0, 180) : 'ملخص مستخرج من صورة الدرس',
        content: formattedHistoryContent,
        itemCount: data.bulletPoints.length,
      });
      if (savedId) {
        setSavedNotice('تم حفظ هذا الملخص تلقائيًا في سجل الاستخدام الشخصي.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تلخيص الدرس.');
    } finally {
      setLoading(false);
    }
  };

  const runFlashcards = async () => {
    const cleanText = sanitizeUserText(lessonText, 20000);
    const cleanSubject = sanitizeUserText(subject, 120, false);
    if (!lessonImage && cleanText.length < 15) {
      setError('يرجى إدخال نص الدرس (15 حرفًا على الأقل) أو رفع صورة الدرس لتوليد البطاقات.');
      return;
    }

    setLoading(true);
    setError(null);
    setSavedNotice(null);

    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/nova/generate-flashcards', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
          ...getOtpHeaders(),
        },
        body: JSON.stringify({
          lessonText: cleanText,
          subject: cleanSubject,
          count: cardCount,
          ...(lessonImage ? { image: { data: lessonImage.data, mimeType: lessonImage.mimeType } } : {}),
        }),
      });

      const raw = await res.text();
      if (raw.trimStart().startsWith('<')) {
        throw new Error('استجابة غير صالحة من الخادم أثناء إنشاء البطاقات.');
      }
      const data = JSON.parse(raw) as FlashcardsResult & { error?: string };
      if (!res.ok || !Array.isArray(data.cards) || data.cards.length === 0) {
        throw new Error(data.error || 'تعذر توليد بطاقات المراجعة حاليًا.');
      }

      setFlashcardsResult(data);
      setActiveCardIdx(0);
      setIsFlipped(false);
      setShowHint(false);

      const formattedCards = data.cards
        .map(
          (c, i) =>
            `### بطاقة ${i + 1}: ${c.question}\n**الإجابة:** ${c.answer}${
              c.hint ? `\n*تلميح:* ${c.hint}` : ''
            }`
        )
        .join('\n\n');

      const savedId = await saveStudyHistoryEntry({
        userId: user.uid,
        type: 'flashcards',
        title: data.deckTitle,
        subject: cleanSubject || 'مراجعة سريعة',
        inputPreview: cleanText ? cleanText.slice(0, 180) : 'بطاقات من صورة الدرس',
        content: formattedCards,
        itemCount: data.cards.length,
      });
      if (savedId) {
        setSavedNotice('تم حفظ مجموعة البطاقات في سجل الاستخدام الشخصي.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء إنشاء بطاقات المراجعة.');
    } finally {
      setLoading(false);
    }
  };

  const runHomeworkHelp = async () => {
    const cleanQuestion = sanitizeUserText(hwQuestion, 5000);
    const cleanSubject = sanitizeUserText(hwSubject, 120, false);
    const cleanAttempt = sanitizeUserText(hwAttempt, 2500);
    if (!hwImage && cleanQuestion.length < 4) {
      setError('يرجى كتابة سؤال الواجب أو إرفاق صورته أولاً.');
      return;
    }

    setLoading(true);
    setError(null);
    setSavedNotice(null);

    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/nova/homework-help', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
          ...getOtpHeaders(),
        },
        body: JSON.stringify({
          question: cleanQuestion,
          subject: cleanSubject,
          studentAttempt: cleanAttempt,
          ...(hwImage ? { image: { data: hwImage.data, mimeType: hwImage.mimeType } } : {}),
        }),
      });

      const raw = await res.text();
      if (raw.trimStart().startsWith('<')) {
        throw new Error('استجابة غير صالحة من الخادم أثناء تحليل الواجب.');
      }
      const data = JSON.parse(raw) as HomeworkHelpResult & { error?: string };
      if (!res.ok || !Array.isArray(data.steps) || data.steps.length === 0) {
        throw new Error(data.error || 'تعذر شرح خطوات الواجب حاليًا.');
      }

      setHomeworkResult(data);

      const formattedHw = [
        data.concept ? `**الفكرة الأساسية:** ${data.concept}\n` : '',
        '### خطوات الحل الإرشادية:',
        ...data.steps.map((s, idx) => `${idx + 1}. ${s}`),
        data.hint ? `\n**تلميح مساعد:** ${data.hint}` : '',
        data.nextCheckQuestion ? `\n**تحدّي الإكمال:** ${data.nextCheckQuestion}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const savedId = await saveStudyHistoryEntry({
        userId: user.uid,
        type: 'homework',
        title: data.title,
        subject: cleanSubject || 'واجب مدرسي',
        inputPreview: cleanQuestion ? cleanQuestion.slice(0, 180) : 'مسألة من صورة مرفقة',
        content: formattedHw,
        itemCount: data.steps.length,
      });
      if (savedId) {
        setSavedNotice('تم حفظ شرح الخطوات في سجل الاستخدام الشخصي.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء شرح سؤال الواجب.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (mode === 'summary') await runSummary();
    else if (mode === 'flashcards') await runFlashcards();
    else await runHomeworkHelp();
  };

  const handleShuffleFlashcards = () => {
    if (!flashcardsResult || flashcardsResult.cards.length < 2) return;
    const shuffled = [...flashcardsResult.cards];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setFlashcardsResult({ ...flashcardsResult, cards: shuffled });
    setActiveCardIdx(0);
    setIsFlipped(false);
    setShowHint(false);
  };

  const currentCard = flashcardsResult?.cards[activeCardIdx];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto max-w-6xl w-full mx-auto px-3.5 sm:px-6 py-5 sm:py-6 space-y-6">
      {/* Header + Tool Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <GraduationCap className="w-6 h-6" style={{ color: 'var(--accent-primary)' }} />
            <span>أدوات المذاكرة والواجبات</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
            لخّص الدروس في نقاط واضحة، أنشئ بطاقات مراجعة سريعة، واحصل على شرح خطوة بخطوة للواجبات دون حرق الإجابة.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="أدوات الدراسة"
          className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-[#050814] border border-slate-200 dark:border-white/10"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'summary'}
            onClick={() => {
              setMode('summary');
              setError(null);
              setSavedNotice(null);
            }}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap cursor-pointer transition-all border ${
              mode === 'summary'
                ? 'accent-active-tab text-slate-900 dark:text-white'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <BookOpen className="w-4 h-4 shrink-0" />
            <span>تلخيص الدروس</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={mode === 'flashcards'}
            onClick={() => {
              setMode('flashcards');
              setError(null);
              setSavedNotice(null);
            }}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap cursor-pointer transition-all border ${
              mode === 'flashcards'
                ? 'accent-active-tab text-slate-900 dark:text-white'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Layers className="w-4 h-4 shrink-0" />
            <span>بطاقات مراجعة</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={mode === 'homework'}
            onClick={() => {
              setMode('homework');
              setError(null);
              setSavedNotice(null);
            }}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap cursor-pointer transition-all border ${
              mode === 'homework'
                ? 'accent-active-tab text-slate-900 dark:text-white'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ListChecks className="w-4 h-4 shrink-0" />
            <span>مساعد الواجبات</span>
          </button>
        </div>
      </div>

      {/* Main Two-Zone Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Zone: Input Form */}
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-5 rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-6 space-y-4 backdrop-blur-md"
        >
          {mode !== 'homework' ? (
            <>
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-white/10">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                  {mode === 'summary' ? (
                    <BookOpen className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                  ) : (
                    <Layers className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                  )}
                  <span>
                    {mode === 'summary' ? 'إدخال نص أو صورة الدرس للتلخيص' : 'محتوى الدرس لتوليد البطاقات'}
                  </span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="study-subject"
                  className="block text-xs sm:text-sm font-bold text-slate-900 dark:text-white mb-1.5"
                >
                  المادة أو اسم الدرس (اختياري)
                </label>
                <input
                  id="study-subject"
                  type="text"
                  maxLength={120}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="مثال: الأحياء — الجهاز التنفسي"
                  className="accent-focus w-full rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="study-lesson-text"
                  className="block text-xs sm:text-sm font-bold text-slate-900 dark:text-white mb-1.5"
                >
                  نص الدرس
                </label>
                <textarea
                  id="study-lesson-text"
                  rows={6}
                  maxLength={20000}
                  value={lessonText}
                  onChange={(e) => setLessonText(e.target.value)}
                  placeholder="الصق هنا نص الدرس أو الفقرات التي تريد تلخيصها أو تحويلها لبطاقات مراجعة..."
                  className="accent-focus w-full rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none resize-y leading-relaxed"
                />
              </div>

              {/* Image Upload / Camera Capture for Textbook Photo */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  أو ارفع صورة صفحة الكتاب / السبورة
                </div>
                <input
                  ref={lessonFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleImageFileSelect(e, 'lesson')}
                  className="hidden"
                />

                {lessonImage ? (
                  <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15">
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={lessonImage.previewUrl}
                        alt="معاينة صورة الدرس"
                        className="w-12 h-12 rounded-lg object-cover shrink-0 border border-slate-200 dark:border-white/15"
                      />
                      <span className="text-xs text-slate-700 dark:text-slate-300 truncate">
                        تم إرفاق صورة الدرس
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLessonImage(null)}
                      aria-label="إزالة صورة الدرس"
                      className="p-2 rounded-lg text-slate-500 hover:text-rose-500 cursor-pointer shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => lessonFileInputRef.current?.click()}
                      className="min-h-[44px] inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#060916] hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-white/15 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                    >
                      <Upload className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-primary)' }} />
                      <span>رفع صورة درس</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCameraTarget('lesson')}
                      className="min-h-[44px] inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#060916] hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-white/15 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                    >
                      <Camera className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-primary)' }} />
                      <span>تصوير الصفحة</span>
                    </button>
                  </div>
                )}
              </div>

              {mode === 'flashcards' && (
                <div className="rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-900 dark:text-white">
                    <span>عدد بطاقات المراجعة</span>
                    <span className="tabular-nums">{cardCount} بطاقات</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {[6, 8, 12, 15].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setCardCount(n)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold tabular-nums cursor-pointer border transition-colors ${
                          cardCount === n
                            ? 'accent-active-tab text-slate-900 dark:text-white'
                            : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-white/10">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                  <ListChecks className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                  <span>مساعد الواجبات التربوي</span>
                </div>
              </div>

              <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-800 dark:text-amber-200 leading-relaxed flex items-start gap-2">
                <Lightbulb className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <span>
                  يشرح لك Nova AI طريقة الحل خطوة بخطوة لتفهم الفكرة بنفسك، ولن يعرض الإجابة النهائية الجاهزة مباشرة.
                </span>
              </div>

              <div>
                <label
                  htmlFor="hw-subject"
                  className="block text-xs sm:text-sm font-bold text-slate-900 dark:text-white mb-1.5"
                >
                  المادة الدراسية (اختياري)
                </label>
                <input
                  id="hw-subject"
                  type="text"
                  maxLength={120}
                  value={hwSubject}
                  onChange={(e) => setHwSubject(e.target.value)}
                  placeholder="مثال: الرياضيات / الفيزياء / النحو"
                  className="accent-focus w-full rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="hw-question"
                  className="block text-xs sm:text-sm font-bold text-slate-900 dark:text-white mb-1.5"
                >
                  سؤال الواجب
                </label>
                <textarea
                  id="hw-question"
                  rows={4}
                  maxLength={5000}
                  value={hwQuestion}
                  onChange={(e) => setHwQuestion(e.target.value)}
                  placeholder="اكتب مسألة الواجب أو السؤال الذي تريد فهم خطوات حله..."
                  className="accent-focus w-full rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none resize-y leading-relaxed"
                />
              </div>

              <div>
                <label
                  htmlFor="hw-attempt"
                  className="block text-xs font-bold text-slate-900 dark:text-white mb-1.5"
                >
                  محاولتك في الحل (اختياري — للتصحيح خطوة بخطوة)
                </label>
                <textarea
                  id="hw-attempt"
                  rows={2}
                  maxLength={2500}
                  value={hwAttempt}
                  onChange={(e) => setHwAttempt(e.target.value)}
                  placeholder="اكتب ما وصلت إليه في الحل ليراجع المساعد خطواتك..."
                  className="accent-focus w-full rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15 px-3.5 py-2 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none resize-y"
                />
              </div>

              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  أو صوّر سؤال الواجب
                </div>
                <input
                  ref={hwFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleImageFileSelect(e, 'homework')}
                  className="hidden"
                />
                {hwImage ? (
                  <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15">
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={hwImage.previewUrl}
                        alt="معاينة صورة الواجب"
                        className="w-12 h-12 rounded-lg object-cover shrink-0 border border-slate-200 dark:border-white/15"
                      />
                      <span className="text-xs text-slate-700 dark:text-slate-300 truncate">
                        تم إرفاق صورة الواجب
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setHwImage(null)}
                      aria-label="إزالة صورة الواجب"
                      className="p-2 rounded-lg text-slate-500 hover:text-rose-500 cursor-pointer shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => hwFileInputRef.current?.click()}
                      className="min-h-[44px] inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#060916] hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-white/15 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                    >
                      <Upload className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-primary)' }} />
                      <span>رفع صورة</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCameraTarget('homework')}
                      className="min-h-[44px] inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#060916] hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-white/15 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                    >
                      <Camera className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-primary)' }} />
                      <span>التقاط صورة</span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {error && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-700 dark:text-rose-200 leading-relaxed"
            >
              <div className="flex items-start gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (mode === 'summary') runSummary();
                  else if (mode === 'flashcards') runFlashcards();
                  else runHomeworkHelp();
                }}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer shrink-0 disabled:opacity-50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>إعادة المحاولة</span>
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="accent-btn w-full min-h-[44px] py-3 px-4 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4 shrink-0" />
            <span>
              {loading
                ? mode === 'summary'
                  ? 'جاري قراءة وتلخيص الدرس...'
                  : mode === 'flashcards'
                    ? 'جاري إعداد بطاقات المراجعة...'
                    : 'جاري تحليل طريقة الحل خطوة بخطوة...'
                : mode === 'summary'
                  ? 'تلخيص الدرس بنقاط واضحة'
                  : mode === 'flashcards'
                    ? `توليد ${cardCount} بطاقات مراجعة`
                    : 'اشرح طريقة الحل خطوة بخطوة'}
            </span>
          </button>
        </form>

        {/* Right Zone: Output Stage */}
        <div className="lg:col-span-7 space-y-4">
          {savedNotice && (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
              <span>{savedNotice}</span>
            </div>
          )}

          {/* MODE 1: SUMMARY OUTPUT */}
          {mode === 'summary' &&
            (summaryResult ? (
              <div className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-5 sm:p-6 space-y-5 backdrop-blur-md">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 dark:border-white/10 pb-4">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold" style={{ color: 'var(--accent-text)' }}>
                      {summaryResult.subject}
                    </div>
                    <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
                      {summaryResult.title}
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={loadingTtsId === 'summary-read'}
                      onClick={() =>
                        handleReadAloud(
                          'summary-read',
                          `${summaryResult.title}. ${summaryResult.overview}. النقاط الرئيسية: ${summaryResult.bulletPoints.join('. ')}`
                        )
                      }
                      className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer"
                    >
                      {speakingId === 'summary-read' ? (
                        <>
                          <Square className="w-3.5 h-3.5 text-rose-500" />
                          <span>إيقاف القراءة</span>
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                          <span>{loadingTtsId === 'summary-read' ? 'جاري التحميل...' : 'قراءة صوتية'}</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMode('flashcards');
                        if (!lessonText.trim() && summaryResult.bulletPoints.length > 0) {
                          setLessonText(summaryResult.bulletPoints.join('\n'));
                        }
                      }}
                      className="accent-btn inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-xl text-white text-xs font-semibold cursor-pointer"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>حوّل لبطاقات مراجعة</span>
                    </button>
                  </div>
                </div>

                {summaryResult.overview && (
                  <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 rounded-xl p-3.5">
                    {summaryResult.overview}
                  </p>
                )}

                <div className="space-y-2.5">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">النقاط الرئيسية للدرس</h3>
                  <ul className="space-y-2">
                    {summaryResult.bulletPoints.map((point, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2.5 rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 p-3 text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed"
                      >
                        <span
                          className="w-6 h-6 rounded-lg text-white flex items-center justify-center text-xs font-bold tabular-nums shrink-0 mt-0.5 accent-btn"
                        >
                          {idx + 1}
                        </span>
                        <span className="flex-1">{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {summaryResult.keyTerms.length > 0 && (
                  <div className="space-y-2.5 pt-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">المفاهيم والمصطلحات المهمة</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {summaryResult.keyTerms.map((item, idx) => (
                        <div
                          key={idx}
                          className="rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 p-3 space-y-1"
                        >
                          <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                            {item.term}
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                            {item.definition}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl bg-white/85 dark:bg-[#0B1020]/85 border border-slate-200 dark:border-white/10 p-8 text-center space-y-3 backdrop-blur-md">
                <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                  <BookOpen className="w-6 h-6" style={{ color: 'var(--accent-primary)' }} />
                </div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                  ملخص الدروس الذكي
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
                  أدخل نص الدرس أو التقط صورة لصفحة الكتاب، وسيلخّصه لك المساعد في نقاط مركزة ومفاهيم أساسية جاهزة للمراجعة.
                </p>
              </div>
            ))}

          {/* MODE 2: FLASHCARDS OUTPUT */}
          {mode === 'flashcards' &&
            (flashcardsResult && currentCard ? (
              <div className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-5 sm:p-6 space-y-5 backdrop-blur-md">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-white/10 pb-3.5">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                      {flashcardsResult.deckTitle}
                    </h2>
                    <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                      البطاقة {activeCardIdx + 1} من {flashcardsResult.cards.length}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleShuffleFlashcards}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
                    >
                      <Shuffle className="w-3.5 h-3.5" />
                      <span>خلط البطاقات</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAllCards((v) => !v)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>{showAllCards ? 'وضع المذاكرة التفاعلي' : 'عرض كل البطاقات'}</span>
                    </button>
                  </div>
                </div>

                {!showAllCards ? (
                  <div className="space-y-4">
                    {/* Interactive Flip Card */}
                    <button
                      type="button"
                      onClick={() => setIsFlipped((v) => !v)}
                      className="w-full min-h-[220px] rounded-2xl p-6 sm:p-8 text-center flex flex-col items-center justify-center gap-4 border-2 transition-all cursor-pointer bg-slate-50 dark:bg-[#060916] hover:border-[var(--accent-primary)] border-slate-200 dark:border-white/15"
                    >
                      <span
                        className="text-xs font-bold uppercase tracking-wide"
                        style={{ color: isFlipped ? '#10b981' : 'var(--accent-text)' }}
                      >
                        {isFlipped ? 'الإجابة' : 'السؤال'}
                      </span>
                      <p className="text-base sm:text-xl font-bold text-slate-900 dark:text-white leading-relaxed max-w-xl">
                        {isFlipped ? currentCard.answer : currentCard.question}
                      </p>
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 pt-2">
                        <RotateCw className="w-3.5 h-3.5" />
                        <span>{isFlipped ? 'اضغط للعودة للسؤال' : 'اضغط لكشف الإجابة'}</span>
                      </span>
                    </button>

                    {/* Hint & Voice Controls */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {currentCard.hint && (
                          <button
                            type="button"
                            onClick={() => setShowHint((v) => !v)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs font-semibold text-amber-800 dark:text-amber-200 cursor-pointer"
                          >
                            <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                            <span>{showHint ? 'إخفاء التلميح' : 'عرض تلميح'}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={loadingTtsId === `card-${activeCardIdx}`}
                          onClick={() =>
                            handleReadAloud(
                              `card-${activeCardIdx}`,
                              `السؤال: ${currentCard.question}. الإجابة: ${currentCard.answer}`
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-white/10 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
                        >
                          {speakingId === `card-${activeCardIdx}` ? (
                            <>
                              <Square className="w-3.5 h-3.5 text-rose-500" />
                              <span>إيقاف</span>
                            </>
                          ) : (
                            <>
                              <Volume2 className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                              <span>قراءة صوتية</span>
                            </>
                          )}
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={activeCardIdx === 0}
                          onClick={() => {
                            setActiveCardIdx((i) => Math.max(0, i - 1));
                            setIsFlipped(false);
                            setShowHint(false);
                          }}
                          className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-xs font-semibold text-slate-800 dark:text-slate-100 disabled:opacity-40 cursor-pointer inline-flex items-center gap-1"
                        >
                          <ChevronRight className="w-4 h-4" />
                          <span>السابقة</span>
                        </button>
                        <button
                          type="button"
                          disabled={activeCardIdx >= flashcardsResult.cards.length - 1}
                          onClick={() => {
                            setActiveCardIdx((i) => Math.min(flashcardsResult.cards.length - 1, i + 1));
                            setIsFlipped(false);
                            setShowHint(false);
                          }}
                          className="accent-btn min-h-[40px] px-3.5 py-1.5 rounded-xl text-white text-xs font-semibold disabled:opacity-40 cursor-pointer inline-flex items-center gap-1"
                        >
                          <span>التالية</span>
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {showHint && currentCard.hint && (
                      <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-800 dark:text-amber-200">
                        <strong>تلميح:</strong> {currentCard.hint}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {flashcardsResult.cards.map((card, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 p-4 space-y-2"
                      >
                        <div className="text-xs font-bold tabular-nums" style={{ color: 'var(--accent-text)' }}>
                          بطاقة #{idx + 1}
                        </div>
                        <div className="text-sm font-bold text-slate-900 dark:text-white leading-relaxed">
                          {card.question}
                        </div>
                        <div className="text-xs text-slate-700 dark:text-slate-300 border-t border-slate-200 dark:border-white/10 pt-2 leading-relaxed">
                          <strong className="text-emerald-600 dark:text-emerald-400">الإجابة: </strong>
                          {card.answer}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl bg-white/85 dark:bg-[#0B1020]/85 border border-slate-200 dark:border-white/10 p-8 text-center space-y-3 backdrop-blur-md">
                <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                  <Layers className="w-6 h-6" style={{ color: 'var(--accent-primary)' }} />
                </div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                  بطاقات المراجعة السريعة
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
                  حوّل أي درس أو صورة كتاب إلى بطاقات سؤال وجواب تفاعلية لاختبار حفظك واستذكار المفاهيم بسرعة.
                </p>
              </div>
            ))}

          {/* MODE 3: HOMEWORK HELPER OUTPUT */}
          {mode === 'homework' &&
            (homeworkResult ? (
              <div className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-5 sm:p-6 space-y-5 backdrop-blur-md">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 dark:border-white/10 pb-4">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold" style={{ color: 'var(--accent-text)' }}>
                      شرح إرشادي خطوة بخطوة
                    </div>
                    <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
                      {homeworkResult.title}
                    </h2>
                  </div>

                  <button
                    type="button"
                    disabled={loadingTtsId === 'hw-read'}
                    onClick={() =>
                      handleReadAloud(
                        'hw-read',
                        `${homeworkResult.title}. الفكرة الأساسية: ${homeworkResult.concept}. الخطوات: ${homeworkResult.steps.join('. ')}. ${homeworkResult.nextCheckQuestion}`
                      )
                    }
                    className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer"
                  >
                    {speakingId === 'hw-read' ? (
                      <>
                        <Square className="w-3.5 h-3.5 text-rose-500" />
                        <span>إيقاف القراءة</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                        <span>{loadingTtsId === 'hw-read' ? 'جاري التحميل...' : 'قراءة الشرح صوتيًا'}</span>
                      </>
                    )}
                  </button>
                </div>

                {homeworkResult.concept && (
                  <div className="rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 p-3.5 space-y-1">
                    <div className="text-xs font-bold text-slate-900 dark:text-white">الفكرة والقانون المستخدم:</div>
                    <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                      {homeworkResult.concept}
                    </p>
                  </div>
                )}

                <div className="space-y-2.5">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">خطوات الحل</h3>
                  <ol className="space-y-2.5">
                    {homeworkResult.steps.map((step, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-3 rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 p-3.5 text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed"
                      >
                        <span className="accent-btn w-6 h-6 rounded-lg text-white flex items-center justify-center text-xs font-bold tabular-nums shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <span className="flex-1">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                {homeworkResult.hint && (
                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3.5 text-xs sm:text-sm text-amber-800 dark:text-amber-200 leading-relaxed flex items-start gap-2.5">
                    <Lightbulb className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <strong>تلميح مساعد: </strong>
                      {homeworkResult.hint}
                    </div>
                  </div>
                )}

                {homeworkResult.nextCheckQuestion && (
                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3.5 text-xs sm:text-sm text-emerald-800 dark:text-emerald-200 leading-relaxed">
                    <strong>خطوتك التالية لإكمال الحل: </strong>
                    {homeworkResult.nextCheckQuestion}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl bg-white/85 dark:bg-[#0B1020]/85 border border-slate-200 dark:border-white/10 p-8 text-center space-y-3 backdrop-blur-md">
                <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                  <ListChecks className="w-6 h-6" style={{ color: 'var(--accent-primary)' }} />
                </div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                  مساعد الواجبات بالشرح المتدرج
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
                  اكتب سؤال الواجب أو أرفق صورته، وسيشرح لك المساعد طريقة الحل خطوة بخطوة مع تلميحات ذكية حتى تصل للإجابة بنفسك.
                </p>
              </div>
            ))}
        </div>
      </div>

      {cameraTarget && (
        <CameraCaptureModal
          onClose={() => setCameraTarget(null)}
          onAttach={(img) => {
            if (cameraTarget === 'lesson') setLessonImage(img);
            else setHwImage(img);
            setError(null);
          }}
          onAnalyzeNow={(img) => {
            if (cameraTarget === 'lesson') setLessonImage(img);
            else setHwImage(img);
            setError(null);
          }}
        />
      )}
    </div>
  );
}
