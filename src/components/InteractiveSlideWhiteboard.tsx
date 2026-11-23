import { useEffect, useMemo, useRef, useState } from 'react';
import { FastForward, Play, RotateCcw, CheckCircle2, Pause } from 'lucide-react';
import type { PptxSlideData, PptxVisualTheme } from '../lib/pptxBuilder';

interface InteractiveSlideWhiteboardProps {
  slides: PptxSlideData[];
  totalExpected: number;
  isGenerating: boolean;
  visualTheme: PptxVisualTheme;
  language: 'ar' | 'en';
  deckTitle?: string;
  deckSubtitle?: string;
  statusMessage?: string;
  replayNonce: number;
  onFinishPlayback?: () => void;
}

type BuildStage = 'blank' | 'title' | 'elements' | 'styled';

interface VisualThemeStyle {
  label: string;
  bg: string;
  surface: string;
  surfaceAlt: string;
  titleColor: string;
  textColor: string;
  mutedColor: string;
  accent: string;
  accentSoft: string;
  border: string;
  isDark: boolean;
}

const THEME_STYLES: Record<PptxVisualTheme, VisualThemeStyle> = {
  cosmos: {
    label: 'فضائي داكن',
    bg: '#0B1020',
    surface: '#141C38',
    surfaceAlt: '#1B254B',
    titleColor: '#F8FAFC',
    textColor: '#E2E8F0',
    mutedColor: '#94A3B8',
    accent: '#8B5CF6',
    accentSoft: '#2E1065',
    border: '#334155',
    isDark: true,
  },
  'executive-blue': {
    label: 'أزرق احترافي',
    bg: '#0A192F',
    surface: '#112240',
    surfaceAlt: '#172E56',
    titleColor: '#FFFFFF',
    textColor: '#CBD5E1',
    mutedColor: '#94A3B8',
    accent: '#3B82F6',
    accentSoft: '#172554',
    border: '#1E40AF',
    isDark: true,
  },
  'emerald-modern': {
    label: 'أخضر حديث',
    bg: '#041D17',
    surface: '#062E24',
    surfaceAlt: '#093F32',
    titleColor: '#F0FDF4',
    textColor: '#D1FAE5',
    mutedColor: '#6EE7B7',
    accent: '#10B981',
    accentSoft: '#064E3B',
    border: '#047857',
    isDark: true,
  },
  'clean-light': {
    label: 'كلاسيكي فاتح',
    bg: '#F8FAFC',
    surface: '#FFFFFF',
    surfaceAlt: '#F1F5F9',
    titleColor: '#0F172A',
    textColor: '#334155',
    mutedColor: '#64748B',
    accent: '#6D28D9',
    accentSoft: '#EDE9FE',
    border: '#CBD5E1',
    isDark: false,
  },
};

function getLayoutLabel(layout: PptxSlideData['layout']): string {
  if (layout === 'title') return 'الغلاف';
  if (layout === 'two-column') return 'عمودان';
  if (layout === 'metrics') return 'مؤشرات وأرقام';
  if (layout === 'conclusion') return 'الخلاصة';
  return 'محتوى رئيسي';
}

export function InteractiveSlideWhiteboard({
  slides,
  totalExpected,
  isGenerating,
  visualTheme,
  language,
  deckTitle,
  statusMessage,
  replayNonce,
  onFinishPlayback,
}: InteractiveSlideWhiteboardProps) {
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [stage, setStage] = useState<BuildStage>('blank');
  const [revealedCount, setRevealedCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [playbackComplete, setPlaybackComplete] = useState(false);
  const completedCallbackSentRef = useRef(false);

  const reducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // Reset playback when a fresh generation or explicit replay begins
  useEffect(() => {
    setActiveSlideIdx(0);
    setStage('blank');
    setRevealedCount(0);
    setIsPlaying(true);
    setIsPaused(false);
    setPlaybackComplete(false);
    completedCallbackSentRef.current = false;
  }, [replayNonce]);

  const currentSlide = slides[activeSlideIdx];
  const theme = THEME_STYLES[visualTheme];
  const effectiveTotal = Math.max(slides.length, totalExpected, 1);

  // Total sequential elements on the current slide (metrics + left bullets + right bullets)
  const currentSlideElementTotal = useMemo(() => {
    if (!currentSlide) return 0;
    const metricsLen = Array.isArray(currentSlide.metrics) ? currentSlide.metrics.length : 0;
    const bulletsLen = Array.isArray(currentSlide.bullets) ? currentSlide.bullets.length : 0;
    const rightLen = Array.isArray(currentSlide.rightColumnBullets) ? currentSlide.rightColumnBullets.length : 0;
    return metricsLen + bulletsLen + rightLen;
  }, [currentSlide]);

  // Step-by-step live whiteboard choreography engine
  useEffect(() => {
    if (!isPlaying || isPaused || playbackComplete) return;

    // Wait smoothly if the next slide is still streaming from Gemini
    if (!currentSlide) {
      if (!isGenerating && slides.length > 0 && activeSlideIdx >= slides.length) {
        setActiveSlideIdx(slides.length - 1);
        setStage('styled');
        setRevealedCount(999);
        setIsPlaying(false);
        setPlaybackComplete(true);
        if (!completedCallbackSentRef.current) {
          completedCallbackSentRef.current = true;
          onFinishPlayback?.();
        }
      }
      return;
    }

    if (reducedMotion) {
      setStage('styled');
      setRevealedCount(currentSlideElementTotal);
      const t = setTimeout(() => {
        if (activeSlideIdx + 1 < slides.length) {
          setActiveSlideIdx((i) => i + 1);
        } else if (!isGenerating) {
          setIsPlaying(false);
          setPlaybackComplete(true);
          if (!completedCallbackSentRef.current) {
            completedCallbackSentRef.current = true;
            onFinishPlayback?.();
          }
        }
      }, 280);
      return () => clearTimeout(t);
    }

    if (stage === 'blank') {
      const t = setTimeout(() => setStage('title'), 150);
      return () => clearTimeout(t);
    }

    if (stage === 'title') {
      const t = setTimeout(() => {
        if (currentSlideElementTotal > 0) {
          setRevealedCount(1);
          setStage('elements');
        } else {
          setStage('styled');
        }
      }, 360);
      return () => clearTimeout(t);
    }

    if (stage === 'elements') {
      if (revealedCount < currentSlideElementTotal) {
        const t = setTimeout(() => setRevealedCount((c) => c + 1), 210);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setStage('styled'), 260);
      return () => clearTimeout(t);
    }

    if (stage === 'styled') {
      // Hold finished styled slide briefly, then transition to next slide if available
      const t = setTimeout(() => {
        if (activeSlideIdx + 1 < slides.length) {
          setStage('blank');
          setRevealedCount(0);
          setActiveSlideIdx((i) => i + 1);
        } else if (!isGenerating) {
          setIsPlaying(false);
          setPlaybackComplete(true);
          if (!completedCallbackSentRef.current) {
            completedCallbackSentRef.current = true;
            onFinishPlayback?.();
          }
        }
      }, 620);
      return () => clearTimeout(t);
    }
  }, [
    isPlaying,
    isPaused,
    playbackComplete,
    currentSlide,
    stage,
    revealedCount,
    currentSlideElementTotal,
    activeSlideIdx,
    slides.length,
    isGenerating,
    reducedMotion,
    onFinishPlayback,
  ]);

  const handleSkipToEnd = () => {
    if (slides.length === 0) return;
    setActiveSlideIdx(slides.length - 1);
    setStage('styled');
    setRevealedCount(999);
    setIsPlaying(false);
    setIsPaused(false);
    setPlaybackComplete(true);
    if (!completedCallbackSentRef.current) {
      completedCallbackSentRef.current = true;
      onFinishPlayback?.();
    }
  };

  const handleSelectSlide = (idx: number) => {
    setActiveSlideIdx(idx);
    setStage('styled');
    setRevealedCount(999);
    setIsPlaying(false);
    setIsPaused(false);
  };

  const handleReplayAll = () => {
    setActiveSlideIdx(0);
    setStage('blank');
    setRevealedCount(0);
    setIsPlaying(true);
    setIsPaused(false);
    setPlaybackComplete(false);
    completedCallbackSentRef.current = false;
  };

  const isStyled = stage === 'styled';
  const stageText = !currentSlide
    ? statusMessage || 'جاري تجهيز الشريحة على اللوحة البيضاء...'
    : stage === 'blank'
      ? 'تجهيز اللوحة البيضاء'
      : stage === 'title'
        ? 'كتابة العنوان الرئيسي'
        : stage === 'elements'
          ? 'إضافة النقاط والعناصر تباعًا'
          : playbackComplete && activeSlideIdx === slides.length - 1
            ? 'اكتمل بناء جميع الشرائح'
            : 'تطبيق الألوان والتصميم النهائي';

  const progressRatio = (() => {
    if (playbackComplete) return 1;
    if (slides.length === 0) return 0.08;
    const stageWeight =
      stage === 'blank'
        ? 0.1
        : stage === 'title'
          ? 0.3
          : stage === 'elements'
            ? 0.3 + 0.45 * (currentSlideElementTotal > 0 ? revealedCount / currentSlideElementTotal : 1)
            : 0.95;
    return Math.min(0.98, (activeSlideIdx + stageWeight) / effectiveTotal);
  })();

  const dir = language === 'en' ? 'ltr' : 'rtl';
  const metrics = currentSlide?.metrics ?? [];
  const bullets = currentSlide?.bullets ?? [];
  const rightBullets = currentSlide?.rightColumnBullets ?? [];

  return (
    <div className="rounded-2xl bg-white/95 dark:bg-[#0B1020]/95 border border-slate-200 dark:border-white/10 p-4 sm:p-5 space-y-4">
      {/* Studio Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span className="font-bold tabular-nums" style={{ color: 'var(--accent-text)' }}>
              الشريحة {Math.min(activeSlideIdx + 1, effectiveTotal)} من {effectiveTotal}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-slate-800 dark:text-slate-100">{stageText}</span>
            {currentSlide && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-slate-500 dark:text-slate-400">{getLayoutLabel(currentSlide.layout)}</span>
              </>
            )}
          </div>
          {deckTitle && (
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{deckTitle}</div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isPlaying && !playbackComplete && (
            <>
              <button
                type="button"
                onClick={() => setIsPaused((p) => !p)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/15 bg-slate-50 dark:bg-[#060916] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer whitespace-nowrap shrink-0"
              >
                {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                <span>{isPaused ? 'متابعة' : 'إيقاف مؤقت'}</span>
              </button>
              {slides.length > 0 && !isGenerating && (
                <button
                  type="button"
                  onClick={handleSkipToEnd}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/15 bg-white dark:bg-[#0B1020] text-xs font-semibold text-slate-800 dark:text-white hover:border-slate-300 dark:hover:border-white/30 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <FastForward className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                  <span>تخطي للعرض النهائي</span>
                </button>
              )}
            </>
          )}
          {!isGenerating && slides.length > 0 && (!isPlaying || playbackComplete) && (
            <button
              type="button"
              onClick={handleReplayAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/15 bg-slate-50 dark:bg-[#060916] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
              <span>إعادة البناء التفاعلي</span>
            </button>
          )}
        </div>
      </div>

      {/* Continuous Progress Track */}
      <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300 ease-out"
          style={{
            width: `${Math.round(progressRatio * 100)}%`,
            backgroundColor: 'var(--accent-primary)',
          }}
        />
      </div>

      {/* 16:9 Whiteboard-to-Styled Slide Stage */}
      <div
        dir={dir}
        className="relative w-full aspect-video rounded-xl overflow-hidden border transition-all duration-500 ease-out select-text"
        style={{
          backgroundColor: isStyled ? theme.bg : '#FFFFFF',
          borderColor: isStyled ? theme.border : '#E2E8F0',
          backgroundImage: isStyled
            ? 'none'
            : 'radial-gradient(#CBD5E1 1px, transparent 1px)',
          backgroundSize: isStyled ? 'auto' : '18px 18px',
        }}
      >
        {/* Top Accent Design Bar (animates in during the styling phase) */}
        <div
          className="absolute top-0 inset-x-0 h-1.5 transition-all duration-500 ease-out origin-left"
          style={{
            backgroundColor: theme.accent,
            opacity: isStyled ? 1 : 0.18,
            transform: isStyled ? 'scaleX(1)' : 'scaleX(0.28)',
          }}
        />

        {/* Slide Content Area */}
        {!currentSlide ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center gap-3">
            <div className="w-2/3 max-w-sm h-5 rounded bg-slate-200/80 animate-pulse" />
            <div className="w-1/2 max-w-xs h-3 rounded bg-slate-200/60 animate-pulse" />
            <p className="text-xs sm:text-sm font-medium text-slate-500 mt-2">
              {statusMessage || 'جاري تجهيز اللوحة البيضاء وكتابة الشريحة الأولى...'}
            </p>
          </div>
        ) : (
          <div className="absolute inset-0 p-5 sm:p-7 flex flex-col justify-between overflow-y-auto">
            {/* Header Row on Slide */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-[11px] font-semibold">
                <span
                  className="tabular-nums transition-colors duration-500"
                  style={{ color: isStyled ? theme.mutedColor : '#64748B' }}
                >
                  {String(activeSlideIdx + 1).padStart(2, '0')} / {String(effectiveTotal).padStart(2, '0')}
                </span>
                <span
                  className="transition-colors duration-500"
                  style={{ color: isStyled ? theme.accent : '#94A3B8' }}
                >
                  {isStyled ? `تصميم: ${theme.label}` : 'مسودة لوحة بيضاء'}
                </span>
              </div>

              {/* Slide Title (Phase 1) */}
              <h3
                className="text-base sm:text-2xl font-bold leading-snug transition-all duration-300 ease-out"
                style={{
                  color: isStyled ? theme.titleColor : '#0F172A',
                  opacity: stage === 'blank' ? 0 : 1,
                  transform: stage === 'blank' ? 'translateY(10px)' : 'translateY(0)',
                }}
              >
                {currentSlide.title}
              </h3>

              {currentSlide.subtitle && (
                <p
                  className="text-xs sm:text-sm transition-all duration-300 ease-out"
                  style={{
                    color: isStyled ? theme.mutedColor : '#475569',
                    opacity: stage === 'blank' ? 0 : 1,
                    transform: stage === 'blank' ? 'translateY(8px)' : 'translateY(0)',
                  }}
                >
                  {currentSlide.subtitle}
                </p>
              )}
            </div>

            {/* Body Elements (Phase 2 — sequential reveal) */}
            <div className="my-auto py-2 space-y-3">
              {/* Metrics Grid */}
              {metrics.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {metrics.map((m, mIdx) => {
                    const visible =
                      stage === 'styled' || (stage === 'elements' && revealedCount > mIdx);
                    return (
                      <div
                        key={mIdx}
                        className="rounded-xl p-2.5 sm:p-3 border text-center transition-all duration-300 ease-out"
                        style={{
                          backgroundColor: isStyled ? theme.surface : '#F8FAFC',
                          borderColor: isStyled ? theme.border : '#CBD5E1',
                          opacity: visible ? 1 : 0,
                          transform: visible ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
                        }}
                      >
                        <div
                          className="text-sm sm:text-lg font-bold tabular-nums transition-colors duration-500"
                          style={{ color: isStyled ? theme.accent : '#0F172A' }}
                        >
                          {m.value}
                        </div>
                        <div
                          className="text-[11px] mt-0.5 transition-colors duration-500"
                          style={{ color: isStyled ? theme.mutedColor : '#475569' }}
                        >
                          {m.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Bullets + Optional Two-Column */}
              <div className={rightBullets.length > 0 ? 'grid grid-cols-1 sm:grid-cols-2 gap-4' : ''}>
                <ul className="space-y-2">
                  {bullets.map((b, bIdx) => {
                    const orderIdx = metrics.length + bIdx;
                    const visible =
                      stage === 'styled' || (stage === 'elements' && revealedCount > orderIdx);
                    return (
                      <li
                        key={bIdx}
                        className="flex items-start gap-2.5 text-xs sm:text-sm leading-relaxed transition-all duration-300 ease-out"
                        style={{
                          color: isStyled ? theme.textColor : '#1E293B',
                          opacity: visible ? 1 : 0,
                          transform: visible ? 'translateY(0)' : 'translateY(8px)',
                        }}
                      >
                        <span
                          className="mt-2 w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-500"
                          style={{ backgroundColor: isStyled ? theme.accent : '#334155' }}
                        />
                        <span>{b}</span>
                      </li>
                    );
                  })}
                </ul>

                {rightBullets.length > 0 && (
                  <div
                    className="rounded-xl p-3 border transition-all duration-500"
                    style={{
                      backgroundColor: isStyled ? theme.surface : '#F8FAFC',
                      borderColor: isStyled ? theme.border : '#E2E8F0',
                    }}
                  >
                    {currentSlide.rightColumnTitle && (
                      <div
                        className="text-xs font-bold mb-2 transition-all duration-300"
                        style={{
                          color: isStyled ? theme.titleColor : '#0F172A',
                          opacity:
                            stage === 'styled' ||
                            (stage === 'elements' && revealedCount > metrics.length + bullets.length)
                              ? 1
                              : 0,
                        }}
                      >
                        {currentSlide.rightColumnTitle}
                      </div>
                    )}
                    <ul className="space-y-1.5">
                      {rightBullets.map((b, rIdx) => {
                        const orderIdx = metrics.length + bullets.length + rIdx;
                        const visible =
                          stage === 'styled' || (stage === 'elements' && revealedCount > orderIdx);
                        return (
                          <li
                            key={rIdx}
                            className="flex items-start gap-2 text-xs sm:text-sm leading-relaxed transition-all duration-300 ease-out"
                            style={{
                              color: isStyled ? theme.textColor : '#1E293B',
                              opacity: visible ? 1 : 0,
                              transform: visible ? 'translateY(0)' : 'translateY(8px)',
                            }}
                          >
                            <span
                              className="mt-2 w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-500"
                              style={{ backgroundColor: isStyled ? theme.accent : '#334155' }}
                            />
                            <span>{b}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Subtle Slide Footer */}
            <div
              className="pt-2 border-t flex items-center justify-between text-[10px] transition-colors duration-500"
              style={{
                borderColor: isStyled ? theme.border : '#E2E8F0',
                color: isStyled ? theme.mutedColor : '#94A3B8',
              }}
            >
              <span>Nova AI Presentation Studio</span>
              <span className="tabular-nums">{activeSlideIdx + 1}</span>
            </div>
          </div>
        )}
      </div>

      {/* Interactive Slide Thumbnail Rail */}
      {slides.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {slides.map((s, idx) => {
            const isActive = idx === activeSlideIdx;
            const isBuilt = playbackComplete || idx < activeSlideIdx || (idx === activeSlideIdx && stage === 'styled');
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleSelectSlide(idx)}
                title={s.title}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold tabular-nums transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  isActive
                    ? 'accent-active-tab text-slate-900 dark:text-white'
                    : 'bg-slate-50 dark:bg-[#060916] border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-white/25'
                }`}
              >
                <span>{String(idx + 1).padStart(2, '0')}</span>
                {isBuilt && !isActive && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
