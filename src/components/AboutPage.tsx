import { MessageSquare, ShieldCheck, Palette, Image as ImageIcon, Sparkles, ArrowLeft, Mail } from 'lucide-react';
import { NovaStarLogo } from './NovaStarLogo';

interface AboutPageProps {
  onGoToChat: () => void;
  onGoToContact: () => void;
}

const PILLARS = [
  {
    icon: MessageSquare,
    title: 'فهم متقدّم للغة العربية',
    description:
      'صُمم Nova AI ليفهم صياغتك العربية بدقة، ويجيبك بأسلوب منظم في الكتابة والبرمجة والتحليل والتخطيط.',
  },
  {
    icon: ImageIcon,
    title: 'تحليل الصور داخل المحادثة',
    description:
      'يمكنك إرفاق لقطات شاشة أو مستندات مصوّرة مباشرة داخل المحادثة ليقرأها المساعد ويشرحها أو يستخرج بياناتها.',
  },
  {
    icon: ShieldCheck,
    title: 'بوابة خاصة ومحمية',
    description:
      'لا يدخل أحد إلى مساحتك إلا بعد التحقق من الحساب، مع عزل تام لسجل محادثاتك وإمكانية تفعيل قفل شاشة سريع.',
  },
  {
    icon: Palette,
    title: 'تخصيص بصري مرن',
    description:
      'بدّل بين الوضع الداكن الفضائي والوضع الفاتح النقي، واختر لون الواجهة الذي يفضّله ذوقك مع حفظ فوري لتفضيلاتك.',
  },
];

export function AboutPage({ onGoToChat, onGoToContact }: AboutPageProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto max-w-5xl w-full mx-auto px-3.5 sm:px-6 py-5 sm:py-6 space-y-6 sm:space-y-8">
      {/* Hero Card */}
      <section className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-5 sm:p-8 backdrop-blur-md">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 md:gap-8">
          <div className="space-y-4 max-w-2xl w-full min-w-0">
            <p className="text-xs font-semibold" style={{ color: 'var(--accent-text)' }}>
              من نحن · رؤية <span dir="ltr">Nova AI</span>
            </p>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-900 dark:text-white leading-tight">
              مساحة ذكاء اصطناعي عربية صُممت لتكون رفيقك الشخصي اليومي
            </h1>
            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
              <span dir="ltr" className="font-semibold text-slate-900 dark:text-white">
                Nova AI
              </span>{' '}
              هو مساعد ذكاء اصطناعي شخصي يجمع بين البساطة والسرعة والخصوصية في بيئة فضائية هادئة تدعم اللغة العربية من اليمين إلى اليسار بشكل أصيل. هدفنا أن تملك أداة موثوقة تساعدك على التفكير، الإنجاز، التعلم، وحل المشكلات اليومية بدون تعقيد.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={onGoToChat}
                className="accent-btn inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold cursor-pointer min-h-[44px]"
              >
                <span>ابدأ محادثة الآن</span>
                <ArrowLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onGoToContact}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-sm font-semibold text-slate-800 dark:text-slate-200 transition-colors cursor-pointer min-h-[44px]"
              >
                <Mail className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                <span>تواصل معنا</span>
              </button>
            </div>
          </div>

          <div className="mx-auto md:mx-0 shrink-0 w-32 h-32 sm:w-40 sm:h-40 md:w-44 md:h-44 rounded-full bg-slate-100/80 dark:bg-[#070B18]/80 border border-slate-200 dark:border-blue-400/20 flex items-center justify-center shadow-lg">
            <NovaStarLogo size="lg" />
          </div>
        </div>
      </section>

      {/* Core Pillars */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PILLARS.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.title}
              className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-6 space-y-3 backdrop-blur-md"
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center border"
                style={{
                  backgroundColor: 'var(--accent-soft)',
                  borderColor: 'var(--accent-border)',
                  color: 'var(--accent-primary)',
                }}
              >
                <Icon className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{item.title}</h2>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {item.description}
              </p>
            </div>
          );
        })}
      </section>

      {/* How It Works Summary */}
      <section className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-6 backdrop-blur-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--accent-primary)' }} />
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              مبني ليبقى مجانيًا، سريعًا، ومستقرًا
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              نعتمد في <span dir="ltr">Nova AI</span> على نماذج <span dir="ltr">Gemini</span> النصية المستقرة مع حفظ تلقائي للمحادثات والتفضيلات عبر حسابك الشخصي.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
