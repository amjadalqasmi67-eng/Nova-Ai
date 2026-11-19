import { useState } from 'react';
import { Download, Share, PlusSquare, Smartphone, X, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'drawer' | 'card';
}

export function PWAInstallButton({ variant = 'header' }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [installing, setInstalling] = useState(false);

  const handleInstallClick = async () => {
    if (isInstallable) {
      setInstalling(true);
      try {
        await install();
      } finally {
        setInstalling(false);
      }
      return;
    }
    setShowGuideModal(true);
  };

  // Suppress compact header/drawer buttons once running inside installed standalone app
  if (isInstalled && variant !== 'card') {
    return null;
  }

  if (variant === 'card') {
    if (isInstalled) {
      return (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-200 text-xs sm:text-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          <div>
            <div className="font-bold">تم تثبيت Nova AI كتطبيق مستقل</div>
            <div className="text-xs opacity-85 mt-0.5">
              أنت تستخدم التطبيق الآن بنسخته المثبّتة على هذا الجهاز.
            </div>
          </div>
        </div>
      );
    }

    return (
      <>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10">
          <div className="space-y-1 min-w-0">
            <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Smartphone className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-primary)' }} />
              <span>تثبيت Nova AI كتطبيق على جهازك</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {isInstallable
                ? 'اضغط على زر التثبيت لإضافة أيقونة Nova AI إلى شاشة جهازك والوصول إليه مباشرة كتطبيق مستقل.'
                : isIOS
                  ? 'على أجهزة iPhone و iPad: يمكنك تثبيت التطبيق مباشرة عبر متصفح Safari ليظهر على شاشتك الرئيسية.'
                  : 'افتح رابط الموقع في متصفح Chrome أو Edge أو Safari لتثبيته كتطبيق على الهاتف أو الحاسوب.'}
            </p>
          </div>

          <button
            type="button"
            onClick={handleInstallClick}
            disabled={installing}
            className="accent-btn inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white text-xs sm:text-sm font-semibold transition-all cursor-pointer shrink-0 disabled:opacity-60"
          >
            <Download className="w-4 h-4" />
            <span>
              {installing
                ? 'جاري التثبيت...'
                : isInstallable
                  ? 'تثبيت التطبيق الآن'
                  : 'خطوات التثبيت على جهازك'}
            </span>
          </button>
        </div>

        {showGuideModal && (
          <InstallGuideModal isIOS={isIOS} onClose={() => setShowGuideModal(false)} />
        )}
      </>
    );
  }

  // Only show header / drawer button when directly installable (Chrome/Android/Desktop) or on iOS Safari
  if (!isInstallable && !isIOS) {
    return null;
  }

  if (variant === 'drawer') {
    return (
      <>
        <button
          type="button"
          onClick={handleInstallClick}
          disabled={installing}
          className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-semibold text-right transition-all cursor-pointer border min-h-[44px] text-white accent-btn"
        >
          <Download className="w-4 h-4 shrink-0" />
          <span>{isInstallable ? 'تثبيت التطبيق على الجهاز' : 'تثبيت على iPhone / iPad'}</span>
        </button>

        {showGuideModal && (
          <InstallGuideModal isIOS={isIOS} onClose={() => setShowGuideModal(false)} />
        )}
      </>
    );
  }

  // Default header variant
  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        disabled={installing}
        aria-label="تثبيت التطبيق"
        title="تثبيت Nova AI كتطبيق"
        className="inline-flex items-center justify-center gap-1.5 min-w-[40px] min-h-[40px] px-2.5 sm:px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold text-white accent-btn transition-all whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
      >
        <Download className="w-4 h-4 shrink-0" />
        <span className="hidden md:inline">تثبيت التطبيق</span>
      </button>

      {showGuideModal && (
        <InstallGuideModal isIOS={isIOS} onClose={() => setShowGuideModal(false)} />
      )}
    </>
  );
}

function InstallGuideModal({ isIOS, onClose }: { isIOS: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="تثبيت تطبيق Nova AI"
        className="w-full max-w-md rounded-2xl bg-white dark:bg-[#0B1020] border border-slate-200 dark:border-white/15 p-6 shadow-2xl space-y-5 text-right"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              {isIOS ? 'تثبيت Nova AI على iPhone / iPad' : 'تثبيت Nova AI على جهازك'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              اتبع الخطوات البسيطة التالية لتشغيل الموقع كتطبيق مستقل بأيقونته الخاصة:
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isIOS ? (
          <ol className="space-y-3 text-xs sm:text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
            <li className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10">
              <Share className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
              <span>
                1. افتح رابط الموقع في متصفح <strong>Safari</strong> واضغط على زر{' '}
                <strong>المشاركة (Share)</strong> في شريط المتصفح.
              </span>
            </li>
            <li className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10">
              <PlusSquare className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
              <span>
                2. مرّر للأسفل واختر <strong>«إضافة إلى الشاشة الرئيسية» (Add to Home Screen)</strong> ثم اضغط <strong>«إضافة»</strong>.
              </span>
            </li>
          </ol>
        ) : (
          <ol className="space-y-3 text-xs sm:text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
            <li className="p-3 rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10">
              <strong>على Android (Chrome):</strong> اضغط على قائمة المتصفح (⋮) ثم اختر{' '}
              <strong>«تثبيت التطبيق»</strong> أو <strong>«إضافة إلى الشاشة الرئيسية»</strong>.
            </li>
            <li className="p-3 rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10">
              <strong>على الكمبيوتر (Chrome / Edge):</strong> اضغط على أيقونة التثبيت في يمين شريط العنوان أو من قائمة المتصفح اختر{' '}
              <strong>«تثبيت Nova AI»</strong>.
            </li>
          </ol>
        )}

        <button
          type="button"
          onClick={onClose}
          className="accent-btn w-full py-2.5 rounded-xl text-white text-sm font-semibold cursor-pointer"
        >
          حسنًا، فهمت
        </button>
      </div>
    </div>
  );
}
