import { useState, FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck,
  Mail,
  Lock,
  Eye,
  EyeOff,
  User as UserIcon,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import { NovaStarLogo } from './NovaStarLogo';
import { PWAInstallButton } from './PWAInstallButton';

export type AuthViewMode = 'login' | 'signup' | 'reset';
export type AuthMethod = 'email' | 'google' | 'microsoft' | 'apple';

interface LoginGateProps {
  onEmailSignIn: (email: string, password: string) => Promise<void>;
  onEmailSignUp: (email: string, password: string, fullName?: string) => Promise<void>;
  onResetPassword: (email: string) => Promise<boolean>;
  onProviderSignIn: (provider: 'google' | 'microsoft' | 'apple') => Promise<void>;
  loadingMethod: AuthMethod | null;
  error: string | null;
  onClearError: () => void;
  onOpenPrivacy?: () => void;
}

function GoogleGlyph() {
  return (
    <svg className="w-4.5 h-4.5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.21-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.08 3.56-5.15 3.56-8.65z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.28v3.1A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.29A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.38-2.29v-3.1H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.39l4-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.76c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.28 6.61l4 3.1C6.23 6.87 8.88 4.76 12 4.76z"
      />
    </svg>
  );
}

function MicrosoftGlyph() {
  return (
    <svg className="w-4.5 h-4.5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="9.3" height="9.3" rx="1" fill="#F25022" />
      <rect x="12.7" y="2" width="9.3" height="9.3" rx="1" fill="#7FBA00" />
      <rect x="2" y="12.7" width="9.3" height="9.3" rx="1" fill="#00A4EF" />
      <rect x="12.7" y="12.7" width="9.3" height="9.3" rx="1" fill="#FFB900" />
    </svg>
  );
}

function AppleGlyph() {
  return (
    <svg className="w-4.5 h-4.5 shrink-0 fill-current" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z" />
    </svg>
  );
}

export function LoginGate({
  onEmailSignIn,
  onEmailSignUp,
  onResetPassword,
  onProviderSignIn,
  loadingMethod,
  error,
  onClearError,
  onOpenPrivacy,
}: LoginGateProps) {
  const [mode, setMode] = useState<AuthViewMode>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localNotice, setLocalNotice] = useState<string | null>(null);

  const isBusy = loadingMethod !== null;

  const switchMode = (next: AuthViewMode) => {
    setMode(next);
    setLocalNotice(null);
    onClearError();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setLocalNotice(null);

    if (mode === 'login') {
      await onEmailSignIn(email, password);
    } else if (mode === 'signup') {
      await onEmailSignUp(email, password, fullName);
    } else {
      const ok = await onResetPassword(email);
      if (ok) {
        setLocalNotice(
          'تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني. تفقد البريد الوارد أو مجلد الرسائل غير المرغوب فيها.'
        );
      }
    }
  };

  const headingText =
    mode === 'login'
      ? 'مرحبًا بعودتك'
      : mode === 'signup'
        ? 'إنشاء حساب جديد'
        : 'استعادة كلمة المرور';

  const subtitleText =
    mode === 'login'
      ? 'سجّل دخولك للوصول إلى محادثاتك وأدوات Nova AI'
      : mode === 'signup'
        ? 'أنشئ حسابك الشخصي للبدء مع Nova AI فورًا'
        : 'أدخل بريدك الإلكتروني وسنرسل لك رابطًا لإعادة التعيين';

  return (
    <div
      dir="rtl"
      className="relative z-10 min-h-[100dvh] flex flex-col justify-between px-4 py-4 sm:px-6 sm:py-6 overflow-x-hidden"
    >
      {/* Minimal Single-Row Header */}
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0 shrink-0">
          <NovaStarLogo size="sm" />
          <span
            dir="ltr"
            className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap"
          >
            Nova AI
          </span>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <PWAInstallButton variant="header" />
        </div>
      </header>

      {/* Centered Elevated Card Stage */}
      <main className="flex-1 flex items-center justify-center py-6 sm:py-8">
        <div className="relative w-full max-w-[436px]">
          {/* Soft Ambient Glow Aura */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-6 rounded-[2.5rem] opacity-40 dark:opacity-30 blur-3xl transition-opacity duration-500"
            style={{
              background:
                'radial-gradient(circle at 50% 25%, var(--accent-glow), rgba(59,130,246,0.18) 55%, transparent 80%)',
            }}
          />

          <motion.section
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
            aria-label="بوابة تسجيل الدخول إلى Nova AI"
            className="relative rounded-3xl bg-white/95 dark:bg-[#0B1122]/92 border border-slate-200/90 dark:border-white/12 shadow-[0_22px_65px_-18px_rgba(15,23,42,0.16)] dark:shadow-[0_28px_80px_-14px_rgba(0,0,0,0.72),0_0_50px_-18px_var(--accent-soft)] backdrop-blur-xl p-6 sm:p-8"
          >
            {/* Card Logo + Animated Title */}
            <div className="flex flex-col items-center text-center mb-6">
              <div className="mb-3.5">
                <NovaStarLogo size="md" />
              </div>
              <AnimatePresence mode="wait">
                <motion.div
                  key={mode}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                >
                  <h1
                    className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight"
                    style={{ textWrap: 'balance' }}
                  >
                    {headingText}
                  </h1>
                  <p className="mt-1.5 text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                    {subtitleText}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Feedback Alerts */}
            <AnimatePresence initial={false}>
              {error && (
                <motion.div
                  key="auth-error"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  role="alert"
                  className="mb-4 flex items-start gap-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 px-3.5 py-3 text-xs text-rose-700 dark:text-rose-200 leading-relaxed"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                  <span>{error}</span>
                </motion.div>
              )}

              {localNotice && !error && (
                <motion.div
                  key="auth-notice"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  role="status"
                  className="mb-4 flex items-start gap-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-3 text-xs text-emerald-700 dark:text-emerald-200 leading-relaxed"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" />
                  <span>{localNotice}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Primary Email / Password Form */}
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <AnimatePresence initial={false} mode="popLayout">
                {mode === 'signup' && (
                  <motion.div
                    key="signup-name-field"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <label
                      htmlFor="login-fullname"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      الاسم الكامل (اختياري)
                    </label>
                    <div className="relative">
                      <UserIcon className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute top-1/2 -translate-y-1/2 start-3.5 pointer-events-none" />
                      <input
                        id="login-fullname"
                        type="text"
                        autoComplete="name"
                        maxLength={80}
                        value={fullName}
                        onChange={(e) => {
                          setFullName(e.target.value);
                          onClearError();
                        }}
                        placeholder="مثال: أمجد القاسمي"
                        className="accent-focus w-full min-h-[48px] rounded-xl bg-slate-50 dark:bg-[#070C1A] border border-slate-200 dark:border-white/14 focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)] ps-10 pe-3.5 py-2.5 text-base sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Email Field */}
              <div>
                <label
                  htmlFor="login-email"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  البريد الإلكتروني
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute top-1/2 -translate-y-1/2 start-3.5 pointer-events-none" />
                  <input
                    id="login-email"
                    type="email"
                    dir="ltr"
                    inputMode="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setLocalNotice(null);
                      onClearError();
                    }}
                    placeholder="name@example.com"
                    className="accent-focus w-full min-h-[48px] rounded-xl bg-slate-50 dark:bg-[#070C1A] border border-slate-200 dark:border-white/14 focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)] ps-10 pe-3.5 py-2.5 text-base sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all text-left"
                  />
                </div>
              </div>

              {/* Password Field + Show/Hide Toggle */}
              {mode !== 'reset' && (
                <div>
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    كلمة المرور
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute top-1/2 -translate-y-1/2 start-3.5 pointer-events-none" />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      dir="ltr"
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      required
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        onClearError();
                      }}
                      placeholder={mode === 'signup' ? '6 أحرف أو أرقام على الأقل' : '••••••••'}
                      className="accent-focus w-full min-h-[48px] rounded-xl bg-slate-50 dark:bg-[#070C1A] border border-slate-200 dark:border-white/14 focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)] ps-10 pe-12 py-2.5 text-base sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all text-left"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                      aria-pressed={showPassword}
                      title={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                      className="absolute top-1/2 -translate-y-1/2 end-1.5 min-w-[40px] min-h-[40px] rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {/* Primary Submit Button */}
              <button
                type="submit"
                disabled={isBusy}
                className="accent-btn w-full min-h-[48px] rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.99]"
              >
                {loadingMethod === 'email' ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>
                      {mode === 'login'
                        ? 'جاري تسجيل الدخول...'
                        : mode === 'signup'
                          ? 'جاري إنشاء الحساب...'
                          : 'جاري إرسال الرابط...'}
                    </span>
                  </>
                ) : (
                  <span>
                    {mode === 'login'
                      ? 'تسجيل الدخول'
                      : mode === 'signup'
                        ? 'إنشاء الحساب'
                        : 'إرسال رابط الاستعادة'}
                  </span>
                )}
              </button>
            </form>

            {/* Sign Up & Forgot Password Links */}
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              {mode === 'login' ? (
                <>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => switchMode('signup')}
                    className="min-h-[36px] inline-flex items-center font-semibold hover:underline underline-offset-4 cursor-pointer transition-colors disabled:opacity-50"
                    style={{ color: 'var(--accent-text)' }}
                  >
                    إنشاء حساب جديد
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => switchMode('reset')}
                    className="min-h-[36px] inline-flex items-center text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:underline underline-offset-4 cursor-pointer transition-colors disabled:opacity-50"
                  >
                    نسيت كلمة المرور؟
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => switchMode('login')}
                  className="min-h-[36px] inline-flex items-center gap-1.5 font-semibold hover:underline underline-offset-4 cursor-pointer transition-colors disabled:opacity-50"
                  style={{ color: 'var(--accent-text)' }}
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>لديك حساب بالفعل؟ العودة لتسجيل الدخول</span>
                </button>
              )}
            </div>

            {/* Divider: أو */}
            <div className="my-5 flex items-center gap-3" role="separator" aria-label="أو">
              <div className="flex-1 border-t border-slate-200 dark:border-white/12" />
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 px-1">أو</span>
              <div className="flex-1 border-t border-slate-200 dark:border-white/12" />
            </div>

            {/* Social / Federated Provider Buttons */}
            <div className="space-y-2.5">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => onProviderSignIn('google')}
                className="w-full min-h-[48px] px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/14 bg-white dark:bg-[#111933]/80 hover:bg-slate-50 dark:hover:bg-[#172245] hover:border-slate-300 dark:hover:border-white/25 text-slate-800 dark:text-slate-100 text-sm font-medium flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.99]"
              >
                {loadingMethod === 'google' ? (
                  <span className="w-4 h-4 border-2 border-slate-400/40 border-t-slate-700 dark:border-t-white rounded-full animate-spin" />
                ) : (
                  <GoogleGlyph />
                )}
                <span className="whitespace-nowrap">المتابعة بحساب جوجل</span>
              </button>

              <button
                type="button"
                disabled={isBusy}
                onClick={() => onProviderSignIn('microsoft')}
                className="w-full min-h-[48px] px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/14 bg-white dark:bg-[#111933]/80 hover:bg-slate-50 dark:hover:bg-[#172245] hover:border-slate-300 dark:hover:border-white/25 text-slate-800 dark:text-slate-100 text-sm font-medium flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.99]"
              >
                {loadingMethod === 'microsoft' ? (
                  <span className="w-4 h-4 border-2 border-slate-400/40 border-t-slate-700 dark:border-t-white rounded-full animate-spin" />
                ) : (
                  <MicrosoftGlyph />
                )}
                <span className="whitespace-nowrap">المتابعة بحساب مايكروسوفت</span>
              </button>

              <button
                type="button"
                disabled={isBusy}
                onClick={() => onProviderSignIn('apple')}
                className="w-full min-h-[48px] px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/14 bg-white dark:bg-[#111933]/80 hover:bg-slate-50 dark:hover:bg-[#172245] hover:border-slate-300 dark:hover:border-white/25 text-slate-800 dark:text-slate-100 text-sm font-medium flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.99]"
              >
                {loadingMethod === 'apple' ? (
                  <span className="w-4 h-4 border-2 border-slate-400/40 border-t-slate-700 dark:border-t-white rounded-full animate-spin" />
                ) : (
                  <AppleGlyph />
                )}
                <span className="whitespace-nowrap">المتابعة بحساب آبل</span>
              </button>
            </div>

            {/* Quiet Security Note */}
            <div className="mt-5 pt-4 border-t border-slate-200/80 dark:border-white/10 flex items-center justify-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent-primary)' }} />
              <span>الدخول محمي بالتحقق الثنائي عبر Gmail</span>
            </div>
          </motion.section>
        </div>
      </main>

      {/* Quiet Footer */}
      <footer className="max-w-5xl w-full mx-auto flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 pt-3 border-t border-slate-200/70 dark:border-white/5">
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
