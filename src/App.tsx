import { useState, useEffect, FormEvent } from 'react';
import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import {
  Settings,
  Lock,
  Menu,
  X,
  ShieldAlert,
  MessageSquare,
  Info,
  BookOpen,
  HelpCircle,
  Mail,
} from 'lucide-react';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from './firebase';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StarfieldCanvas } from './components/StarfieldCanvas';
import { NovaStarLogo } from './components/NovaStarLogo';
import { LoginGate } from './components/LoginGate';
import { ChatWorkspace } from './components/ChatWorkspace';
import { AboutPage } from './components/AboutPage';
import { HelpPage } from './components/HelpPage';
import { FaqPage } from './components/FaqPage';
import { ContactPage } from './components/ContactPage';
import { OwnerDashboardPage, isOwnerAdmin } from './components/OwnerDashboardPage';
import { SettingsPage } from './components/SettingsPage';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import {
  AccentColor,
  ThemeMode,
  applyThemePreferences,
  getSavedAccent,
  getSavedTheme,
} from './lib/theme';

type PrimaryTab = 'chat' | 'about' | 'help' | 'faq' | 'contact' | 'owner';
type StudioTab = PrimaryTab | 'settings';

const PUBLIC_NAV_TABS: Array<{ id: PrimaryTab; label: string; icon: typeof MessageSquare }> = [
  { id: 'chat', label: 'المحادثة الذكية', icon: MessageSquare },
  { id: 'about', label: 'من نحن', icon: Info },
  { id: 'help', label: 'مساعدة', icon: BookOpen },
  { id: 'faq', label: 'أسئلة شائعة', icon: HelpCircle },
  { id: 'contact', label: 'تواصل معنا', icon: Mail },
];

const PIN_STORAGE_KEY = 'nova_ai_session_pin';

function NovaApplication() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<StudioTab>('chat');
  const [previousTab, setPreviousTab] = useState<PrimaryTab>('chat');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState<string | null>(null);
  const [customInstruction, setCustomInstruction] = useState('');
  const [urgentUnreadCount, setUrgentUnreadCount] = useState(0);

  const isOwner = isOwnerAdmin(user);

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getSavedTheme());
  const [accentColor, setAccentColor] = useState<AccentColor>(() => getSavedAccent());

  const [savedPin, setSavedPin] = useState<string | null>(() => {
    try {
      return localStorage.getItem(PIN_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [isScreenLocked, setIsScreenLocked] = useState<boolean>(() => {
    try {
      return Boolean(localStorage.getItem(PIN_STORAGE_KEY));
    } catch {
      return false;
    }
  });
  const [pinAttempt, setPinAttempt] = useState('');
  const [pinError, setPinError] = useState(false);

  // Apply theme & accent color immediately on mount and whenever changed
  useEffect(() => {
    applyThemePreferences(themeMode, accentColor);
  }, [themeMode, accentColor]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userPath = `users/${firebaseUser.uid}`;
        try {
          const snap = await getDoc(doc(db, userPath));
          if (!snap.exists()) {
            await setDoc(doc(db, userPath), {
              uid: firebaseUser.uid,
              displayName: (firebaseUser.displayName || 'Nova User').slice(0, 120),
              email: (firebaseUser.email || 'user@nova.ai').slice(0, 200),
              customInstruction: '',
              accentColor,
              themeMode,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            setCustomInstruction('');
          } else {
            const data = snap.data();
            setCustomInstruction(String(data.customInstruction || ''));
            if (
              data.accentColor === 'violet' ||
              data.accentColor === 'blue' ||
              data.accentColor === 'emerald' ||
              data.accentColor === 'rose'
            ) {
              setAccentColor(data.accentColor);
            }
            if (data.themeMode === 'dark' || data.themeMode === 'light') {
              setThemeMode(data.themeMode);
            }
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, userPath);
        }

        // Record verified session visit once per browser session per day for owner analytics
        if (firebaseUser.emailVerified) {
          const now = new Date();
          const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
            now.getDate()
          ).padStart(2, '0')}`;
          const visitFlagKey = `nova_visit_${firebaseUser.uid}_${dateKey}`;
          try {
            if (!sessionStorage.getItem(visitFlagKey)) {
              const width = window.innerWidth;
              const deviceType: 'mobile' | 'tablet' | 'desktop' =
                width < 640 ? 'mobile' : width < 1024 ? 'tablet' : 'desktop';
              await setDoc(doc(db, 'visitLogs', crypto.randomUUID()), {
                userId: firebaseUser.uid,
                dateKey,
                deviceType,
                createdAt: serverTimestamp(),
              });
              sessionStorage.setItem(visitFlagKey, '1');
            }
          } catch {
            // Non-blocking analytics log
          }
        }
      }
      setUser(firebaseUser);
      setAuthReady(true);
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track active urgent messages badge strictly for the verified site owner
  useEffect(() => {
    if (!isOwner) {
      setUrgentUnreadCount(0);
      if (activeTab === 'owner') {
        setActiveTab('chat');
      }
      return;
    }

    const q = query(
      collection(db, 'contactMessages'),
      where('triageLevel', '==', 'urgent'),
      where('status', '==', 'new')
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setUrgentUnreadCount(snap.size);
      },
      () => {
        setUrgentUnreadCount(0);
      }
    );

    return () => unsubscribe();
  }, [isOwner, activeTab]);

  const handleSignIn = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      googleProvider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('popup-closed-by-user')) {
        setAuthError('تم إغلاق نافذة تسجيل الدخول قبل إتمام التحقق.');
      } else if (message.includes('popup-blocked')) {
        setAuthError('حظر المتصفح نافذة تسجيل الدخول. يرجى السماح بالنوافذ المنبثقة ثم المحاولة مجددًا.');
      } else {
        setAuthError('تعذر إتمام تسجيل الدخول حاليًا. يرجى المحاولة مجددًا.');
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSwitchAccount = async () => {
    googleProvider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, googleProvider);
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setActiveTab('chat');
  };

  const persistUserField = async (patch: {
    customInstruction?: string;
    accentColor?: AccentColor;
    themeMode?: ThemeMode;
  }) => {
    if (!user) return;
    const userPath = `users/${user.uid}`;
    try {
      await updateDoc(doc(db, userPath), {
        displayName: (user.displayName || 'Nova User').slice(0, 120),
        email: (user.email || 'user@nova.ai').slice(0, 200),
        ...patch,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, userPath);
    }
  };

  const handleChangeTheme = (mode: ThemeMode) => {
    setThemeMode(mode);
    applyThemePreferences(mode, accentColor);
    persistUserField({ themeMode: mode }).catch(() => undefined);
  };

  const handleChangeAccent = (color: AccentColor) => {
    setAccentColor(color);
    applyThemePreferences(themeMode, color);
    persistUserField({ accentColor: color }).catch(() => undefined);
  };

  const handleSaveInstruction = async (instruction: string) => {
    await persistUserField({ customInstruction: instruction.slice(0, 1000) });
    setCustomInstruction(instruction);
  };

  const handleUpdatePin = (pin: string | null) => {
    try {
      if (pin) {
        localStorage.setItem(PIN_STORAGE_KEY, pin);
        setSavedPin(pin);
      } else {
        localStorage.removeItem(PIN_STORAGE_KEY);
        setSavedPin(null);
        setIsScreenLocked(false);
      }
    } catch {
      // Storage unavailable
    }
  };

  const handleUnlockPin = (e: FormEvent) => {
    e.preventDefault();
    if (pinAttempt === savedPin) {
      setIsScreenLocked(false);
      setPinAttempt('');
      setPinError(false);
    } else {
      setPinError(true);
    }
  };

  const navigateTo = (tab: PrimaryTab) => {
    if (tab === 'owner' && !isOwner) return;
    setPreviousTab(tab);
    setActiveTab(tab);
    setMobileNavOpen(false);
  };

  const openSettings = () => {
    setMobileNavOpen(false);
    if (activeTab !== 'settings') {
      setPreviousTab(activeTab);
      setActiveTab('settings');
    } else {
      setActiveTab(previousTab);
    }
  };

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileNavOpen]);

  return (
    <div className="min-h-[100dvh] bg-slate-50 dark:bg-[#050711] text-slate-900 dark:text-slate-100 relative flex flex-col transition-colors duration-200 overflow-x-hidden">
      <StarfieldCanvas themeMode={themeMode} />

      {!authReady ? (
        <div className="relative z-10 min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-4">
          <NovaStarLogo size="lg" />
          <div className="text-sm text-slate-600 dark:text-slate-300">جاري تجهيز بوابة Nova AI...</div>
        </div>
      ) : !user ? (
        <LoginGate onSignIn={handleSignIn} isLoading={authLoading} error={authError} />
      ) : isScreenLocked && savedPin ? (
        <div className="relative z-20 min-h-[100dvh] flex items-center justify-center p-4 sm:p-6">
          <form
            onSubmit={handleUnlockPin}
            className="w-full max-w-sm rounded-2xl bg-white/95 dark:bg-[#0B1020]/95 border border-slate-200 dark:border-white/15 p-7 text-center shadow-2xl space-y-5 backdrop-blur-md"
          >
            <div className="flex justify-center">
              <NovaStarLogo size="md" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">الجلسة مقفلة مؤقتًا</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">أدخل رمز القفل السريع للمتابعة إلى Nova AI</p>
            </div>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pinAttempt}
              onChange={(e) => {
                setPinAttempt(e.target.value);
                setPinError(false);
              }}
              placeholder="••••"
              className="accent-focus w-full text-center tracking-[0.4em] rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15 focus:outline-none px-4 py-3 text-lg text-slate-900 dark:text-white"
            />
            {pinError && <div className="text-xs text-rose-500">رمز القفل غير صحيح</div>}
            <button
              type="submit"
              className="accent-btn w-full py-3 rounded-xl text-white text-sm font-semibold cursor-pointer"
            >
              فتح الواجهة
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              تسجيل الخروج من الحساب
            </button>
          </form>
        </div>
      ) : (
        <div className="relative z-10 h-[100dvh] flex flex-col overflow-hidden">
          {/* Clean 3-Zone Top Header */}
          <header className="shrink-0 border-b border-slate-200 dark:border-white/10 bg-white/80 dark:bg-[#070B17]/85 backdrop-blur-md">
            <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-3 sm:gap-4">
              {/* Zone 1: Mobile/Tablet Side Drawer Toggle + Glowing Star Logo + Nova AI wordmark */}
              <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(true)}
                  aria-label="فتح قائمة التنقل الجانبية"
                  aria-expanded={mobileNavOpen}
                  className="lg:hidden min-w-[40px] min-h-[40px] p-2 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer flex items-center justify-center relative"
                >
                  <Menu className="w-5 h-5" />
                  {isOwner && urgentUnreadCount > 0 && (
                    <span className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-rose-600 ring-2 ring-white dark:ring-[#070B17]" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => navigateTo('chat')}
                  className="flex items-center gap-2 sm:gap-2.5 shrink-0 cursor-pointer"
                >
                  <NovaStarLogo size="sm" />
                  <span
                    dir="ltr"
                    className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
                  >
                    Nova AI
                  </span>
                </button>
              </div>

              {/* Zone 2: Single-Row Desktop Navigation Links (1024px+) */}
              <nav aria-label="أقسام التطبيق" className="hidden lg:flex items-center gap-1.5">
                {PUBLIC_NAV_TABS.map((tab) => {
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => navigateTo(tab.id)}
                      className={`px-3.5 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer border ${
                        active
                          ? 'accent-active-tab text-slate-900 dark:text-white'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border-transparent'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => navigateTo('owner')}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer border ${
                      activeTab === 'owner'
                        ? 'accent-active-tab text-slate-900 dark:text-white'
                        : urgentUnreadCount > 0
                          ? 'bg-rose-500/10 border-rose-500/35 text-rose-700 dark:text-rose-200 hover:bg-rose-500/20'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border-transparent'
                    }`}
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>لوحة المالك</span>
                    {urgentUnreadCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded-md bg-rose-600 text-white text-[10px] font-bold tabular-nums">
                        {urgentUnreadCount}
                      </span>
                    )}
                  </button>
                )}
              </nav>

              {/* Zone 3: Install App Button + Optional Quick Lock + Settings Gear Icon */}
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                <PWAInstallButton variant="header" />
                {savedPin && (
                  <button
                    type="button"
                    onClick={() => setIsScreenLocked(true)}
                    aria-label="قفل الجلسة"
                    title="قفل الجلسة"
                    className="min-w-[40px] min-h-[40px] p-2 sm:p-2.5 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 transition-colors shrink-0 cursor-pointer flex items-center justify-center"
                  >
                    <Lock className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={openSettings}
                  aria-label="الإعدادات"
                  title="الإعدادات"
                  className={`inline-flex items-center justify-center gap-2 min-w-[40px] min-h-[40px] px-2.5 sm:px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer border ${
                    activeTab === 'settings'
                      ? 'accent-active-tab text-slate-900 dark:text-white'
                      : 'bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border-transparent text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <Settings className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                  <span className="hidden sm:inline">الإعدادات</span>
                </button>
              </div>
            </div>
          </header>

          {/* Sliding RTL Side Navigation Drawer for Mobile & iPad Portrait */}
          <AnimatePresence>
            {mobileNavOpen && (
              <div className="fixed inset-0 z-50 lg:hidden flex">
                <motion.aside
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  aria-label="قائمة التنقل الجانبية"
                  className="relative z-10 w-72 max-w-[84vw] h-full bg-white/95 dark:bg-[#070B18]/95 border-l border-slate-200 dark:border-white/15 backdrop-blur-xl flex flex-col shadow-2xl"
                >
                  {/* Drawer Header */}
                  <div className="flex items-center justify-between px-4 py-4 border-b border-slate-200 dark:border-white/10">
                    <div className="flex items-center gap-2.5">
                      <NovaStarLogo size="sm" />
                      <span dir="ltr" className="text-base font-bold text-slate-900 dark:text-white">
                        Nova AI
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMobileNavOpen(false)}
                      aria-label="إغلاق القائمة"
                      className="min-w-[40px] min-h-[40px] p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 flex items-center justify-center cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Drawer Navigation Links */}
                  <nav className="flex-1 overflow-y-auto p-3 space-y-1.5">
                    {PUBLIC_NAV_TABS.map((tab) => {
                      const Icon = tab.icon;
                      const active = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => navigateTo(tab.id)}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-medium text-right transition-all cursor-pointer border min-h-[44px] ${
                            active
                              ? 'accent-active-tab text-slate-900 dark:text-white'
                              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 border-transparent'
                          }`}
                        >
                          <Icon
                            className="w-4 h-4 shrink-0"
                            style={active ? { color: 'var(--accent-primary)' } : undefined}
                          />
                          <span>{tab.label}</span>
                        </button>
                      );
                    })}

                    {isOwner && (
                      <button
                        type="button"
                        onClick={() => navigateTo('owner')}
                        className={`w-full flex items-center justify-between gap-2 px-3.5 py-3 rounded-xl text-sm font-semibold text-right transition-all cursor-pointer border min-h-[44px] mt-2 ${
                          activeTab === 'owner'
                            ? 'accent-active-tab text-slate-900 dark:text-white'
                            : 'bg-rose-500/10 border-rose-500/35 text-rose-700 dark:text-rose-200'
                        }`}
                      >
                        <span className="inline-flex items-center gap-3">
                          <ShieldAlert className="w-4 h-4 shrink-0" />
                          <span>لوحة المالك الخاصة</span>
                        </span>
                        {urgentUnreadCount > 0 && (
                          <span className="px-2 py-0.5 rounded-md bg-rose-600 text-white text-[11px] font-bold tabular-nums">
                            {urgentUnreadCount} عاجلة
                          </span>
                        )}
                      </button>
                    )}

                    <div className="pt-2 mt-2 border-t border-slate-200 dark:border-white/10 space-y-1.5">
                      <button
                        type="button"
                        onClick={openSettings}
                        className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-medium text-right transition-all cursor-pointer border min-h-[44px] ${
                          activeTab === 'settings'
                            ? 'accent-active-tab text-slate-900 dark:text-white'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 border-transparent'
                        }`}
                      >
                        <Settings className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-primary)' }} />
                        <span>الإعدادات والمظهر</span>
                      </button>
                      <PWAInstallButton variant="drawer" />
                    </div>
                  </nav>

                  {/* Drawer Footer User Info */}
                  <div className="p-4 border-t border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-[#050814]/80">
                    <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {user.displayName || 'Nova User'}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate mt-0.5" dir="ltr">
                      {user.email}
                    </div>
                  </div>
                </motion.aside>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  onClick={() => setMobileNavOpen(false)}
                  className="flex-1 bg-black/60 backdrop-blur-xs"
                />
              </div>
            )}
          </AnimatePresence>

          {/* Main Workspace Content */}
          <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="flex-1 min-h-0 flex flex-col"
              >
                {activeTab === 'chat' && (
                  <ChatWorkspace
                    user={user}
                    customInstruction={customInstruction}
                    draftPrompt={draftPrompt}
                    onConsumeDraftPrompt={() => setDraftPrompt(null)}
                  />
                )}
                {activeTab === 'about' && (
                  <AboutPage
                    onGoToChat={() => navigateTo('chat')}
                    onGoToContact={() => navigateTo('contact')}
                  />
                )}
                {activeTab === 'help' && (
                  <HelpPage
                    onUsePrompt={(prompt) => {
                      setDraftPrompt(prompt);
                      navigateTo('chat');
                    }}
                    onGoToSettings={openSettings}
                    onGoToContact={() => navigateTo('contact')}
                  />
                )}
                {activeTab === 'faq' && (
                  <FaqPage
                    onGoToContact={() => navigateTo('contact')}
                    onGoToChat={() => navigateTo('chat')}
                  />
                )}
                {activeTab === 'contact' && (
                  <ContactPage
                    user={user}
                    onGoToChat={() => navigateTo('chat')}
                    onGoToOwnerDashboard={isOwner ? () => navigateTo('owner') : undefined}
                  />
                )}
                {activeTab === 'owner' && (
                  <OwnerDashboardPage user={user} onBackToChat={() => navigateTo('chat')} />
                )}
                {activeTab === 'settings' && (
                  <SettingsPage
                    userEmail={user.email || ''}
                    displayName={user.displayName || 'Nova User'}
                    themeMode={themeMode}
                    accentColor={accentColor}
                    customInstruction={customInstruction}
                    hasPin={Boolean(savedPin)}
                    onChangeTheme={handleChangeTheme}
                    onChangeAccent={handleChangeAccent}
                    onSaveInstruction={handleSaveInstruction}
                    onUpdatePin={handleUpdatePin}
                    onSwitchAccount={handleSwitchAccount}
                    onSignOut={handleSignOut}
                    onBack={() => setActiveTab(previousTab)}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      )}
      <OfflineIndicator />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <NovaApplication />
    </ErrorBoundary>
  );
}
