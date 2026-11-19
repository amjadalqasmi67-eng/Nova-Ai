import {
  MessageSquare,
  Zap,
  Paperclip,
  Settings,
  Sparkles,
  ArrowLeft,
  BookOpen,
  Mail,
} from 'lucide-react';

interface HelpPageProps {
  onUsePrompt: (prompt: string) => void;
  onGoToSettings: () => void;
  onGoToContact: () => void;
}

const GUIDE_STEPS = [
  {
    step: '01',
    icon: MessageSquare,
    title: 'ابدأ محادثة جديدة أو تابع محادثاتك السابقة',
    description:
      'من القائمة الجانبية في صفحة «المحادثة الذكية»، اضغط على «محادثة جديدة» لفتح موضوع جديد، أو اختر أي محادثة سابقة لمتابعتها من حيث توقفت.',
  },
  {
    step: '02',
    icon: Zap,
    title: 'اختر وضع الاستجابة المناسب لمهمتك',
    description:
      'استخدم «استجابة سريعة» للمهام اليومية والأسئلة المباشرة، أو انتقل إلى «تحليل عميق» عندما تحتاج تخطيطًا مفصلًا أو مراجعة برمجية دقيقة.',
  },
  {
    step: '03',
    icon: Paperclip,
    title: 'أرفق الصور لتحليلها فورًا',
    description:
      'اضغط على أيقونة المشبك بجانب حقل الكتابة لرفع صورة أو لقطة شاشة، ثم اكتب سؤالك عنها ليقرأ Nova AI محتواها ويشرحه لك.',
  },
  {
    step: '04',
    icon: Settings,
    title: 'خصص شخصية المساعد وألوان الواجهة',
    description:
      'من صفحة «الإعدادات» يمكنك كتابة تعليماتك الشخصية الدائمة للمساعد، وتغيير ألوان الواجهة، والتبديل بين الوضع الداكن والفاتح، وإضافة رمز قفل سريع.',
  },
];

const EXAMPLE_PROMPTS = [
  {
    category: 'التخطيط والإنتاجية',
    prompt: 'رتّب لي جدول مهام أسبوعي متوازن لتحقيق أهدافي الدراسية والمهنية خلال 5 ساعات يوميًا.',
  },
  {
    category: 'الكتابة والتحرير',
    prompt: 'أعد صياغة هذه الفكرة بأسلوب عربي احترافي وواضح مناسب لعرض تقديمي رسمي.',
  },
  {
    category: 'البرمجة والتقنية',
    prompt: 'اشرح لي كيفية تنظيم مكونات React بطريقة نظيفة تقلل إعادة التصيير وتحسن السرعة.',
  },
  {
    category: 'التلخيص والتعلّم',
    prompt: 'بسّط لي مفهوم الذكاء الاصطناعي التوليدي في نقاط عملية واضحة مع أمثلة من الحياة اليومية.',
  },
];

export function HelpPage({ onUsePrompt, onGoToSettings, onGoToContact }: HelpPageProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto max-w-5xl w-full mx-auto px-3.5 sm:px-6 py-5 sm:py-6 space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--accent-text)' }}>
            دليل الاستخدام العملي
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            كيف تستخدم <span dir="ltr">Nova AI</span> باحتراف؟
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1.5 max-w-2xl leading-relaxed">
            خطوات بسيطة وأمثلة جاهزة تساعدك على الحصول على أدق النتائج من المساعد في المحادثة اليومية.
          </p>
        </div>

        <button
          type="button"
          onClick={onGoToSettings}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-[#0B1020] border border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/25 text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-200 transition-colors cursor-pointer shrink-0 self-start sm:self-auto"
        >
          <Settings className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          <span>تخصيص الإعدادات</span>
        </button>
      </div>

      {/* Step-by-step Cards */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {GUIDE_STEPS.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.step}
              className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-6 space-y-3 backdrop-blur-md"
            >
              <div className="flex items-center justify-between">
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
                <span className="text-xs font-mono font-bold text-slate-400 dark:text-slate-500">
                  {item.step}
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                {item.title}
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {item.description}
              </p>
            </div>
          );
        })}
      </section>

      {/* Tryable Example Prompts */}
      <section className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-6 space-y-4 backdrop-blur-md">
        <div className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
          <BookOpen className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          <span>أمثلة أوامر جاهزة للتجربة</span>
        </div>
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
          اضغط على أي مثال لنقله مباشرة إلى صندوق كتابة المحادثة وتجربته مع <span dir="ltr">Nova AI</span>.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {EXAMPLE_PROMPTS.map((ex) => (
            <button
              key={ex.category}
              type="button"
              onClick={() => onUsePrompt(ex.prompt)}
              className="p-4 rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/25 text-right transition-all cursor-pointer group flex flex-col justify-between gap-3"
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--accent-text)' }}>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{ex.category}</span>
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                  {ex.prompt}
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white">
                <span>جرّب في المحادثة</span>
                <ArrowLeft className="w-3.5 h-3.5" />
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Need more help */}
      <section className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 backdrop-blur-md">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white">تحتاج مساعدة إضافية؟</h3>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
            إذا واجهت مشكلة فنية أو لديك استفسار، أرسل لنا رسالة مباشرة عبر نموذج التواصل.
          </p>
        </div>
        <button
          type="button"
          onClick={onGoToContact}
          className="accent-btn inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-xs sm:text-sm font-semibold cursor-pointer shrink-0 self-start sm:self-auto min-h-[44px]"
        >
          <Mail className="w-4 h-4" />
          <span>الانتقال إلى تواصل معنا</span>
        </button>
      </section>
    </div>
  );
}
