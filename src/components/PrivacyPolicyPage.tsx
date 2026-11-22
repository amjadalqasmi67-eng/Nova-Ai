import { ArrowRight, ShieldCheck, Database, MessageSquare, Lock, Trash2 } from 'lucide-react';

interface PrivacyPolicyPageProps {
  onBack: () => void;
  backLabel?: string;
}

const POLICY_SECTIONS = [
  {
    icon: Database,
    title: '١. بيانات الحساب والتفضيلات',
    description:
      'عند تسجيل الدخول عبر Google، نحفظ معلومات الحساب الأساسية اللازمة لتشغيل مساحتك الشخصية: الاسم، البريد الإلكتروني، الصورة الشخصية، بالإضافة إلى اسم العرض المخصص وإعدادات المظهر والتعليمات الشخصية التي تحددها.',
  },
  {
    icon: MessageSquare,
    title: '٢. المحادثات والرسائل وسجل المذاكرة',
    description:
      'تُحفظ محادثاتك النصية والصوتية وسجل الدروس والاختبارات ورسائل التواصل المرتبطة بحسابك في قاعدة البيانات حتى تتمكن من الرجوع إليها من أي جهاز. وعند اختيارك مشاركة سؤال وجواب محددين عبر رابط، يُعرض ذلك المقطع فقط دون كشف حسابك أو بقية محادثاتك.',
  },
  {
    icon: Lock,
    title: '٣. المعالجة عبر الخادم والحماية',
    description:
      'تُرسل طلبات الذكاء الاصطناعي (المحادثة، الصوت، تحليل الصور، العروض، والاختبارات) عبر خادم Nova AI الآمن فقط مع تشفير الاتصال، والتحقق من الجلسة، وتحديد عدد الطلبات لحماية الخدمة.',
  },
  {
    icon: Trash2,
    title: '٤. التحكم في بياناتك وحذفها',
    description:
      'يمكنك في أي وقت تعديل اسم العرض أو التعليمات الشخصية أو صورة الحساب من الإعدادات، وحذف أي محادثة أو رسالة تواصل مباشرة من حسابك، أو تسجيل الخروج متى شئت.',
  },
];

export function PrivacyPolicyPage({ onBack, backLabel = 'العودة' }: PrivacyPolicyPageProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto max-w-4xl w-full mx-auto px-3.5 sm:px-6 py-5 sm:py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold mb-1.5" style={{ color: 'var(--accent-text)' }}>
            <ShieldCheck className="w-4 h-4" />
            <span>الشفافية وحماية البيانات · Nova AI</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            سياسة الخصوصية
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
            شرح موجز وواضح للبيانات التي تُحفظ في Nova AI وكيفية حمايتها.
          </p>
        </div>

        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-[#0B1020] border border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/25 text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-200 transition-colors cursor-pointer shrink-0"
        >
          <ArrowRight className="w-4 h-4" />
          <span>{backLabel}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {POLICY_SECTIONS.map((item) => {
          const Icon = item.icon;
          return (
            <section
              key={item.title}
              className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-5 sm:p-6 space-y-2.5 backdrop-blur-md"
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
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                {item.title}
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {item.description}
              </p>
            </section>
          );
        })}
      </div>

      <div className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed backdrop-blur-md">
        لا نبيع بيانات المستخدمين ولا نشارك محتوى محادثاتك مع أطراف إعلانية. استخدامك لموقع{' '}
        <span dir="ltr" className="font-semibold text-slate-800 dark:text-slate-200">
          Nova AI
        </span>{' '}
        يعني موافقتك على حفظ بيانات الحساب والمحادثات والرسائل بالصورة الموضحة أعلاه لتشغيل الخدمة.
      </div>
    </div>
  );
}
