import { useState, useEffect, FormEvent } from 'react';
import { User } from 'firebase/auth';
import {
  Presentation,
  Download,
  Sparkles,
  FileSliders,
  AlertCircle,
  CheckCircle2,
  Layers,
  StickyNote,
} from 'lucide-react';
import { PptxDeck, PptxVisualTheme, exportDeckToPptx } from '../lib/pptxBuilder';
import { getOtpHeaders } from '../lib/otpSession';
import { postNdjsonOrJson } from '../lib/ndjsonFetch';

interface PresentationStudioProps {
  user: User;
  initialTopic?: string | null;
  onConsumeInitialTopic?: () => void;
}

const THEME_OPTIONS: Array<{ id: PptxVisualTheme; label: string; color: string }> = [
  { id: 'cosmos', label: 'فضائي داكن', color: '#8b5cf6' },
  { id: 'executive-blue', label: 'أزرق احترافي', color: '#3b82f6' },
  { id: 'emerald-modern', label: 'أخضر حديث', color: '#10b981' },
  { id: 'clean-light', label: 'كلاسيكي فاتح', color: '#f8fafc' },
];

export function PresentationStudio({
  user,
  initialTopic,
  onConsumeInitialTopic,
}: PresentationStudioProps) {
  const [topic, setTopic] = useState('');
  const [details, setDetails] = useState('');
  const [slideCount, setSlideCount] = useState(8);
  const [audience, setAudience] = useState('تنفيذي وعام');
  const [language, setLanguage] = useState<'ar' | 'en'>('ar');
  const [visualTheme, setVisualTheme] = useState<PptxVisualTheme>('cosmos');

  const [generating, setGenerating] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [deck, setDeck] = useState<PptxDeck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialTopic) {
      setTopic(initialTopic);
      onConsumeInitialTopic?.();
    }
  }, [initialTopic, onConsumeInitialTopic]);

  const handleGenerate = async (e: FormEvent) => {
    e.preventDefault();
    const cleanTopic = topic.trim();
    if (!cleanTopic || generating) return;

    setGenerating(true);
    setStatusText('جاري تخطيط وبناء شرائح PowerPoint...');
    setError(null);
    setSuccessMsg(null);

    try {
      const idToken = await user.getIdToken();
      const data = await postNdjsonOrJson<PptxDeck>('/api/nova/generate-pptx', {
        headers: {
          Authorization: `Bearer ${idToken}`,
          ...getOtpHeaders(),
        },
        body: {
          topic: cleanTopic,
          details: details.trim(),
          slideCount,
          audience,
          language,
        },
        onStatus: (msg) => setStatusText(msg),
      });

      if (!Array.isArray(data.slides)) {
        throw new Error('تعذر إنشاء العرض التقديمي حاليًا.');
      }

      setDeck({
        deckTitle: data.deckTitle,
        deckSubtitle: data.deckSubtitle,
        slides: data.slides,
        language,
      });
      setSuccessMsg('تم إنشاء جميع الشرائح بدقة! يمكنك مراجعتها الآن أو تحميل ملف PowerPoint مباشرة.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء إنشاء العرض التقديمي.');
    } finally {
      setGenerating(false);
      setStatusText('');
    }
  };

  const handleDownload = async () => {
    if (!deck || downloading) return;
    setDownloading(true);
    setError(null);
    try {
      await exportDeckToPptx(deck, visualTheme, deck.language || language);
      setSuccessMsg('تم تحميل ملف PowerPoint (.pptx) بنجاح!');
    } catch {
      setError('تعذر تصدير ملف PowerPoint. يرجى المحاولة مرة أخرى.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto max-w-6xl w-full mx-auto px-3.5 sm:px-6 py-5 sm:py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <Presentation className="w-6 h-6" style={{ color: 'var(--accent-primary)' }} />
            <span>صانع عروض PowerPoint الذكي</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
            اكتب موضوع العرض وكل التفاصيل الدقيقة التي تريدها، وسيبني Nova AI شرائح متكاملة جاهزة للتحميل بصيغة .pptx.
          </p>
        </div>

        {deck && (
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="accent-btn inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>{downloading ? 'جاري التصدير...' : 'تحميل ملف PowerPoint (.pptx)'}</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Input Form */}
        <form
          onSubmit={handleGenerate}
          className="lg:col-span-5 rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-6 space-y-4 backdrop-blur-md"
        >
          <div>
            <label htmlFor="pptx-topic" className="block text-xs sm:text-sm font-bold text-slate-900 dark:text-white mb-1.5">
              موضوع أو عنوان العرض التقديمي
            </label>
            <input
              id="pptx-topic"
              type="text"
              required
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="مثال: استراتيجية التحول الرقمي والذكاء الاصطناعي في التعليم"
              className="accent-focus w-full rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="pptx-details" className="block text-xs sm:text-sm font-bold text-slate-900 dark:text-white mb-1.5">
              التفاصيل والمحاور المطلوبة بالضبط
            </label>
            <textarea
              id="pptx-details"
              rows={5}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="اكتب أي نقاط، أرقام، أقسام محددة، أمثلة، أو مقارنات تريد ظهورها حرفيًا في الشرائح..."
              className="accent-focus w-full rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pptx-slides" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                عدد الشرائح ({slideCount})
              </label>
              <input
                id="pptx-slides"
                type="range"
                min={4}
                max={16}
                value={slideCount}
                onChange={(e) => setSlideCount(Number(e.target.value))}
                className="w-full accent-[var(--accent-primary)]"
              />
            </div>

            <div>
              <label htmlFor="pptx-lang" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                لغة العرض
              </label>
              <select
                id="pptx-lang"
                value={language}
                onChange={(e) => setLanguage(e.target.value as 'ar' | 'en')}
                className="w-full rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15 px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none"
              >
                <option value="ar">العربية (RTL)</option>
                <option value="en">English (LTR)</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="pptx-audience" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              الجمهور المستهدف
            </label>
            <input
              id="pptx-audience"
              type="text"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="مثال: طلاب جامعة، مستثمرون، فريق عمل..."
              className="accent-focus w-full rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15 px-3.5 py-2 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none"
            />
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">تصميم الشرائح</div>
            <div className="grid grid-cols-2 gap-2">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setVisualTheme(opt.id)}
                  className={`flex items-center gap-2 p-2.5 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                    visualTheme === opt.id
                      ? 'accent-active-tab text-slate-900 dark:text-white'
                      : 'bg-slate-50 dark:bg-[#060916] border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <span
                    className="w-4 h-4 rounded-full border border-black/15 shrink-0"
                    style={{ backgroundColor: opt.color }}
                  />
                  <span className="truncate">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/35 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/35 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-200 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={generating || !topic.trim()}
            className="accent-btn w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            <span>{generating ? statusText || 'جاري تصميم وبناء الشرائح...' : 'إنشاء العرض التقديمي'}</span>
          </button>
        </form>

        {/* Slides Preview */}
        <div className="lg:col-span-7 space-y-4">
          {!deck ? (
            <div className="rounded-2xl bg-white/80 dark:bg-[#0B1020]/80 border border-slate-200 dark:border-white/10 p-10 text-center space-y-3 backdrop-blur-md">
              <FileSliders className="w-10 h-10 mx-auto" style={{ color: 'var(--accent-primary)' }} />
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">معاينة الشرائح التفاعلية</h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
                املأ بيانات العرض واضغط «إنشاء العرض التقديمي» ليقوم Nova AI بإعداد الشرائح كاملةً مع النقاط والمؤشرات وملاحظات المتحدث جاهزة للتنزيل كملف PowerPoint حقيقي.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">{deck.deckTitle}</h2>
                  {deck.deckSubtitle && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{deck.deckSubtitle}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <Layers className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                  <span className="tabular-nums">{deck.slides.length} شريحة</span>
                </div>
              </div>

              {deck.slides.map((slide, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-5 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-bold" style={{ color: 'var(--accent-text)' }}>
                      شريحة {idx + 1}
                    </span>
                    <span>
                      {slide.layout === 'title'
                        ? 'الغلاف'
                        : slide.layout === 'two-column'
                          ? 'عمودان'
                          : slide.layout === 'metrics'
                            ? 'مؤشرات وأرقام'
                            : slide.layout === 'conclusion'
                              ? 'الخلاصة'
                              : 'محتوى رئيسي'}
                    </span>
                  </div>

                  <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">{slide.title}</h3>
                  {slide.subtitle && (
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">{slide.subtitle}</p>
                  )}

                  {slide.metrics && slide.metrics.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
                      {slide.metrics.map((m, mIdx) => (
                        <div
                          key={mIdx}
                          className="rounded-xl p-3 bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 text-center"
                        >
                          <div className="text-base font-bold tabular-nums" style={{ color: 'var(--accent-primary)' }}>
                            {m.value}
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">{m.label}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className={slide.rightColumnBullets?.length ? 'grid grid-cols-1 sm:grid-cols-2 gap-4' : ''}>
                    <ul className="space-y-1.5 text-xs sm:text-sm text-slate-700 dark:text-slate-200 list-disc pr-5">
                      {slide.bullets.map((b, bIdx) => (
                        <li key={bIdx} className="leading-relaxed">
                          {b}
                        </li>
                      ))}
                    </ul>

                    {slide.rightColumnBullets && slide.rightColumnBullets.length > 0 && (
                      <div className="space-y-1.5">
                        {slide.rightColumnTitle && (
                          <div className="text-xs font-bold text-slate-900 dark:text-white">{slide.rightColumnTitle}</div>
                        )}
                        <ul className="space-y-1.5 text-xs sm:text-sm text-slate-700 dark:text-slate-200 list-disc pr-5">
                          {slide.rightColumnBullets.map((b, bIdx) => (
                            <li key={bIdx} className="leading-relaxed">
                              {b}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {slide.speakerNotes && (
                    <div className="pt-2.5 border-t border-slate-200 dark:border-white/10 flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <StickyNote className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{slide.speakerNotes}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
