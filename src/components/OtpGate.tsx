import { useState, useEffect, useRef, FormEvent } from 'react';
import { User } from 'firebase/auth';
import { MailCheck, RefreshCw, ShieldCheck, LogOut, AlertCircle } from 'lucide-react';
import { NovaStarLogo } from './NovaStarLogo';
import { setOtpSessionToken } from '../lib/otpSession';

interface OtpGateProps {
  user: User;
  initialEmailMasked?: string;
  initialCooldownSec?: number;
  onVerified: () => void;
  onSignOut: () => Promise<void>;
}

export function OtpGate({
  user,
  initialEmailMasked,
  initialCooldownSec = 0,
  onVerified,
  onSignOut,
}: OtpGateProps) {
  const [code, setCode] = useState('');
  const [emailMasked, setEmailMasked] = useState(initialEmailMasked || user.email || '');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldownSec, setCooldownSec] = useState(initialCooldownSec);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const requestedInitialRef = useRef(false);

  const requestCode = async () => {
    if (sending || cooldownSec > 0) return;
    setSending(true);
    setErrorMsg(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        sent?: boolean;
        alreadyVerified?: boolean;
        emailMasked?: string;
        cooldownSec?: number;
        error?: string;
      };

      if (data.alreadyVerified) {
        onVerified();
        return;
      }
      if (!res.ok) {
        if (typeof data.cooldownSec === 'number' && data.cooldownSec > 0) {
          setCooldownSec(data.cooldownSec);
        }
        throw new Error(data.error || 'تعذر إرسال رمز التحقق إلى بريدك.');
      }
      if (data.emailMasked) {
        setEmailMasked(data.emailMasked);
      }
      setCooldownSec(typeof data.cooldownSec === 'number' ? data.cooldownSec : 60);
      setStatusMsg(
        'تم إرسال رمز تحقق مكون من 6 أرقام إلى بريدك في Gmail. إذا لم يظهر في البريد الوارد، تحقق من مجلد الرسائل غير المرغوب فيها (Spam).'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر إرسال رمز التحقق.');
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (!requestedInitialRef.current && initialCooldownSec === 0) {
      requestedInitialRef.current = true;
      requestCode();
    } else if (initialCooldownSec > 0) {
      setStatusMsg('تم إرسال رمز التحقق مؤخرًا إلى بريدك في Gmail. أدخل الرمز للمتابعة.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cooldownSec <= 0) return;
    const timer = setInterval(() => {
      setCooldownSec((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSec]);

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    const cleaned = code.replace(/\D/g, '').slice(0, 6);
    if (cleaned.length !== 6) {
      setErrorMsg('يرجى إدخال رمز التحقق المكوّن من 6 أرقام.');
      return;
    }

    setVerifying(true);
    setErrorMsg(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ code: cleaned }),
      });

      const data = (await res.json()) as {
        verified?: boolean;
        otpToken?: string;
        error?: string;
      };

      if (!res.ok || !data.verified || !data.otpToken) {
        throw new Error(data.error || 'رمز التحقق غير صحيح أو منتهي الصلاحية.');
      }

      setOtpSessionToken(data.otpToken);
      onVerified();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'فشل التحقق من الرمز.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="relative z-20 min-h-[100dvh] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md rounded-2xl bg-white/95 dark:bg-[#0B1020]/95 border border-slate-200 dark:border-white/15 p-6 sm:p-8 shadow-2xl space-y-6 backdrop-blur-md">
        <div className="flex flex-col items-center text-center space-y-3">
          <NovaStarLogo size="md" />
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--accent-text)' }}>
            <ShieldCheck className="w-4 h-4" />
            <span>التحقق الثنائي عبر Gmail</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            أدخل رمز التأكيد المرسل لبريدك
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            لحماية حسابك ومنع أي دخول غير مصرح به، أرسلنا رمزًا مكونًا من 6 أرقام إلى:
            <span dir="ltr" className="block font-mono font-semibold text-slate-900 dark:text-slate-200 mt-1">
              {emailMasked}
            </span>
          </p>
        </div>

        <form onSubmit={handleVerify} className="space-y-4">
          <div>
            <label htmlFor="otp-code-input" className="sr-only">
              رمز التحقق المكوّن من 6 أرقام
            </label>
            <input
              id="otp-code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                setErrorMsg(null);
              }}
              placeholder="000000"
              dir="ltr"
              className="accent-focus w-full text-center tracking-[0.45em] font-mono font-bold rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15 focus:outline-none px-4 py-3.5 text-2xl text-slate-900 dark:text-white"
            />
          </div>

          {statusMsg && !errorMsg && (
            <div className="flex items-start gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-200">
              <MailCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{statusMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div role="alert" className="flex items-start gap-2 rounded-xl bg-rose-500/10 border border-rose-500/35 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={verifying || code.length !== 6}
            className="accent-btn w-full py-3 rounded-xl text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
          >
            {verifying ? 'جاري التحقق من الرمز...' : 'تأكيد الرمز ودخول Nova AI'}
          </button>
        </form>

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-white/10 text-xs">
          <button
            type="button"
            disabled={sending || cooldownSec > 0}
            onClick={requestCode}
            className="inline-flex items-center gap-1.5 font-semibold cursor-pointer disabled:opacity-50"
            style={{ color: 'var(--accent-text)' }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${sending ? 'animate-spin' : ''}`} />
            <span>
              {sending
                ? 'جاري الإرسال...'
                : cooldownSec > 0
                  ? `إعادة الإرسال بعد ${cooldownSec}ث`
                  : 'إعادة إرسال الرمز'}
            </span>
          </button>

          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>تبديل الحساب</span>
          </button>
        </div>
      </div>
    </div>
  );
}
