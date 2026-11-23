import { useState } from 'react';
import {
  Presentation,
  Download,
  FileDown,
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Eye,
  EyeOff,
  ExternalLink,
  AlertCircle,
  BookOpen,
  Layers,
  RotateCw,
  ChevronRight,
  ChevronLeft,
  Lightbulb,
  Shuffle,
  Copy,
  Check,
  List,
} from 'lucide-react';
import { PptxVisualTheme, exportDeckToPptx } from '../lib/pptxBuilder';
import { exportDeckToPdf } from '../lib/pdfExport';
import { safeHttpUrl } from '../lib/sanitize';
import { InteractiveSlideWhiteboard } from './InteractiveSlideWhiteboard';
import type { ChatToolPayload } from '../lib/chatToolPayload';

interface ChatToolOutputCardProps {
  payload: ChatToolPayload;
  onError?: (msg: string) => void;
}

const OPTION_LETTERS = ['أ', 'ب', 'ج', 'د'] as const;

const THEME_OPTIONS: Array<{ id: PptxVisualTheme; label: string; color: string }> = [
  { id: 'cosmos', label: 'فضائي داكن', color: '#8b5cf6' },
  { id: 'executive-blue', label: 'أزرق احترافي', color: '#3b82f6' },
  { id: 'emerald-modern', label: 'أخضر حديث', color: '#10b981' },
  { id: 'clean-light', label: 'كلاسيكي فاتح', color: '#f8fafc' },
];

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ChatToolOutputCard({ payload, onError }: ChatToolOutputCardProps) {
  if (payload.tool === 'presentation') {
    return <InlinePresentationCard payload={payload} onError={onError} />;
  }
  if (payload.tool === 'exam') {
    return <InlineExamCard payload={payload} />;
  }
  if (payload.tool === 'summary') {
    return <InlineSummaryCard payload={payload} />;
  }
  return <InlineFlashcardsCard payload={payload} />;
}

function InlinePresentationCard({
  payload,
  onError,
}: {
  payload: Extract<ChatToolPayload, { tool: 'presentation' }>;
  onError?: (msg: string) => void;
}) {
  const [visualTheme, setVisualTheme] = useState<PptxVisualTheme>(payload.visualTheme || 'cosmos');
  const [downloadingPptx, setDownloadingPptx] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [viewMode, setViewMode] = useState<'whiteboard' | 'outline'>('whiteboard');
  const [replayNonce, setReplayNonce] = useState(1);

  const deck = payload.deck;
  const lang = payload.language || deck.language || 'ar';

  const handleDownloadPptx = async () => {
    if (downloadingPptx || downloadingPdf) return;
    setDownloadingPptx(true);
    try {
      await exportDeckToPptx(deck, visualTheme, lang);
    } catch {
      onError?.('تعذر تصدير ملف PowerPoint حاليًا. يرجى المحاولة مجددًا.');
    } finally {
      setDownloadingPptx(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (downloadingPptx || downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      await exportDeckToPdf(deck, visualTheme, lang);
    } catch {
      onError?.('تعذر تصدير ملف PDF للعرض حاليًا. يرجى المحاولة مجددًا.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-slate-200 dark:border-white/15 bg-slate-50/90 dark:bg-[#0B1124] p-3.5 sm:p-4 space-y-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 dark:border-white/10 pb-3">
        <div className="space-y-1 min-w-0">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--accent-text)' }}>
            <Presentation className="w-3.5 h-3.5 shrink-0" />
            <span>صانع العروض التقديمية · {deck.slides.length} شرائح</span>
          </div>
          <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-snug">
            {deck.deckTitle}
          </h3>
          {deck.deckSubtitle && (
            <p className="text-xs text-slate-600 dark:text-slate-400">{deck.deckSubtitle}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadPptx}
            disabled={downloadingPptx || downloadingPdf}
            className="accent-btn inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-2 rounded-xl text-white text-xs font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>{downloadingPptx ? 'جاري التصدير...' : 'تحميل PowerPoint (.pptx)'}</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={downloadingPptx || downloadingPdf}
            className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-2 rounded-xl bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/15 hover:border-slate-300 dark:hover:border-white/30 text-slate-800 dark:text-slate-100 text-xs font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            <FileDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent-primary)' }} />
            <span>{downloadingPdf ? 'جاري تجهيز PDF...' : 'تحميل PDF'}</span>
          </button>
        </div>
      </div>

      {/* Theme & View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {THEME_OPTIONS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setVisualTheme(t.id);
                setReplayNonce((n) => n + 1);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border cursor-pointer transition-colors ${
                visualTheme === t.id
                  ? 'accent-active-tab text-slate-900 dark:text-white font-semibold'
                  : 'bg-white dark:bg-[#060916] border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300'
              }`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full border border-black/15 shrink-0"
                style={{ backgroundColor: t.color }}
              />
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setViewMode((m) => (m === 'whiteboard' ? 'outline' : 'whiteboard'))}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/10 text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
        >
          <List className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
          <span>{viewMode === 'whiteboard' ? 'عرض قائمة الشرائح' : 'معاينة اللوحة التفاعلية'}</span>
        </button>
      </div>

      {viewMode === 'whiteboard' ? (
        <InteractiveSlideWhiteboard
          slides={deck.slides}
          totalExpected={deck.slides.length}
          isGenerating={false}
          visualTheme={visualTheme}
          language={lang}
          deckTitle={deck.deckTitle}
          deckSubtitle={deck.deckSubtitle}
          replayNonce={replayNonce}
        />
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-0.5">
          {deck.slides.map((s, idx) => (
            <div
              key={`${idx}-${s.title}`}
              className="rounded-xl bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/10 p-3 space-y-1.5"
            >
              <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                <span className="tabular-nums ml-1" style={{ color: 'var(--accent-primary)' }}>
                  {idx + 1}.
                </span>
                {s.title}
              </div>
              {s.bullets.length > 0 && (
                <ul className="list-disc list-inside space-y-1 text-xs text-slate-700 dark:text-slate-300">
                  {s.bullets.map((b, bi) => (
                    <li key={bi}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InlineExamCard({
  payload,
}: {
  payload: Extract<ChatToolPayload, { tool: 'exam' }>;
}) {
  const exam = payload.exam;
  const [viewMode, setViewMode] = useState<'interactive' | 'sheet'>('interactive');
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [includeAnswerKey, setIncludeAnswerKey] = useState(false);

  const totalQuestions = exam.questions.length;
  const answeredCount = exam.questions.filter((_, idx) => typeof selectedAnswers[idx] === 'number').length;
  const correctCount = exam.questions.filter((q, idx) => selectedAnswers[idx] === q.correctIndex).length;

  const handleDownloadHtml = () => {
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

        return `<section style="margin-bottom:18px;padding:14px;border:1px solid #cbd5e1;border-radius:12px;page-break-inside:avoid;">
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
  </style>
</head>
<body>
  <h1>${escapeHtml(exam.examTitle)}</h1>
  <div class="meta">${escapeHtml(exam.curriculum)} · ${escapeHtml(exam.subjectGrade)} · ${totalQuestions} أسئلة</div>
  ${questionsHtml}
  <p style="margin-top:18px;padding:12px;border:1px solid #f59e0b;border-radius:10px;background:#fffbeb;color:#92400e;font-size:13px;font-weight:700;">
    راجع الإجابات قبل استخدامها، فقد يخطئ الذكاء الاصطناعي.
  </p>
</body>
</html>`;

    const safeName = exam.subjectGrade.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'nova';
    downloadTextFile(`${safeName}_اختبار.html`, htmlDoc, 'text/html;charset=utf-8');
  };

  return (
    <div className="mt-3 rounded-xl border border-slate-200 dark:border-white/15 bg-slate-50/90 dark:bg-[#0B1124] p-3.5 sm:p-4 space-y-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2.5 border-b border-slate-200 dark:border-white/10 pb-3">
        <div className="space-y-1 min-w-0">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--accent-text)' }}>
            <ClipboardCheck className="w-3.5 h-3.5 shrink-0" />
            <span>صانع الاختبارات · {totalQuestions} أسئلة (4 خيارات)</span>
          </div>
          <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-snug">
            {exam.examTitle}
          </h3>
          <div className="text-xs text-slate-600 dark:text-slate-400">
            {exam.curriculum} · {exam.subjectGrade}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleDownloadHtml}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/15 hover:border-slate-300 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
            <span>حفظ ورقة الاختبار</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode((m) => (m === 'interactive' ? 'sheet' : 'interactive'))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/15 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer whitespace-nowrap"
          >
            <span>{viewMode === 'interactive' ? 'عرض كورقة أسئلة' : 'العودة للحل التفاعلي'}</span>
          </button>
        </div>
      </div>

      {exam.lessonSummary && (
        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/10 rounded-xl p-2.5">
          {exam.lessonSummary}
        </p>
      )}

      {viewMode === 'sheet' ? (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-slate-600 dark:text-slate-400">وضع الورقة المطبوعة / الحفظ</span>
          <button
            type="button"
            onClick={() => setIncludeAnswerKey((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/15 text-xs font-semibold cursor-pointer"
          >
            {includeAnswerKey ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>{includeAnswerKey ? 'إخفاء الحل' : 'إظهار مفتاح الحل'}</span>
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/10 px-3 py-2">
          {isSubmitted ? (
            <>
              <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-900 dark:text-white tabular-nums">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>
                  النتيجة: {correctCount} من {totalQuestions} ({Math.round((correctCount / totalQuestions) * 100)}%)
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedAnswers({});
                  setIsSubmitted(false);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/10 text-xs font-semibold cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>إعادة المحاولة</span>
              </button>
            </>
          ) : (
            <>
              <span className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                أُجيب عن {answeredCount} من {totalQuestions}
              </span>
              <button
                type="button"
                onClick={() => setIsSubmitted(true)}
                disabled={answeredCount === 0}
                className="accent-btn px-3.5 py-1.5 rounded-lg text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                تصحيح وعرض النتيجة
              </button>
            </>
          )}
        </div>
      )}

      <div className="space-y-3">
        {exam.questions.map((q, qIdx) => {
          const chosenIdx = selectedAnswers[qIdx];
          const fixedFour = q.options.slice(0, 4);

          return (
            <div
              key={`${qIdx}-${q.question.slice(0, 20)}`}
              className="rounded-xl bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/10 p-3 sm:p-3.5 space-y-2.5"
            >
              <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white leading-relaxed">
                <span className="tabular-nums ml-1.5" style={{ color: 'var(--accent-primary)' }}>
                  {qIdx + 1}.
                </span>
                {q.question}
              </div>

              <div className="space-y-1.5">
                {fixedFour.map((optText, optIdx) => {
                  const isSelected = chosenIdx === optIdx;
                  const isRight = q.correctIndex === optIdx;
                  let optStyle =
                    'bg-slate-50 dark:bg-[#0B1124] border-slate-200 dark:border-white/10 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5';

                  if (viewMode === 'sheet') {
                    if (includeAnswerKey && isRight) {
                      optStyle =
                        'bg-emerald-500/10 border-emerald-500/45 text-emerald-800 dark:text-emerald-200 font-semibold';
                    }
                  } else if (isSubmitted) {
                    if (isRight) {
                      optStyle =
                        'bg-emerald-500/15 border-emerald-500/50 text-emerald-900 dark:text-emerald-100 font-semibold';
                    } else if (isSelected && !isRight) {
                      optStyle =
                        'bg-rose-500/15 border-rose-500/50 text-rose-900 dark:text-rose-100';
                    } else {
                      optStyle =
                        'bg-slate-50/50 dark:bg-[#0B1124]/60 border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400';
                    }
                  } else if (isSelected) {
                    optStyle = 'accent-active-tab text-slate-900 dark:text-white font-semibold';
                  }

                  return (
                    <button
                      key={`${qIdx}-${optIdx}`}
                      type="button"
                      disabled={viewMode === 'sheet' || isSubmitted}
                      onClick={() => setSelectedAnswers((prev) => ({ ...prev, [qIdx]: optIdx }))}
                      className={`w-full text-right flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg border text-xs transition-colors ${
                        viewMode === 'interactive' && !isSubmitted ? 'cursor-pointer' : 'cursor-default'
                      } ${optStyle}`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="w-6 h-6 rounded-md bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/15 flex items-center justify-center text-[11px] font-bold shrink-0">
                          {OPTION_LETTERS[optIdx]}
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

              {((viewMode === 'interactive' && isSubmitted) || (viewMode === 'sheet' && includeAnswerKey)) && (
                <div className="rounded-lg bg-slate-50 dark:bg-[#0B1124] border border-slate-200 dark:border-white/10 p-2.5 text-[11px] text-slate-700 dark:text-slate-300 space-y-0.5">
                  <div>
                    <strong className="text-slate-900 dark:text-white">المرجع:</strong> {q.lessonRef}
                  </div>
                  <div>
                    <strong className="text-slate-900 dark:text-white">التوضيح:</strong> {q.explanation}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {exam.bookSources.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {exam.bookSources.map((src) => {
            const safeHref = safeHttpUrl(src.url);
            if (!safeHref) return null;
            return (
              <a
                key={safeHref}
                href={safeHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/10 text-[11px] text-slate-700 dark:text-slate-200"
              >
                <ExternalLink className="w-3 h-3 shrink-0" style={{ color: 'var(--accent-primary)' }} />
                <span className="truncate max-w-[180px]">{src.title}</span>
              </a>
            );
          })}
        </div>
      )}

      <div
        role="note"
        className="rounded-xl bg-amber-500/10 border border-amber-500/35 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-2"
      >
        <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
        <span>راجع الإجابات قبل استخدامها، فقد يخطئ الذكاء الاصطناعي.</span>
      </div>
    </div>
  );
}

function InlineSummaryCard({
  payload,
}: {
  payload: Extract<ChatToolPayload, { tool: 'summary' }>;
}) {
  const { summary } = payload;
  const [copied, setCopied] = useState(false);

  const plainSummary = [
    `${summary.title} (${summary.subject})`,
    summary.overview ? `\n${summary.overview}` : '',
    '\nالنقاط الرئيسية:',
    ...summary.bulletPoints.map((b, i) => `${i + 1}. ${b}`),
    ...(summary.keyTerms.length > 0
      ? ['\nأهم المصطلحات:', ...summary.keyTerms.map((k) => `- ${k.term}: ${k.definition}`)]
      : []),
  ]
    .filter(Boolean)
    .join('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(plainSummary);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked in embedded contexts
    }
  };

  const handleDownload = () => {
    const safeName = summary.title.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'ملخص';
    downloadTextFile(`${safeName}.txt`, plainSummary);
  };

  return (
    <div className="mt-3 rounded-xl border border-slate-200 dark:border-white/15 bg-slate-50/90 dark:bg-[#0B1124] p-3.5 sm:p-4 space-y-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2.5 border-b border-slate-200 dark:border-white/10 pb-3">
        <div className="space-y-0.5 min-w-0">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--accent-text)' }}>
            <BookOpen className="w-3.5 h-3.5 shrink-0" />
            <span>تلخيص الدرس · {summary.subject}</span>
          </div>
          <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-snug">
            {summary.title}
          </h3>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/15 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'تم النسخ' : 'نسخ'}</span>
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/15 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
            <span>تحميل الملخص</span>
          </button>
        </div>
      </div>

      {summary.overview && (
        <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/10 rounded-xl p-3">
          {summary.overview}
        </p>
      )}

      <div className="space-y-2">
        <div className="text-xs font-bold text-slate-900 dark:text-white">النقاط الرئيسية</div>
        <ul className="space-y-1.5">
          {summary.bulletPoints.map((pt, idx) => (
            <li
              key={idx}
              className="flex items-start gap-2 rounded-xl bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/10 p-2.5 text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed"
            >
              <span className="w-5 h-5 rounded-md accent-btn text-white flex items-center justify-center text-[11px] font-bold tabular-nums shrink-0 mt-0.5">
                {idx + 1}
              </span>
              <span className="flex-1">{pt}</span>
            </li>
          ))}
        </ul>
      </div>

      {summary.keyTerms.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-900 dark:text-white">أهم المصطلحات</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {summary.keyTerms.map((kt, idx) => (
              <div
                key={idx}
                className="rounded-xl bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/10 p-2.5 space-y-0.5"
              >
                <div className="text-xs font-bold text-slate-900 dark:text-white">{kt.term}</div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">{kt.definition}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InlineFlashcardsCard({
  payload,
}: {
  payload: Extract<ChatToolPayload, { tool: 'flashcards' }>;
}) {
  const [cards, setCards] = useState(payload.flashcards.cards);
  const [activeIdx, setActiveIdx] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const currentCard = cards[activeIdx] || cards[0];
  if (!currentCard) return null;

  const handleShuffle = () => {
    if (cards.length < 2) return;
    const copy = [...cards];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    setCards(copy);
    setActiveIdx(0);
    setIsFlipped(false);
    setShowHint(false);
  };

  const handleDownloadCards = () => {
    const textOut = [
      payload.flashcards.deckTitle,
      '',
      ...cards.map(
        (c, i) =>
          `بطاقة ${i + 1}:\nالسؤال: ${c.question}\nالإجابة: ${c.answer}${c.hint ? `\nتلميح: ${c.hint}` : ''}\n`
      ),
    ].join('\n');
    const safeName = payload.flashcards.deckTitle.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'بطاقات';
    downloadTextFile(`${safeName}_بطاقات_مراجعة.txt`, textOut);
  };

  return (
    <div className="mt-3 rounded-xl border border-slate-200 dark:border-white/15 bg-slate-50/90 dark:bg-[#0B1124] p-3.5 sm:p-4 space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-200 dark:border-white/10 pb-3">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--accent-text)' }}>
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span>بطاقات المراجعة · {activeIdx + 1} من {cards.length}</span>
          </div>
          <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white mt-0.5">
            {payload.flashcards.deckTitle}
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleShuffle}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/15 text-xs font-semibold cursor-pointer"
          >
            <Shuffle className="w-3.5 h-3.5" />
            <span>خلط</span>
          </button>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/15 text-xs font-semibold cursor-pointer"
          >
            <span>{showAll ? 'بطاقة واحدة' : 'عرض الكل'}</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadCards}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/15 text-xs font-semibold cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
            <span>تحميل البطاقات</span>
          </button>
        </div>
      </div>

      {!showAll ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setIsFlipped((v) => !v)}
            className="w-full min-h-[165px] rounded-xl p-5 text-center flex flex-col items-center justify-center gap-3 border-2 transition-all cursor-pointer bg-white dark:bg-[#060916] hover:border-[var(--accent-primary)] border-slate-200 dark:border-white/15"
          >
            <span
              className="text-xs font-bold"
              style={{ color: isFlipped ? '#10b981' : 'var(--accent-text)' }}
            >
              {isFlipped ? 'الإجابة' : 'السؤال'}
            </span>
            <p className="text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-relaxed max-w-lg">
              {isFlipped ? currentCard.answer : currentCard.question}
            </p>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
              <RotateCw className="w-3 h-3" />
              <span>{isFlipped ? 'اضغط للعودة للسؤال' : 'اضغط لكشف الإجابة'}</span>
            </span>
          </button>

          {showHint && currentCard.hint && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              <strong>تلميح:</strong> {currentCard.hint}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            {currentCard.hint ? (
              <button
                type="button"
                onClick={() => setShowHint((v) => !v)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/15 text-xs font-semibold cursor-pointer"
              >
                <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                <span>{showHint ? 'إخفاء التلميح' : 'إظهار تلميح'}</span>
              </button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={activeIdx === 0}
                onClick={() => {
                  setActiveIdx((i) => Math.max(0, i - 1));
                  setIsFlipped(false);
                  setShowHint(false);
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/15 text-xs font-semibold cursor-pointer disabled:opacity-40"
              >
                <ChevronRight className="w-3.5 h-3.5" />
                <span>السابقة</span>
              </button>
              <button
                type="button"
                disabled={activeIdx >= cards.length - 1}
                onClick={() => {
                  setActiveIdx((i) => Math.min(cards.length - 1, i + 1));
                  setIsFlipped(false);
                  setShowHint(false);
                }}
                className="accent-btn inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-white text-xs font-semibold cursor-pointer disabled:opacity-40"
              >
                <span>التالية</span>
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-80 overflow-y-auto pr-0.5">
          {cards.map((c, idx) => (
            <div
              key={idx}
              className="rounded-xl bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/10 p-3 space-y-1.5"
            >
              <div className="text-[11px] font-bold" style={{ color: 'var(--accent-text)' }}>
                بطاقة {idx + 1}
              </div>
              <div className="text-xs font-bold text-slate-900 dark:text-white">{c.question}</div>
              <div className="text-xs text-slate-600 dark:text-slate-300 border-t border-slate-100 dark:border-white/10 pt-1.5">
                {c.answer}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
