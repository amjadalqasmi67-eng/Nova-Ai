import { motion } from 'motion/react';
import {
  ShieldCheck,
  ArrowLeft,
  MessageSquare,
  Presentation,
  Sliders,
  RefreshCw,
} from 'lucide-react';
import { NovaStarLogo } from './NovaStarLogo';
import { PWAInstallButton } from './PWAInstallButton';

interface LoginGateProps {
  onSignIn: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
  onOpenPrivacy?: () => void;
}

export function LoginGate({ onSignIn, isLoading, error, onOpenPrivacy }: LoginGateProps) {
  return (
    <div className="relative z-10 min-h-[100dvh] flex flex-col justify-between px-4 py-5 sm:px-8 sm:py-7 lg:px-16 lg:py-8 overflow-x-hidden">
      {/* Minimal Single-Row Header with Glowing Star Logo + Nova AI */}
      <header className="flex items-center justify-between gap-2 sm:gap-4 max-w-6xl w-full mx-auto">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 shrink-0">
          <NovaStarLogo size="sm" />
          <span
            dir="ltr"
            className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap"
          >
            Nova AI
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <PWAInstallButton variant="header" />
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap shrink-0">
            <ShieldCheck className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
            <span>منصة ذكاء اصطناعي آمنة</span>
          </div>
        </div>
      </header>

      {/* Main Centered Split Stage */}
      <main className="max-w-6xl w-full mx-auto my-auto py-6 sm:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          {/* Right Column (RTL Primary): Brand Value & Login Action */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-7 flex flex-col items-start text-right min-w-0"
          >
            <p
              className="text-xs font-semibold mb-3 sm:mb-4 tracking-wide"
              style={{ color: 'var(--accent-text)' }}
            >
              منصة الذكاء الاصطناعي العربية المتكاملة
            </p>

            <h1
              className="text-3xl sm:text-5xl lg:text-6xl font-bold text-slate-900 dark:text-white leading-[1.2] mb-4 sm:mb-5"
              style={{ textWrap: 'balance' }}
            >
              مساعدك الذكي{' '}
              <span
                dir="ltr"
                className="inline-block bg-gradient-to-l from-blue-400 via-indigo-400 to-violet-400 bg-clip-text text-transparent"
              >
                Nova AI
              </span>
            </h1>

            <p className="text-sm sm:text-base lg:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl mb-6 sm:mb-8">
              منصة عربية متكاملة تساعدك في المحادثات الذكية، التحدث الصوتي المباشر، تحليل الصور، تصميم عروض PowerPoint وPDF، وبناء الاختبارات الدراسية التفاعلية من مكان واحد.
            </p>

            {/* Primary Login Card */}
            <div className="w-full max-w-md rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-5 sm:p-6 shadow-xl dark:shadow-[0_0_50px_rgba(59,130,246,0.12)] backdrop-blur-md">
              <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-900 dark:text-white mb-2">
                <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-primary)' }} />
                <span>ابدأ باستخدام Nova AI</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-5">
                سجّل الدخول بحساب Google لحفظ محادثاتك وتخصيص مظهرك واسم العرض والوصول إلى جميع الأدوات بسهولة وأمان.
              </p>

              {error && (
                <div
                  role="alert"
                  className="mb-4 rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-xs text-rose-700 dark:text-rose-200 leading-relaxed flex flex-col gap-2.5"
                >
                  <span>{error}</span>
                  <div>
                    <button
                      type="button"
                      onClick={onSignIn}
                      disabled={isLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>إعادة المحاولة</span>
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={onSignIn}
                disabled={isLoading}
                className="accent-btn w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm transition-all duration-200 cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>جاري التحقق من الهوية...</span>
                  </>
                ) : (
                  <>
                    <span>تسجيل الدخول بحساب Google</span>
                    <ArrowLeft className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>

            {/* Concise 3-capability strip */}
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-6 w-full max-w-xl pt-6 border-t border-slate-200 dark:border-white/10">
              <div className="flex items-start gap-2.5">
                <MessageSquare className="w-4 h-4 text-blue-500 dark:text-blue-400 mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">محادثة وصوت مباشر</div>
                  <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">حوار عربي ذكي وتفاعل صوتي فوري</div>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Presentation className="w-4 h-4 text-indigo-500 dark:text-indigo-400 mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">عروض واختبارات ذكية</div>
                  <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">تصدير PowerPoint وPDF واختبارات تفاعلية</div>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Sliders className="w-4 h-4 text-violet-500 dark:text-violet-400 mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">تحليل الصور والتخصيص</div>
                  <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">قراءة الصور مع سمات وألوان مخصصة</div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Left Column (RTL Secondary): Custom Glowing Blue-Violet Star Emblem */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-5 flex items-center justify-center"
          >
            <div className="relative w-44 h-44 sm:w-64 sm:h-64 lg:w-80 lg:h-80 flex items-center justify-center rounded-full bg-white/60 dark:bg-[#070B18]/80 border border-slate-200 dark:border-blue-400/20 shadow-2xl dark:shadow-[0_0_80px_rgba(79,70,229,0.28)]">
              <NovaStarLogo size="hero" />
            </div>
          </motion.div>
        </div>
      </main>

      {/* Quiet Footer */}
      <footer className="max-w-6xl w-full mx-auto flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 pt-4 border-t border-slate-200 dark:border-white/5">
        <span>Nova AI · منصة الذكاء الاصطناعي العربية</span>
        <div className="flex items-center gap-4">
          {onOpenPrivacy && (
            <button
              type="button"
              onClick={onOpenPrivacy}
              className="hover:text-slate-900 dark:hover:text-white underline underline-offset-4 cursor-pointer transition-colors"
            >
              سياسة الخصوصية
            </button>
          )}
          <span className="tabular-nums">2026</span>
        </div>
      </footer>
    </div>
  );
}
