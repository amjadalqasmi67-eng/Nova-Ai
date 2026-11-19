import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  deleteDoc,
  Timestamp,
} from 'firebase/firestore';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Inbox,
  CheckCircle2,
  Clock,
  Trash2,
  Search,
  Sparkles,
  Lock,
  ArrowRight,
  BarChart3,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { OwnerAnalyticsDashboard } from './OwnerAnalyticsDashboard';

export const OWNER_ADMIN_EMAIL = 'amjad.alqasmi67@gmail.com';

export function isOwnerAdmin(user: User | null): boolean {
  if (!user || !user.emailVerified) return false;
  return (user.email || '').toLowerCase() === OWNER_ADMIN_EMAIL;
}

type MessageCategory = 'issue' | 'suggestion' | 'general';
type TriageLevel = 'pending' | 'simple' | 'urgent';
type DashboardFilter = 'urgent' | 'all' | 'simple' | 'reviewed';

interface ContactMessageRecord {
  id: string;
  userId: string;
  senderName: string;
  senderEmail: string;
  category: MessageCategory;
  message: string;
  status: 'new' | 'reviewed';
  triageLevel: TriageLevel;
  aiReply: string;
  aiSummary: string;
  createdAtMs: number;
}

interface OwnerDashboardPageProps {
  user: User;
  onBackToChat: () => void;
}

const CATEGORY_LABELS: Record<MessageCategory, string> = {
  issue: 'مشكلة تقنية',
  suggestion: 'اقتراح تطوير',
  general: 'استفسار عام',
};

export function OwnerDashboardPage({ user, onBackToChat }: OwnerDashboardPageProps) {
  const authorized = isOwnerAdmin(user);

  const [records, setRecords] = useState<ContactMessageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<'analytics' | 'messages'>('analytics');
  const [filter, setFilter] = useState<DashboardFilter>('urgent');
  const [categoryFilter, setCategoryFilter] = useState<'all' | MessageCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!authorized) {
      setLoading(false);
      return;
    }

    const q = query(collection(db, 'contactMessages'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: ContactMessageRecord[] = snapshot.docs.map((d) => {
          const data = d.data();
          const created = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now();
          const cat: MessageCategory =
            data.category === 'issue' || data.category === 'suggestion' || data.category === 'general'
              ? data.category
              : 'general';
          const triage: TriageLevel =
            data.triageLevel === 'urgent' || data.triageLevel === 'simple' ? data.triageLevel : 'pending';
          return {
            id: d.id,
            userId: String(data.userId || ''),
            senderName: String(data.senderName || ''),
            senderEmail: String(data.senderEmail || ''),
            category: cat,
            message: String(data.message || ''),
            status: data.status === 'reviewed' ? 'reviewed' : 'new',
            triageLevel: triage,
            aiReply: String(data.aiReply || ''),
            aiSummary: String(data.aiSummary || ''),
            createdAtMs: created,
          };
        });
        // Urgent active messages first, then newest
        items.sort((a, b) => {
          const aUrgentActive = a.triageLevel === 'urgent' && a.status === 'new' ? 1 : 0;
          const bUrgentActive = b.triageLevel === 'urgent' && b.status === 'new' ? 1 : 0;
          if (aUrgentActive !== bUrgentActive) return bUrgentActive - aUrgentActive;
          return b.createdAtMs - a.createdAtMs;
        });
        setRecords(items);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        handleFirestoreError(err, OperationType.LIST, 'contactMessages');
      }
    );

    return () => unsubscribe();
  }, [authorized]);

  if (!authorized) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl bg-white/95 dark:bg-[#0B1020]/95 border border-rose-500/35 p-8 text-center space-y-4 backdrop-blur-md">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mx-auto text-rose-500">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            صلاحية مقصورة على مالك الموقع فقط
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            هذه اللوحة مخصصة لمالك ومطور <span dir="ltr">Nova AI</span> فقط لمتابعة الرسائل العاجلة وكل مراسلات المستخدمين.
          </p>
          <button
            type="button"
            onClick={onBackToChat}
            className="accent-btn inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold cursor-pointer"
          >
            <ArrowRight className="w-4 h-4" />
            <span>العودة إلى المحادثة</span>
          </button>
        </div>
      </div>
    );
  }

  const handleToggleStatus = async (item: ContactMessageRecord) => {
    const nextStatus = item.status === 'new' ? 'reviewed' : 'new';
    const path = `contactMessages/${item.id}`;
    try {
      await updateDoc(doc(db, path), {
        status: nextStatus,
        triageLevel: item.triageLevel,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const handleToggleUrgency = async (item: ContactMessageRecord) => {
    const nextTriage: TriageLevel = item.triageLevel === 'urgent' ? 'simple' : 'urgent';
    const path = `contactMessages/${item.id}`;
    try {
      await updateDoc(doc(db, path), {
        status: item.status,
        triageLevel: nextTriage,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const handleDelete = async (id: string) => {
    const path = `contactMessages/${id}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const urgentActiveCount = records.filter((r) => r.triageLevel === 'urgent' && r.status === 'new').length;
  const urgentTotalCount = records.filter((r) => r.triageLevel === 'urgent').length;
  const simpleCount = records.filter((r) => r.triageLevel === 'simple').length;
  const reviewedCount = records.filter((r) => r.status === 'reviewed').length;

  const filteredRecords = records.filter((item) => {
    if (filter === 'urgent' && item.triageLevel !== 'urgent') return false;
    if (filter === 'simple' && item.triageLevel !== 'simple') return false;
    if (filter === 'reviewed' && item.status !== 'reviewed') return false;
    if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
    if (searchQuery.trim()) {
      const needle = searchQuery.trim().toLowerCase();
      const hay = `${item.senderName} ${item.senderEmail} ${item.message} ${item.aiSummary}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const formatDate = (ms: number) =>
    new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ms));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto max-w-6xl w-full mx-auto px-3.5 sm:px-6 py-5 sm:py-6 space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold mb-1.5" style={{ color: 'var(--accent-text)' }}>
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>لوحة مالك الموقع الخاصة · وصول حصري</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            لوحة تحكم المالك والبيانات
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            متابعة حية لنمو المستخدمين والزيارات اليومية مع إدارة البلاغات والرسائل العاجلة.
          </p>
        </div>

        <button
          type="button"
          onClick={onBackToChat}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-[#0B1020] border border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/25 text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-200 transition-colors cursor-pointer shrink-0 self-start sm:self-auto"
        >
          <ArrowRight className="w-4 h-4" />
          <span>العودة للمحادثة</span>
        </button>
      </div>

      {/* Section Switcher: Analytics Dashboard vs Messages Triage */}
      <div className="flex flex-wrap sm:inline-flex items-center gap-1.5 p-1.5 rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setActiveSection('analytics')}
          className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors cursor-pointer border whitespace-nowrap ${
            activeSection === 'analytics'
              ? 'accent-active-tab text-slate-900 dark:text-white'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <BarChart3 className="w-4 h-4 shrink-0" style={activeSection === 'analytics' ? { color: 'var(--accent-primary)' } : undefined} />
          <span>لوحة البيانات والرسوم</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('messages')}
          className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors cursor-pointer border whitespace-nowrap ${
            activeSection === 'messages'
              ? 'accent-active-tab text-slate-900 dark:text-white'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Inbox className="w-4 h-4 shrink-0" style={activeSection === 'messages' ? { color: 'var(--accent-primary)' } : undefined} />
          <span>البلاغات والرسائل ({records.length})</span>
          {urgentActiveCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-md bg-rose-600 text-white text-[10px] font-bold tabular-nums">
              {urgentActiveCount} عاجلة
            </span>
          )}
        </button>
      </div>

      {/* Urgent Alert Banner if active urgent messages exist */}
      {urgentActiveCount > 0 && (
        <div className="rounded-2xl bg-rose-500/10 border border-rose-500/35 px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-bold text-rose-700 dark:text-rose-200">
                لديك {urgentActiveCount} {urgentActiveCount === 1 ? 'رسالة عاجلة' : 'رسائل عاجلة'} بانتظار المراجعة
              </div>
              <p className="text-xs text-rose-600 dark:text-rose-300/90 mt-0.5">
                صنّفها المساعد كمشاكل تقنية كبيرة أو شكاوى جدية تحتاج تدخلك المباشر.
              </p>
            </div>
          </div>
          {(activeSection !== 'messages' || filter !== 'urgent') && (
            <button
              type="button"
              onClick={() => {
                setActiveSection('messages');
                setFilter('urgent');
              }}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer shrink-0 self-start sm:self-auto"
            >
              عرض العاجلة فقط
            </button>
          )}
        </div>
      )}

      {activeSection === 'analytics' ? (
        <OwnerAnalyticsDashboard />
      ) : (
        <>

      {/* 4 Summary Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <button
          type="button"
          onClick={() => setFilter('urgent')}
          className={`p-4 rounded-2xl border text-right transition-all cursor-pointer backdrop-blur-md ${
            filter === 'urgent'
              ? 'bg-rose-500/10 border-rose-500/45'
              : 'bg-white/90 dark:bg-[#0B1020]/90 border-slate-200 dark:border-white/10 hover:border-rose-500/30'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-rose-600 dark:text-rose-300 font-semibold">
            <span>الرسائل العاجلة</span>
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white mt-2 tabular-nums">
            {urgentTotalCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            منها {urgentActiveCount} بانتظار المراجعة
          </div>
        </button>

        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`p-4 rounded-2xl border text-right transition-all cursor-pointer backdrop-blur-md ${
            filter === 'all'
              ? 'accent-active-tab'
              : 'bg-white/90 dark:bg-[#0B1020]/90 border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/25'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
            <span>كل الرسائل</span>
            <Inbox className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white mt-2 tabular-nums">
            {records.length}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">إجمالي الوارد بالقاعدة</div>
        </button>

        <button
          type="button"
          onClick={() => setFilter('simple')}
          className={`p-4 rounded-2xl border text-right transition-all cursor-pointer backdrop-blur-md ${
            filter === 'simple'
              ? 'accent-active-tab'
              : 'bg-white/90 dark:bg-[#0B1020]/90 border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/25'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-emerald-600 dark:text-emerald-300">
            <span>ردّ المساعد تلقائيًا</span>
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white mt-2 tabular-nums">
            {simpleCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">أسئلة ومشكلات بسيطة</div>
        </button>

        <button
          type="button"
          onClick={() => setFilter('reviewed')}
          className={`p-4 rounded-2xl border text-right transition-all cursor-pointer backdrop-blur-md ${
            filter === 'reviewed'
              ? 'accent-active-tab'
              : 'bg-white/90 dark:bg-[#0B1020]/90 border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/25'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
            <span>تمت المراجعة</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white mt-2 tabular-nums">
            {reviewedCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">حالات مغلقة ومُعالجة</div>
        </button>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'urgent' as const, label: `العاجلة (${urgentTotalCount})` },
            { id: 'all' as const, label: `الكل (${records.length})` },
            { id: 'simple' as const, label: `رد المساعد (${simpleCount})` },
            { id: 'reviewed' as const, label: `المُراجعة (${reviewedCount})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer border ${
                filter === tab.id
                  ? 'accent-active-tab text-slate-900 dark:text-white'
                  : 'bg-slate-50 dark:bg-[#060916] border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | MessageCategory)}
            aria-label="تصفية حسب النوع"
            className="accent-focus rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
          >
            <option value="all">جميع التصنيفات</option>
            <option value="issue">مشكلة تقنية</option>
            <option value="suggestion">اقتراح تطوير</option>
            <option value="general">استفسار عام</option>
          </select>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث بالاسم أو البريد أو النص..."
              className="accent-focus w-full sm:w-64 rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 pr-9 pl-3 py-2 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Messages Feed */}
      {loading ? (
        <div className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
          جاري تحميل رسائل لوحة المالك...
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 py-14 px-6 text-center space-y-2 backdrop-blur-md">
          <p className="text-base font-semibold text-slate-800 dark:text-slate-200">
            لا توجد رسائل مطابقة لهذا التصفية حاليًا
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            جرّب اختيار «الكل» لعرض جميع الرسائل المحفوظة في قاعدة البيانات.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredRecords.map((item) => (
            <article
              key={item.id}
              className={`rounded-2xl border p-5 sm:p-6 space-y-4 backdrop-blur-md ${
                item.triageLevel === 'urgent'
                  ? 'bg-rose-500/[0.06] dark:bg-rose-950/20 border-rose-500/35'
                  : 'bg-white/90 dark:bg-[#0B1020]/90 border-slate-200 dark:border-white/10'
              }`}
            >
              {/* Card Top Meta & Actions */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-bold text-slate-900 dark:text-white">
                      {item.senderName}
                    </span>
                    <span
                      className="text-[11px] font-semibold px-2.5 py-0.5 rounded-md border"
                      style={{
                        borderColor: 'var(--accent-border)',
                        backgroundColor: 'var(--accent-soft)',
                        color: 'var(--accent-text)',
                      }}
                    >
                      {CATEGORY_LABELS[item.category]}
                    </span>
                    {item.triageLevel === 'urgent' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-rose-500/15 border border-rose-500/40 text-rose-700 dark:text-rose-300">
                        <AlertTriangle className="w-3 h-3" />
                        <span>رسالة عاجلة</span>
                      </span>
                    ) : item.triageLevel === 'simple' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>ردّ المساعد مباشرة</span>
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium text-amber-600 dark:text-amber-300">
                        بانتظار التحليل
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <span dir="ltr" className="font-mono break-all">
                      {item.senderEmail}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatDate(item.createdAtMs)}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(item)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
                      item.status === 'reviewed'
                        ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-700 dark:text-emerald-300'
                        : 'bg-white dark:bg-[#060916] border-slate-200 dark:border-white/15 text-slate-700 dark:text-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {item.status === 'reviewed' ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>تمت المراجعة</span>
                      </>
                    ) : (
                      <>
                        <Clock className="w-3.5 h-3.5" />
                        <span>تحديد كمُراجعة</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleToggleUrgency(item)}
                    className="px-3 py-1.5 rounded-xl bg-white dark:bg-[#060916] border border-slate-200 dark:border-white/15 hover:border-slate-300 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
                  >
                    {item.triageLevel === 'urgent' ? 'إلغاء الاستعجال' : 'تصنيف كعاجلة'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    aria-label="حذف الرسالة"
                    title="حذف الرسالة"
                    className="p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* User Message Body */}
              <div className="p-3.5 sm:p-4 rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
                  نص رسالة المستخدم:
                </div>
                <p className="text-sm text-slate-900 dark:text-slate-100 leading-relaxed whitespace-pre-wrap break-words">
                  {item.message}
                </p>
              </div>

              {/* AI Summary & Reply */}
              {(item.aiSummary || item.aiReply) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {item.aiSummary && (
                    <div className="p-3.5 rounded-xl bg-slate-50/70 dark:bg-[#080E20] border border-slate-200 dark:border-white/10">
                      <div className="text-[11px] font-bold mb-1" style={{ color: 'var(--accent-text)' }}>
                        ملخص التحليل الذكي:
                      </div>
                      <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                        {item.aiSummary}
                      </p>
                    </div>
                  )}
                  {item.aiReply && (
                    <div className="p-3.5 rounded-xl bg-slate-50/70 dark:bg-[#080E20] border border-slate-200 dark:border-white/10">
                      <div className="text-[11px] font-bold mb-1 text-slate-600 dark:text-slate-400">
                        الرد المعروض للمستخدم:
                      </div>
                      <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                        {item.aiReply}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
        </>
      )}
    </div>
  );
}
