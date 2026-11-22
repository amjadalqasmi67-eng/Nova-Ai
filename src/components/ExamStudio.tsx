import { useState, FormEvent } from 'react';
import { User } from 'firebase/auth';
import {
  ClipboardCheck,
  BookOpenCheck,
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RotateCcw,
  Download,
  Printer,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  SlidersHorizontal,
  RefreshCw,
} from 'lucide-react';
import { getOtpHeaders } from '../lib/otpSession';
import { postNdjsonOrJson } from '../lib/ndjsonFetch';
import { safeHttpUrl, sanitizeUserText } from '../lib/sanitize';
import { saveStudyHistoryEntry } from '../lib/studyHistory';

interface ExamStudioProps {
  user: User;
}

interface ExamQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  lessonRef: string;
}

interface BookSource {
  title: string;
  url: string;
}

interface GeneratedExam {
  examTitle: string;
  curriculum: string;
  subjectGrade: string;
  lessonSummary: string;
  questions: ExamQuestion[];
  bookSources: BookSource[];
}

const OPTION_LETTERS = ['أ', 'ب', 'ج', 'د'] as const;

const CURRICULUM_OPTIONS = [
  'المناهج العُمانية (المكتبة الإلكترونية)',
  'المناهج السعودية (بوابة عين / كتبي)',
  'المناهج الإماراتية (الكتاب المدرسي)',
  'المناهج الكويتية (وزارة التربية)',
  'المناهج القطرية (وزارة التعليم)',
  'المناهج المصرية (وزارة التربية والتعليم)',
  'المناهج الأردنية (المكتبة الرقمية)',
  'منهج عربي / دولي عام',
];

const QUICK_STARTERS: Array<{
  label: string;
  subjectGrade: string;
  lessonOrPages: string;
  count: number;
}> = [
  {
    label: 'رياضيات · التاسع',
    subjectGrade: 'الرياضيات - الصف التاسع',
    lessonOrPages: 'تحليل العبارات التربيعية والمعادلات (الصفحات 24 إلى 35)',
    count: 5,
  },
  {
    label: 'علوم / أحياء · العاشر',
    subjectGrade: 'الأحياء - الصف العاشر',
    lessonOrPages: 'الخلية والانقسام الخلوي (الوحدة الأولى)',
    count: 8,
  },
  {
    label: 'لغة عربية · الثامن',
    subjectGrade: 'اللغة العربية - الصف الثامن',
    lessonOrPages: 'الجملة الاسمية والفعلية والنواسخ',
    count: 10,
  },
];

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function ExamStudio({ user }: ExamStudioProps) {
  const [curriculum, setCurriculum] = useState(CURRICULUM_OPTIONS[0]);
  const [subjectGrade, setSubjectGrade] = useState('');
  const [lessonOrPages, setLessonOrPages] = useState('');
  const [lessonContent, setLessonContent] = useState('');
  const [questionCount, setQuestionCount] = useState(5);
  const [difficulty, setDifficulty] = useState<'mixed' | 'easy' | 'medium' | 'hard'>('mixed');
  const [sourceUrl, setSourceUrl] = useState('');

  const [generating, setGenerating] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exam, setExam] = useState<GeneratedExam | null>(null);

  const [viewMode, setViewMode] = useState<'interactive' | 'sheet'>('interactive');
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [includeAnswerKey, setIncludeAnswerKey] = useState(true);

  const triggerGenerate = async () => {
    const cleanSubject = sanitizeUserText(subjectGrade, 180, false);
    const cleanLesson = sanitizeUserText(lessonOrPages, 800);
    const cleanLessonContent = sanitizeUserText(lessonContent, 8000);
    const cleanSource = sourceUrl.trim() ? safeHttpUrl(sourceUrl) : '';
    if (!cleanSubject || !cleanLesson || generating) return;
    if (sourceUrl.trim() && !cleanSource) {
      setError('رابط صفحة الكتاب غير صالح. يجب أن يبدأ بـ https:// أو http://.');
      return;
    }

    setGenerating(true);
    setStatusText('جاري التحقق من محتوى الدرس في المكتبة الإلكترونية...');
    setError(null);

    try {
      const idToken = await user.getIdToken();
      const data = await postNdjsonOrJson<GeneratedExam>('/api/nova/generate-exam', {
        headers: {
          Authorization: `Bearer ${idToken}`,
          ...getOtpHeaders(),
        },
        body: {
          curriculum,
          subjectGrade: cleanSubject,
          lessonOrPages: cleanLesson,
          lessonContent: cleanLessonContent,
          questionCount,
          difficulty,
          sourceUrl: cleanSource || '',
        },
        onStatus: (msg) => setStatusText(msg),
      });

      if (!Array.isArray(data.questions) || data.questions.length === 0) {
        throw new Error('تعذر إنشاء الاختبار حاليًا. يرجى المحاولة مجددًا.');
      }

      setExam(data);
      setSelectedAnswers({});
      setIsSubmitted(false);
      setViewMode('interactive');

      const formattedExam = [
        data.lessonSummary ? `${data.lessonSummary}\n` : '',
        '### أسئلة الاختبار:',
        ...data.questions.map(
          (q, idx) =>
            `${idx + 1}. **${q.question}**\n- الإجابة الصحيحة: ${q.options[q.correctIndex] || q.options[0]}`
        ),
      ]
        .filter(Boolean)
        .join('\n');

      saveStudyHistoryEntry({
        userId: user.uid,
        type: 'exam',
        title: data.examTitle,
        subject: data.subjectGrade,
        inputPreview: cleanLesson.slice(0, 180),
        content: formattedExam,
        itemCount: data.questions.length,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء الاتصال بخادم المناهج.');
    } finally {
      setGenerating(false);
      setStatusText('');
    }
  };

  const handleGenerate = async (e: FormEvent) => {
    e.preventDefault();
    await triggerGenerate();
  };

  const handleSelectOption = (qIdx: number, optIdx: number) => {
    if (isSubmitted) return;
    setSelectedAnswers((prev) => ({ ...prev, [qIdx]: optIdx }));
  };

  const handleResetAttempt = () => {
    setSelectedAnswers({});
    setIsSubmitted(false);
  };

  const handleDownloadHtml = () => {
    if (!exam) return;
    const questionsHtml = exam.questions
      .map((q, qIdx) => {
        const optionsHtml = q.options
          .slice(0, 4)
          .map((opt, optIdx) => {
            const isCorrect = includeAnswerKey && optIdx === q.correctIndex;
            return `<li style="margin:6px 0;padding:8px 12px;border:1px solid ${
              isCorrect ? '#10b981' : '#cbd5e1'
            };border-radius:8px;background:${isCorrect ? '#ecfdf5' : '#ffffff'};list-style:none;">
              <strong>(${OPTION_LETTERS[optIdx]})</strong> ${escapeHtml(opt)}
              ${isCorrect ? ' <span style="color:#047857;font-weight:700;">[الإجابة الصحيحة]</span>' : ''}
            </li>`;
          })
          .join('');

        return `<section style="margin-bottom:20px;padding:16px;border:1px solid #cbd5e1;border-radius:12px;page-break-inside:avoid;">
          <div style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:8px;">
            ${qIdx + 1}. ${escapeHtml(q.question)}
          </div>
          <ul style="margin:0;padding:0;">${optionsHtml}</ul>
          ${
            includeAnswerKey
              ? `<div style="margin-top:10px;font-size:13px;color:#334155;background:#f8fafc;padding:8px 10px;border-radius:8px;">
                  <strong>المرجع:</strong> ${escapeHtml(q.lessonRef)} — <strong>التوضيح:</strong> ${escapeHtml(q.explanation)}
                </div>`
              : `<div style="margin-top:8px;font-size:12px;color:#64748b;">المرجع: ${escapeHtml(q.lessonRef)}</div>`
          }
        </section>`;
      })
      .join('');

    const htmlDoc = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(exam.examTitle)}</title>
  <style>
    body { font-family: Tahoma, Arial, sans-serif; color: #0f172a; max-width: 820px; margin: 28px auto; padding: 0 20px; line-height: 1.7; }
    h1 { font-size: 22px; margin: 0 0 6px; }
    .meta { color: #475569; font-size: 13px; margin-bottom: 16px; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; }
    .summary { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; font-size: 13px; margin-bottom: 22px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(exam.examTitle)}</h1>
  <div class="meta">
    ${escapeHtml(exam.curriculum)} · ${escapeHtml(exam.subjectGrade)} · عدد الأسئلة: ${exam.questions.length} · أربعة خيارات لكل سؤال
  </div>
  <div class="summary">${escapeHtml(exam.lessonSummary)}</div>
  ${questionsHtml}
  <p style="margin-top:20px;padding:12px 14px;border:1px solid #f59e0b;border-radius:10px;background:#fffbeb;color:#92400e;font-size:13px;font-weight:700;">
    راجع الإجابات قبل استخدامها، فقد يخطئ الذكاء الاصطناعي.
  </p>
</body>
</html>`;

    const blob = new Blob([htmlDoc], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${exam.subjectGrade.replace(/[^\p{L}\p{N}_-]+/gu, '_')}_اختبار.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const totalQuestions = exam?.questions.length ?? 0;
  const answeredCount = exam
    ? exam.questions.filter((_, idx) => typeof selectedAnswers[idx] === 'number').length
    : 0;
  const correctCount = exam
    ? exam.questions.filter((q, idx) => selectedAnswers[idx] === q.correctIndex).length
    : 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto max-w-6xl w-full mx-auto px-3.5 sm:px-6 py-5 sm:py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <ClipboardCheck className="w-6 h-6" style={{ color: 'var(--accent-primary)' }} />
            <span>صانع الاختبارات المدرسية الذكي</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
            يسترجع Nova AI محتوى الدرس والصفحات من المكتبة الإلكترونية والكتاب المدرسي، ويبني اختبارًا بعدد الأسئلة الذي تختاره مع أربعة خيارات ثابتة تحت كل سؤال.
          </p>
        </div>

        {exam && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadHtml}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-slate-900 dark:text-white text-xs sm:text-sm font-semibold whitespace-nowrap cursor-pointer border border-slate-200 dark:border-white/10"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>حفظ ورقة الاختبار</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="accent-btn inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl text-white text-xs sm:text-sm font-semibold whitespace-nowrap cursor-pointer"
            >
              <Printer className="w-4 h-4 shrink-0" />
              <span>طباعة الاختبار</span>
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Zone: Curriculum & Exam Configuration */}
        <form
          onSubmit={handleGenerate}
          className="lg:col-span-5 rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-6 space-y-4 backdrop-blur-md print:hidden"
        >
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-white/10">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
              <BookOpenCheck className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <span>إعدادات الكتاب والمنهج</span>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
              4 خيارات ثابتة لكل سؤال
            </span>
          </div>

          {/* Quick Starters */}
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">أمثلة سريعة:</div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_STARTERS.map((starter) => (
                <button
                  key={starter.label}
                  type="button"
                  onClick={() => {
                    setSubjectGrade(starter.subjectGrade);
                    setLessonOrPages(starter.lessonOrPages);
                    setQuestionCount(starter.count);
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-white/10 whitespace-nowrap cursor-pointer transition-colors"
                >
                  {starter.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="exam-curriculum" className="block text-xs sm:text-sm font-bold text-slate-900 dark:text-white mb-1.5">
              المكتبة الإلكترونية / المنهج الدراسي
            </label>
            <select
              id="exam-curriculum"
              value={curriculum}
              onChange={(e) => setCurriculum(e.target.value)}
              className="accent-focus w-full rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none"
            >
              {CURRICULUM_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="exam-subject" className="block text-xs sm:text-sm font-bold text-slate-900 dark:text-white mb-1.5">
              المادة والصف الدراسي
            </label>
            <input
              id="exam-subject"
              type="text"
              required
              value={subjectGrade}
              onChange={(e) => setSubjectGrade(e.target.value)}
              placeholder="مثال: رياضيات الصف التاسع"
              className="accent-focus w-full rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="exam-lesson" className="block text-xs sm:text-sm font-bold text-slate-900 dark:text-white mb-1.5">
              اسم الدرس أو أرقام الصفحات في الكتاب
            </label>
            <textarea
              id="exam-lesson"
              rows={3}
              required
              value={lessonOrPages}
              onChange={(e) => setLessonOrPages(e.target.value)}
              placeholder="مثال: درس المعادلات التربيعية من صفحة 24 إلى 32 (الفصل الأول)"
              className="accent-focus w-full rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none resize-y"
            />
          </div>

          {/* Exact Question Count Selector */}
          <div className="rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="exam-count-input" className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                عدد أسئلة الاختبار
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id="exam-count-input"
                  type="number"
                  min={3}
                  max={25}
                  value={questionCount}
                  onChange={(e) => {
                    const val = Math.min(25, Math.max(3, Number(e.target.value) || 3));
                    setQuestionCount(val);
                  }}
                  className="accent-focus w-16 text-center rounded-lg bg-white dark:bg-[#0B1020] border border-slate-200 dark:border-white/15 px-2 py-1 text-sm font-bold text-slate-900 dark:text-white tabular-nums focus:outline-none"
                />
                <span className="text-xs text-slate-500 dark:text-slate-400">سؤال</span>
              </div>
            </div>

            <input
              type="range"
              min={3}
              max={25}
              value={questionCount}
              aria-label="تحديد عدد الأسئلة"
              onChange={(e) => setQuestionCount(Number(e.target.value))}
              className="w-full accent-[var(--accent-primary)] cursor-pointer"
            />

            <div className="flex items-center justify-between gap-1.5 pt-0.5">
              {[5, 10, 15, 20].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setQuestionCount(preset)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold tabular-nums whitespace-nowrap cursor-pointer border transition-colors ${
                    questionCount === preset
                      ? 'accent-active-tab text-slate-900 dark:text-white'
                      : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
                  }`}
                >
                  {preset} أسئلة
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="exam-difficulty" className="block text-xs font-bold text-slate-900 dark:text-white mb-1.5">
                مستوى الصعوبة
              </label>
              <select
                id="exam-difficulty"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as 'mixed' | 'easy' | 'medium' | 'hard')}
                className="accent-focus w-full rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15 px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none"
              >
                <option value="mixed">متدرج ومتنوع</option>
                <option value="easy">أساسي ومباشر</option>
                <option value="medium">متوسط</option>
                <option value="hard">تحدي ومهارات عليا</option>
              </select>
            </div>

            <div>
              <label htmlFor="exam-source-url" className="block text-xs font-bold text-slate-900 dark:text-white mb-1.5">
                رابط صفحة الكتاب (اختياري)
              </label>
              <input
                id="exam-source-url"
                type="url"
                dir="ltr"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://ict.moe.gov.om/..."
                className="accent-focus w-full rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15 px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="exam-lesson-content" className="block text-xs font-bold text-slate-900 dark:text-white mb-1.5">
              نص الدرس أو ملخصه (اختياري)
            </label>
            <textarea
              id="exam-lesson-content"
              rows={3}
              maxLength={8000}
              value={lessonContent}
              onChange={(e) => setLessonContent(e.target.value)}
              placeholder="الصق هنا نص الدرس أو النقاط الأساسية إذا تعذرت قراءة الكتاب تلقائيًا من المكتبة أو كان بصيغة PDF..."
              className="accent-focus w-full rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none resize-y"
            />
          </div>

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
                onClick={() => triggerGenerate()}
                disabled={generating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer shrink-0 disabled:opacity-50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>إعادة المحاولة</span>
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={generating || !subjectGrade.trim() || !lessonOrPages.trim()}
            className="accent-btn w-full min-h-[44px] py-3 px-4 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4 shrink-0" />
            <span>
              {generating
                ? statusText || 'جاري البحث في المكتبة الإلكترونية وبناء الاختبار...'
                : `إنشاء اختبار من ${questionCount} أسئلة`}
            </span>
          </button>
        </form>

        {/* Right Zone: Generated Exam & Interactive Solver */}
        <div className="lg:col-span-7 space-y-4">
          {!exam ? (
            <div className="rounded-2xl bg-white/85 dark:bg-[#0B1020]/85 border border-slate-200 dark:border-white/10 p-6 sm:p-10 text-center space-y-3 backdrop-blur-md">
              <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                <FileText className="w-6 h-6" style={{ color: 'var(--accent-primary)' }} />
              </div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                منصة الاختبارات المرتبطة بالمكتبة الإلكترونية
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-lg mx-auto leading-relaxed">
                حدّد المنهج والمادة والصف واسم الدرس أو الصفحات وعدد الأسئلة المطلوب. سيقوم النظام بالبحث في المكتبة الإلكترونية واستخراج محتوى الدرس، ثم يعرض كل سؤال وتحته أربعة خيارات ثابتة جاهزة للحل الفوري أو الطباعة.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Exam Meta & View Controls */}
              <div className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-5 space-y-3 backdrop-blur-md">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
                      {exam.examTitle}
                    </h2>
                    <div className="text-xs text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span>{exam.curriculum}</span>
                      <span>·</span>
                      <span>{exam.subjectGrade}</span>
                      <span>·</span>
                      <span className="tabular-nums font-semibold">{totalQuestions} سؤالًا</span>
                      <span>·</span>
                      <span>4 خيارات ثابتة</span>
                    </div>
                  </div>

                  {/* Mode Switcher */}
                  <div className="flex items-center gap-1.5 print:hidden">
                    <button
                      type="button"
                      onClick={() => setViewMode('interactive')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer border transition-colors ${
                        viewMode === 'interactive'
                          ? 'accent-active-tab text-slate-900 dark:text-white'
                          : 'bg-slate-100 dark:bg-white/5 border-transparent text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      حل تفاعلي
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('sheet')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer border transition-colors ${
                        viewMode === 'sheet'
                          ? 'accent-active-tab text-slate-900 dark:text-white'
                          : 'bg-slate-100 dark:bg-white/5 border-transparent text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      ورقة الاختبار
                    </button>
                  </div>
                </div>

                {/* Lesson Brief Retrieved from Library */}
                <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 rounded-xl p-3">
                  {exam.lessonSummary}
                </p>

                {/* Grounded Library Sources */}
                {exam.bookSources.length > 0 && (
                  <div className="space-y-1.5 pt-1 print:hidden">
                    <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                      مراجع المكتبة الإلكترونية والكتاب المدرسي:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {exam.bookSources.map((src) => {
                        const safeHref = safeHttpUrl(src.url);
                        if (!safeHref) return null;
                        return (
                          <a
                            key={safeHref}
                            href={safeHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-xs text-slate-700 dark:text-slate-200 transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent-primary)' }} />
                            <span className="truncate max-w-[210px]">{src.title}</span>
                          </a>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Sheet Answer Key Toggle or Interactive Score Bar */}
                {viewMode === 'sheet' ? (
                  <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-white/10 print:hidden">
                    <span className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>إعداد عرض الورقة للطلاب أو المعلم</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setIncludeAnswerKey((v) => !v)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-xs font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap cursor-pointer"
                    >
                      {includeAnswerKey ? (
                        <>
                          <Eye className="w-3.5 h-3.5" />
                          <span>مفتاح الإجابة ظاهر</span>
                        </>
                      ) : (
                        <>
                          <EyeOff className="w-3.5 h-3.5" />
                          <span>ورقة أسئلة بدون حل</span>
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-white/10">
                    {isSubmitted ? (
                      <>
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white tabular-nums">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                          <span>
                            النتيجة: {correctCount} من {totalQuestions} ({Math.round((correctCount / totalQuestions) * 100)}%)
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={handleResetAttempt}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-xs font-semibold text-slate-900 dark:text-white whitespace-nowrap cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>إعادة المحاولة</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                          تم اختيار إجابة {answeredCount} من {totalQuestions} سؤالًا
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsSubmitted(true)}
                          disabled={answeredCount === 0}
                          className="accent-btn px-4 py-2 rounded-xl text-white text-xs sm:text-sm font-semibold whitespace-nowrap cursor-pointer disabled:opacity-50"
                        >
                          تصحيح الاختبار وعرض النتيجة
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Questions List: Always Prompt on Top + 4 Fixed Choices Directly Underneath */}
              <div className="space-y-4">
                {exam.questions.map((q, qIdx) => {
                  const chosenIdx = selectedAnswers[qIdx];
                  const isCorrectChoice = chosenIdx === q.correctIndex;
                  const fixedFour = q.options.slice(0, 4);

                  return (
                    <article
                      key={`${qIdx}-${q.question.slice(0, 24)}`}
                      className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-5 space-y-3.5 backdrop-blur-md"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-relaxed">
                          <span className="tabular-nums ml-1.5" style={{ color: 'var(--accent-primary)' }}>
                            {qIdx + 1}.
                          </span>
                          {q.question}
                        </h3>

                        {viewMode === 'interactive' && isSubmitted && (
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 border ${
                              isCorrectChoice
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                                : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                            }`}
                          >
                            {isCorrectChoice ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>إجابة صحيحة</span>
                              </>
                            ) : (
                              <>
                                <XCircle className="w-3.5 h-3.5" />
                                <span>إجابة غير صحيحة</span>
                              </>
                            )}
                          </span>
                        )}
                      </div>

                      {/* 4 Fixed Vertical Options Directly Underneath the Question */}
                      <div className="space-y-2">
                        {fixedFour.map((optText, optIdx) => {
                          const letter = OPTION_LETTERS[optIdx];
                          const isSelected = chosenIdx === optIdx;
                          const isRight = q.correctIndex === optIdx;

                          let optionClass =
                            'bg-slate-50 dark:bg-[#060916] border-slate-200 dark:border-white/10 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10';

                          if (viewMode === 'sheet') {
                            if (includeAnswerKey && isRight) {
                              optionClass =
                                'bg-emerald-500/10 border-emerald-500/45 text-emerald-800 dark:text-emerald-200 font-semibold';
                            } else {
                              optionClass =
                                'bg-slate-50 dark:bg-[#060916] border-slate-200 dark:border-white/10 text-slate-800 dark:text-slate-200';
                            }
                          } else if (isSubmitted) {
                            if (isRight) {
                              optionClass =
                                'bg-emerald-500/15 border-emerald-500/50 text-emerald-900 dark:text-emerald-100 font-semibold';
                            } else if (isSelected && !isRight) {
                              optionClass =
                                'bg-rose-500/15 border-rose-500/50 text-rose-900 dark:text-rose-100';
                            } else {
                              optionClass =
                                'bg-slate-50/60 dark:bg-[#060916]/60 border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400';
                            }
                          } else if (isSelected) {
                            optionClass = 'accent-active-tab text-slate-900 dark:text-white font-semibold';
                          }

                          return (
                            <button
                              key={`${qIdx}-${optIdx}`}
                              type="button"
                              disabled={viewMode === 'sheet' || isSubmitted}
                              onClick={() => handleSelectOption(qIdx, optIdx)}
                              className={`w-full min-h-[44px] text-right flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm transition-colors ${
                                viewMode === 'interactive' && !isSubmitted ? 'cursor-pointer' : 'cursor-default'
                              } ${optionClass}`}
                            >
                              <span className="flex items-center gap-3 min-w-0">
                                <span className="w-7 h-7 rounded-lg bg-white dark:bg-[#0B1020] border border-slate-200 dark:border-white/15 flex items-center justify-center text-xs font-bold shrink-0">
                                  {letter}
                                </span>
                                <span className="leading-relaxed">{optText}</span>
                              </span>

                              {((viewMode === 'interactive' && isSubmitted) || (viewMode === 'sheet' && includeAnswerKey)) &&
                                isRight && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                              {viewMode === 'interactive' && isSubmitted && isSelected && !isRight && (
                                <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* Lesson Reference & Explanation */}
                      {((viewMode === 'interactive' && isSubmitted) || (viewMode === 'sheet' && includeAnswerKey)) && (
                        <div className="rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 p-3 text-xs text-slate-700 dark:text-slate-300 space-y-1">
                          <div>
                            <strong className="text-slate-900 dark:text-white">مرجع الكتاب / الدرس:</strong> {q.lessonRef}
                          </div>
                          <div>
                            <strong className="text-slate-900 dark:text-white">التوضيح:</strong> {q.explanation}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}

                {/* Fixed AI Accuracy Disclaimer Directly Underneath Exam Questions */}
                <div
                  role="note"
                  className="rounded-xl bg-amber-500/10 border border-amber-500/35 px-4 py-3 text-xs sm:text-sm font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-2.5"
                >
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>راجع الإجابات قبل استخدامها، فقد يخطئ الذكاء الاصطناعي.</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
