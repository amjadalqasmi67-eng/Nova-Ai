import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import {
  collection,
  onSnapshot,
  query,
  Timestamp,
} from 'firebase/firestore';
import {
  Users,
  Eye,
  TrendingUp,
  UserPlus,
  Smartphone,
  Tablet,
  Monitor,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';

interface VisitRecord {
  id: string;
  userId: string;
  dateKey: string;
  deviceType: 'mobile' | 'tablet' | 'desktop';
  createdAtMs: number;
}

interface UserSignupRecord {
  id: string;
  createdAtMs: number;
}

type DateRangeDays = 7 | 14 | 30;
type GrowthViewMode = 'cumulative' | 'daily';

function toLocalDateKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatShortArabicDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  return new Intl.DateTimeFormat('ar-SA', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

interface ChartPoint {
  dateKey: string;
  label: string;
  visits: number;
  uniqueVisitors: number;
  newUsers: number;
  cumulativeUsers: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    color?: string;
    payload?: ChartPoint;
  }>;
}

function VisitsTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div
      dir="rtl"
      className="rounded-xl bg-white/95 dark:bg-[#070B18]/95 border border-slate-200 dark:border-white/15 px-3.5 py-2.5 shadow-xl text-xs space-y-1.5 backdrop-blur-md"
    >
      <div className="font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-1">
        {point.label} <span className="font-mono text-[10px] text-slate-500">({point.dateKey})</span>
      </div>
      <div className="flex items-center justify-between gap-4 text-slate-700 dark:text-slate-200">
        <span>إجمالي الزيارات</span>
        <span className="font-bold tabular-nums font-mono text-blue-600 dark:text-blue-400">
          {point.visits}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4 text-slate-700 dark:text-slate-200">
        <span>الزوار الفريدون</span>
        <span className="font-bold tabular-nums font-mono text-violet-600 dark:text-violet-400">
          {point.uniqueVisitors}
        </span>
      </div>
    </div>
  );
}

function UsersGrowthTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div
      dir="rtl"
      className="rounded-xl bg-white/95 dark:bg-[#070B18]/95 border border-slate-200 dark:border-white/15 px-3.5 py-2.5 shadow-xl text-xs space-y-1.5 backdrop-blur-md"
    >
      <div className="font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-1">
        {point.label} <span className="font-mono text-[10px] text-slate-500">({point.dateKey})</span>
      </div>
      <div className="flex items-center justify-between gap-4 text-slate-700 dark:text-slate-200">
        <span>مستخدمون جدد</span>
        <span className="font-bold tabular-nums font-mono text-emerald-600 dark:text-emerald-400">
          +{point.newUsers}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4 text-slate-700 dark:text-slate-200">
        <span>إجمالي المستخدمين</span>
        <span className="font-bold tabular-nums font-mono text-indigo-600 dark:text-indigo-400">
          {point.cumulativeUsers}
        </span>
      </div>
    </div>
  );
}

export function OwnerAnalyticsDashboard() {
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [users, setUsers] = useState<UserSignupRecord[]>([]);
  const [loadingVisits, setLoadingVisits] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [rangeDays, setRangeDays] = useState<DateRangeDays>(14);
  const [growthMode, setGrowthMode] = useState<GrowthViewMode>('cumulative');

  useEffect(() => {
    const visitsQuery = query(collection(db, 'visitLogs'));
    const unsubVisits = onSnapshot(
      visitsQuery,
      (snap) => {
        const list: VisitRecord[] = snap.docs.map((d) => {
          const data = d.data();
          const created = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now();
          const dev =
            data.deviceType === 'mobile' || data.deviceType === 'tablet' || data.deviceType === 'desktop'
              ? data.deviceType
              : 'desktop';
          return {
            id: d.id,
            userId: String(data.userId || ''),
            dateKey: typeof data.dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.dateKey)
              ? data.dateKey
              : toLocalDateKey(created),
            deviceType: dev,
            createdAtMs: created,
          };
        });
        setVisits(list);
        setLoadingVisits(false);
      },
      (err) => {
        setLoadingVisits(false);
        handleFirestoreError(err, OperationType.LIST, 'visitLogs');
      }
    );

    const usersQuery = query(collection(db, 'users'));
    const unsubUsers = onSnapshot(
      usersQuery,
      (snap) => {
        const list: UserSignupRecord[] = snap.docs.map((d) => {
          const data = d.data();
          const created = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now();
          return {
            id: d.id,
            createdAtMs: created,
          };
        });
        setUsers(list);
        setLoadingUsers(false);
      },
      (err) => {
        setLoadingUsers(false);
        handleFirestoreError(err, OperationType.LIST, 'users');
      }
    );

    return () => {
      unsubVisits();
      unsubUsers();
    };
  }, []);

  const analytics = useMemo(() => {
    const now = new Date();
    const todayKey = toLocalDateKey(now.getTime());

    // Build chronological date keys for [today - (rangeDays - 1) .. today]
    const dateKeys: string[] = [];
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      dateKeys.push(toLocalDateKey(d.getTime()));
    }
    const firstKey = dateKeys[0];

    const visitsByDay = new Map<string, { count: number; uniqueUids: Set<string> }>();
    for (const k of dateKeys) {
      visitsByDay.set(k, { count: 0, uniqueUids: new Set() });
    }

    const deviceCounts = { mobile: 0, tablet: 0, desktop: 0 };
    let visitsInRange = 0;
    const uniqueUsersInRange = new Set<string>();

    for (const v of visits) {
      const bucket = visitsByDay.get(v.dateKey);
      if (bucket) {
        bucket.count += 1;
        if (v.userId) {
          bucket.uniqueUids.add(v.userId);
          uniqueUsersInRange.add(v.userId);
        }
        visitsInRange += 1;
        deviceCounts[v.deviceType] += 1;
      }
    }

    // Group user signups by day
    const newUsersByDay = new Map<string, number>();
    let baselineUsersBeforeRange = 0;
    let newUsersInRange = 0;

    for (const u of users) {
      const key = toLocalDateKey(u.createdAtMs);
      if (key < firstKey) {
        baselineUsersBeforeRange += 1;
      } else if (key <= todayKey) {
        newUsersByDay.set(key, (newUsersByDay.get(key) || 0) + 1);
        newUsersInRange += 1;
      }
    }

    let runningTotal = baselineUsersBeforeRange;
    const series: ChartPoint[] = dateKeys.map((key) => {
      const vBucket = visitsByDay.get(key)!;
      const dayNewUsers = newUsersByDay.get(key) || 0;
      runningTotal += dayNewUsers;
      return {
        dateKey: key,
        label: formatShortArabicDate(key),
        visits: vBucket.count,
        uniqueVisitors: vBucket.uniqueUids.size,
        newUsers: dayNewUsers,
        cumulativeUsers: runningTotal,
      };
    });

    const todayBucket = visitsByDay.get(todayKey);
    const todayVisits = todayBucket ? todayBucket.count : 0;
    const todayUniqueVisitors = todayBucket ? todayBucket.uniqueUids.size : 0;
    const growthPercent =
      baselineUsersBeforeRange > 0
        ? Math.round((newUsersInRange / baselineUsersBeforeRange) * 100)
        : newUsersInRange > 0
          ? 100
          : 0;

    return {
      series,
      totalAllTimeVisits: visits.length,
      visitsInRange,
      todayVisits,
      todayUniqueVisitors,
      uniqueVisitorsInRange: uniqueUsersInRange.size,
      totalUsers: users.length,
      newUsersInRange,
      growthPercent,
      deviceCounts,
    };
  }, [visits, users, rangeDays]);

  const isLoading = loadingVisits || loadingUsers;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="h-24 rounded-2xl bg-white/70 dark:bg-[#0B1020]/70 border border-slate-200 dark:border-white/10 animate-pulse"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-80 rounded-2xl bg-white/70 dark:bg-[#0B1020]/70 border border-slate-200 dark:border-white/10 animate-pulse" />
          <div className="h-80 rounded-2xl bg-white/70 dark:bg-[#0B1020]/70 border border-slate-200 dark:border-white/10 animate-pulse" />
        </div>
      </div>
    );
  }

  const totalDevices =
    analytics.deviceCounts.mobile + analytics.deviceCounts.tablet + analytics.deviceCounts.desktop;

  const deviceStats = [
    {
      key: 'mobile',
      label: 'الهاتف المحمول',
      count: analytics.deviceCounts.mobile,
      icon: Smartphone,
    },
    {
      key: 'desktop',
      label: 'الحاسوب',
      count: analytics.deviceCounts.desktop,
      icon: Monitor,
    },
    {
      key: 'tablet',
      label: 'الآيباد / اللوحي',
      count: analytics.deviceCounts.tablet,
      icon: Tablet,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Range Selector Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            تحليلات الزيارات ونمو المستخدمين
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            قراءة مباشرة ومحدثة تلقائيًا من سجلات الزيارات وحسابات المستخدمين في قاعدة البيانات.
          </p>
        </div>

        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 self-start sm:self-auto">
          {([7, 14, 30] as DateRangeDays[]).map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => setRangeDays(days)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                rangeDays === days
                  ? 'accent-active-tab text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              آخر {days} يومًا
            </button>
          ))}
        </div>
      </div>

      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 backdrop-blur-md">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
            <span>الزيارات ({rangeDays} يومًا)</span>
            <Eye className="w-4 h-4 text-blue-500 shrink-0" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white mt-2 tabular-nums font-mono">
            {analytics.visitsInRange}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            اليوم: {analytics.todayVisits} · الإجمالي: {analytics.totalAllTimeVisits}
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 backdrop-blur-md">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
            <span>الزوار الفريدون</span>
            <Users className="w-4 h-4 text-violet-500 shrink-0" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white mt-2 tabular-nums font-mono">
            {analytics.uniqueVisitorsInRange}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            النشطون اليوم: {analytics.todayUniqueVisitors}
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 backdrop-blur-md">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
            <span>إجمالي المستخدمين</span>
            <UserPlus className="w-4 h-4 text-indigo-500 shrink-0" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white mt-2 tabular-nums font-mono">
            {analytics.totalUsers}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            حسابات موثّقة مسجلة في Nova AI
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 backdrop-blur-md">
          <div className="flex items-center justify-between text-xs font-semibold text-emerald-600 dark:text-emerald-300">
            <span>المستخدمون الجدد</span>
            <TrendingUp className="w-4 h-4 shrink-0" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white mt-2 tabular-nums font-mono">
            +{analytics.newUsersInRange}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            نسبة النمو بالفترة: {analytics.growthPercent}%
          </div>
        </div>
      </div>

      {/* Recharts 2-Column Visualization Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        {/* Chart 1: Daily Visits & Unique Visitors */}
        <section className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-5 backdrop-blur-md flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                عدد الزيارات اليومية
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                مقارنة بين إجمالي الزيارات والزوار الفريدين يوميًا
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-slate-600 dark:text-slate-300">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-blue-500 inline-block" />
                <span>الزيارات</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-violet-500 inline-block" />
                <span>فريدون</span>
              </span>
            </div>
          </div>

          <div dir="ltr" className="w-full h-64 sm:h-72 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={18}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<VisitsTooltip />} cursor={{ fill: 'rgba(99,102,241,0.08)' }} />
                <Bar
                  dataKey="visits"
                  name="إجمالي الزيارات"
                  fill="#3B82F6"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="uniqueVisitors"
                  name="الزوار الفريدون"
                  fill="#8B5CF6"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Chart 2: New User Growth */}
        <section className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-5 backdrop-blur-md flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                نمو المستخدمين الجدد
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {growthMode === 'cumulative'
                  ? 'المنحنى التراكمي لتزايد قاعدة المستخدمين'
                  : 'عدد الحسابات الجديدة المسجلة في كل يوم'}
              </p>
            </div>

            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#060916] border border-slate-200 dark:border-white/10">
              <button
                type="button"
                onClick={() => setGrowthMode('cumulative')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                  growthMode === 'cumulative'
                    ? 'accent-active-tab text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                النمو التراكمي
              </button>
              <button
                type="button"
                onClick={() => setGrowthMode('daily')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                  growthMode === 'daily'
                    ? 'accent-active-tab text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                الجدد يوميًا
              </button>
            </div>
          </div>

          <div dir="ltr" className="w-full h-64 sm:h-72 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analytics.series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="novaUserGrowthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={0.42} />
                    <stop offset="100%" stopColor="#10B981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={18}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<UsersGrowthTooltip />} />
                <Area
                  type="monotone"
                  dataKey={growthMode === 'cumulative' ? 'cumulativeUsers' : 'newUsers'}
                  name={growthMode === 'cumulative' ? 'إجمالي المستخدمين' : 'المستخدمون الجدد'}
                  stroke="#10B981"
                  strokeWidth={2.5}
                  fill="url(#novaUserGrowthGrad)"
                  activeDot={{ r: 5, fill: '#10B981', stroke: '#ffffff', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Device Breakdown Strip */}
      <section className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-5 backdrop-blur-md">
        <div className="flex items-center justify-between gap-2 mb-3.5">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            توزيع الزيارات حسب نوع الجهاز
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            إجمالي الفترة: {totalDevices} زيارة
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          {deviceStats.map((item) => {
            const Icon = item.icon;
            const pct = totalDevices > 0 ? Math.round((item.count / totalDevices) * 100) : 0;
            return (
              <div
                key={item.key}
                className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 space-y-2"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
                    <Icon className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-primary)' }} />
                    <span>{item.label}</span>
                  </span>
                  <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                    {item.count} ({pct}%)
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${pct}%`,
                      background: 'linear-gradient(90deg, var(--accent-primary), var(--accent-secondary))',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
