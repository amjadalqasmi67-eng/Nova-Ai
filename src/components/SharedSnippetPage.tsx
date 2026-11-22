import { useState, useEffect } from 'react';
import { doc, getDoc, Timestamp } from 'firebase/firestore';
import {
  Share2,
  AlertCircle,
  Copy,
  Check,
  Volume2,
  Square,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { db } from '../firebase';
import { NovaStarLogo } from './NovaStarLogo';
import { MarkdownMessage } from './MarkdownMessage';
import { cleanTextForSpeech } from '../lib/voiceReader';

interface SharedSnippetPageProps {
  shareId: string;
  onGoHome: () => void;
}

interface SharedSnippetData {
  question: string;
  answer: string;
  createdAtMs: number;
}

export function SharedSnippetPage({ shareId, onGoHome }: SharedSnippetPageProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snippet, setSnippet] = useState<SharedSnippetData | null>(null);
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadSnippet = async () => {
      const cleanId = shareId.trim();
      if (!/^[a-zA-Z0-9_-]{20,128}$/.test(cleanId)) {
        if (!cancelled) {
          setError('رابط المشاركة غير صالح أو غير مكتمل.');
          setLoading(false);
        }
        return;
      }

      try {
        const snap = await getDoc(doc(db, 'sharedSnippets', cleanId));
        if (!snap.exists()) {
          if (!cancelled) {
            setError('تعذر العثور على هذه المشاركة. قد يكون الرابط محذوفًا أو غير صحيح.');
            setLoading(false);
          }
          return;
        }
        const data = snap.data();
        const createdMs = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now();
        if (!cancelled) {
          setSnippet({
            question: String(data.question || ''),
            answer: String(data.answer || ''),
            createdAtMs: createdMs,
          });
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('تعذر تحميل المحتوى المشترك حاليًا. يرجى المحاولة مجددًا.');
          setLoading(false);
        }
      }
    };

    loadSnippet();
    return () => {
      cancelled = true;
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [shareId]);

  const handleCopyAnswer = async () => {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet.answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked in sandboxed context
    }
  };

  const handleToggleBrowserSpeech = () => {
    if (!snippet || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const clean = cleanTextForSpeech(snippet.answer);
    if (!clean) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    const voices = window.speechSynthesis.getVoices();
    const arabicVoice = voices.find((v) => v.lang.toLowerCase().startsWith('ar'));
    if (arabicVoice) {
      utterance.voice = arabicVoice;
      utterance.lang = arabicVoice.lang;
    } else {
      utterance.lang = 'ar-SA';
    }
    utterance.rate = 0.98;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="relative z-10 min-h-[100dvh] flex flex-col justify-between">
      <header className="border-b border-slate-200 dark:border-white/10 bg-white/85 dark:bg-[#070B17]/90 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onGoHome}
            className="flex items-center gap-2.5 cursor-pointer shrink-0"
          >
            <NovaStarLogo size="sm" />
            <span dir="ltr" className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              Nova AI
            </span>
          </button>

          <button
            type="button"
            onClick={onGoHome}
            className="accent-btn inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-white text-xs sm:text-sm font-semibold cursor-pointer whitespace-nowrap"
          >
            <span>فتح Nova AI</span>
            <ArrowRight className="w-4 h-4 rotate-180" />
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-8 space-y-5">
        {loading ? (
          <div className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-10 text-center space-y-3 backdrop-blur-md">
            <NovaStarLogo size="md" />
            <p className="text-sm text-slate-600 dark:text-slate-300">جاري تحميل السؤال والإجابة المشتركة...</p>
          </div>
        ) : error || !snippet ? (
          <div className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-rose-500/30 p-8 text-center space-y-4 backdrop-blur-md">
            <div className="w-12 h-12 rounded-2xl mx-auto bg-rose-500/10 border border-rose-500/25 flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-rose-500" />
            </div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">رابط المشاركة غير متاح</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-md mx-auto">
              {error}
            </p>
            <button
              type="button"
              onClick={onGoHome}
              className="accent-btn inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold cursor-pointer"
            >
              <span>الانتقال إلى الصفحة الرئيسية</span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
              <div className="inline-flex items-center gap-2 font-semibold" style={{ color: 'var(--accent-text)' }}>
                <Share2 className="w-4 h-4" />
                <span>مشاركة محددة لسؤال وإجابة من Nova AI</span>
              </div>
              <div className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span>تُعرض هذه الإجابة فقط دون كشف بقية الحساب</span>
              </div>
            </div>

            {/* Question Card */}
            <section className="rounded-2xl bg-slate-100/90 dark:bg-[#121A33] border border-slate-200 dark:border-blue-500/20 p-5 space-y-2">
              <div className="text-xs font-bold text-slate-500 dark:text-slate-400">السؤال</div>
              <p className="text-sm sm:text-base text-slate-900 dark:text-slate-100 leading-relaxed whitespace-pre-wrap break-words">
                {snippet.question}
              </p>
            </section>

            {/* Answer Card */}
            <section className="rounded-2xl bg-white/95 dark:bg-[#070B18]/95 border border-slate-200 dark:border-white/15 p-5 sm:p-6 space-y-4 backdrop-blur-md">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <NovaStarLogo size="sm" />
                  <span className="text-sm font-bold text-slate-900 dark:text-white">إجابة Nova AI</span>
                </div>

                <div className="flex items-center gap-2">
                  {typeof window !== 'undefined' && 'speechSynthesis' in window && (
                    <button
                      type="button"
                      onClick={handleToggleBrowserSpeech}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer"
                    >
                      {speaking ? (
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
                  )}

                  <button
                    type="button"
                    onClick={handleCopyAnswer}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span>تم النسخ</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>نسخ الإجابة</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <MarkdownMessage content={snippet.answer} />
            </section>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-200 dark:border-white/10 py-3 px-4 sm:px-6 text-center text-xs text-slate-500">
        Nova AI · منصة الذكاء الاصطناعي العربية
      </footer>
    </div>
  );
}
