import { useState } from 'react';
import { ChevronDown, HelpCircle, Mail, ArrowLeft } from 'lucide-react';

interface FaqPageProps {
  onGoToContact: () => void;
  onGoToChat: () => void;
}

const FAQ_ITEMS = [
  {
    q: 'ما هو Nova AI وكيف أبدأ باستخدامه؟',
    a: 'Nova AI هو مساعد ذكاء اصطناعي شخصي باللغة العربية. بمجرد تسجيل الدخول بحسابك، يمكنك الانتقال إلى صفحة «المحادثة الذكية»، وكتابة أي سؤال أو طلب في الحقل السفلي ليصلك رد فوري منسّق باللغة العربية.',
  },
  {
    q: 'هل استخدام Nova AI مجاني؟',
    a: 'نعم، جميع صفحات الموقع وميزات المحادثة العربية وتحليل الصور في المحادثة وتخصيص الألوان والمظهر والتواصل معنا متاحة مجانًا بدون الحاجة إلى مفتاح مدفوع.',
  },
  {
    q: 'هل يمكنني إرفاق صور داخل المحادثة؟',
    a: 'نعم، اضغط على أيقونة المشبك بجانب مربع كتابة الرسالة لاختيار صورة من جهازك (بحد أقصى 6 ميجابايت)، ثم اكتب سؤالك حولها وسيقوم Nova AI بتحليل محتواها أو شرحها لك.',
  },
  {
    q: 'ما الفرق بين «استجابة سريعة» و«تحليل عميق» في المحادثة؟',
    a: 'وضع «استجابة سريعة» مناسب للأسئلة المباشرة، التلخيص، وصياغة الرسائل بسرعة فائقة. أما وضع «تحليل عميق» فيمنح النموذج وقت تفكير أعمق لحل المشكلات البرمجية المعقدة أو التخطيط الاستراتيجي.',
  },
  {
    q: 'كيف أغيّر ألوان الواجهة أو أبدّل بين الوضع الداكن والفاتح؟',
    a: 'افتح صفحة «الإعدادات» من أيقونة الترس في الشريط العلوي. يمكنك هناك التبديل بين الوضع الداكن والفاتح، والاختيار بين ألوان الواجهة (البنفسجي، الأزرق، الأخضر، الأحمر)، وتُحفظ اختياراتك تلقائيًا.',
  },
  {
    q: 'كيف أحافظ على خصوصية محادثاتي؟',
    a: 'جميع محادثاتك مرتبطة بحسابك الشخصي فقط ومحمية بقواعد أمان صارمة تمنع أي مستخدم آخر من الاطلاع عليها. يمكنك أيضًا تفعيل رمز قفل الشاشة السريع (PIN) من صفحة الإعدادات لإغلاق الجلسة مؤقتًا متى شئت.',
  },
  {
    q: 'كيف أرسل مشكلة أو اقتراحًا لتطوير الموقع؟',
    a: 'انتقل إلى صفحة «تواصل معنا» من القائمة العلوية، اكتب اسمك واختر نوع الرسالة (مشكلة تقنية، اقتراح تطوير، أو استفسار عام) ثم أرسلها، وسيتم حفظها مباشرة في قاعدة البيانات.',
  },
];

export function FaqPage({ onGoToContact, onGoToChat }: FaqPageProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto max-w-4xl w-full mx-auto px-3.5 sm:px-6 py-5 sm:py-6 space-y-5 sm:space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--accent-text)' }}>
          إجابات سريعة وواضحة
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
          الأسئلة الشائعة
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1.5">
          كل ما تحتاج معرفته حول استخدام <span dir="ltr">Nova AI</span> وإدارة حسابك وتخصيص الواجهة.
        </p>
      </div>

      {/* Accordion List */}
      <div className="space-y-3">
        {FAQ_ITEMS.map((item, idx) => {
          const isOpen = openIndex === idx;
          return (
            <div
              key={item.q}
              className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 overflow-hidden backdrop-blur-md transition-colors"
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpenIndex(isOpen ? null : idx)}
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-right cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <HelpCircle
                    className="w-4 h-4 shrink-0"
                    style={{ color: isOpen ? 'var(--accent-primary)' : undefined }}
                  />
                  <span className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">
                    {item.q}
                  </span>
                </div>
                <ChevronDown
                  className={`w-4 h-4 text-slate-500 shrink-0 transition-transform duration-200 ${
                    isOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {isOpen && (
                <div className="px-5 pb-5 pt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed border-t border-slate-100 dark:border-white/5">
                  {item.a}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer Help Banner */}
      <div className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 backdrop-blur-md">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">لم تجد إجابة لسؤالك؟</h2>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
            يمكنك مراسلتنا عبر صفحة التواصل أو سؤال المساعد مباشرة في المحادثة.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onGoToContact}
            className="accent-btn inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-xs sm:text-sm font-semibold cursor-pointer min-h-[44px]"
          >
            <Mail className="w-4 h-4" />
            <span>تواصل معنا</span>
          </button>
          <button
            type="button"
            onClick={onGoToChat}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 transition-colors cursor-pointer min-h-[44px]"
          >
            <span>المحادثة الذكية</span>
            <ArrowLeft className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
