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
  Presentation,
  Info,
  BookOpen,
  HelpCircle,
  Mail,
  ClipboardCheck,
  ShieldCheck,
  GraduationCap,
  History,
} from 'lucide-react';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from './firebase';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StarfieldCanvas } from './components/StarfieldCanvas';
import { NovaStarLogo } from './components/NovaStarLogo';
import { LoginGate } from './components/LoginGate';
import { OtpGate } from './components/OtpGate';
import { ChatWorkspace } from './components/ChatWorkspace';
import { PresentationStudio } from './components/PresentationStudio';
import { ExamStudio } from './components/ExamStudio';
import { StudyStudio } from './components/StudyStudio';
import { UsageHistoryPage } from './components/UsageHistoryPage';
import { SharedSnippetPage } from './components/SharedSnippetPage';
import { AboutPage } from './components/AboutPage';
import { HelpPage } from './components/HelpPage';
import { FaqPage } from './components/FaqPage';
import { ContactPage } from './components/ContactPage';
import { PrivacyPolicyPage } from './components/PrivacyPolicyPage';
import { OwnerDashboardPage, isOwnerAdmin } from './components/OwnerDashboardPage';
import { SettingsPage } from './components/SettingsPage';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import {
  AccentColor,
  BackgroundStyle,
  FontColor,
  ThemeMode,
  applyThemePreferences,
  getSavedAccent,
  getSavedBackgroundStyle,
  getSavedFontColor,
  getSavedTheme,
  isValidAccentColor,
  isValidBackgroundStyle,
  isValidFontColor,
} from './lib/theme';

import {
  clearFailedPinAttempts,
  getPinLockoutRemainingMs,
  getStoredPinHash,
  hashPin,
  recordFailedPinAttempt,
  saveStoredPinHash,
  verifyStoredPin,
} from './lib/pinSecurity';
import { getOtpHeaders, setOtpSessionToken } from './lib/otpSession';
import { sanitizeUserText } from './lib/sanitize';

type PrimaryTab =
  | 'chat'
  | 'study'
  | 'pptx'
  | 'exam'
  | 'history'
  | 'about'
  | 'help'
  | 'faq'
  | 'contact'
  | 'privacy'
  | 'owner';
type StudioTab = PrimaryTab | 'settings';

const PUBLIC_NAV_TABS: Array<{ id: PrimaryTab; label: string; icon: typeof MessageSquare }> = [
  { id: 'chat', label: 'المحادثة الذكية', icon: MessageSquare },
  { id: 'study', label: 'أدوات المذاكرة', icon: GraduationCap },
  { id: 'pptx', label: 'العروض', icon: Presentation },
  { id: 'exam', label: 'الاختبارات', icon: ClipboardCheck },
  { id: 'history', label: 'سجلي', icon: History },
  { id: 'about', label: 'من نحن', icon: Info },
  { id: 'contact', label: 'تواصل معنا', icon: Mail },
];

function isInitialPrivacyUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const pageParam = new URLSearchParams(window.location.search).get('page');
  return pageParam === 'privacy' || window.location.pathname === '/privacy';
}

function getInitialShareId(): string | null {
  if (typeof window === 'undefined') return null;
  const shareParam = new URLSearchParams(window.location.search).get('share');
  return shareParam && shareParam.trim().length > 0 ? shareParam.trim() : null;
}

function NovaApplication() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [otpStatus, setOtpStatus] = useState<'idle' | 'required' | 'verified'>('idle');
  const [otpEmailMasked, setOtpEmailMasked] = useState('');
  const [otpCooldownSec, setOtpCooldownSec] = useState(0);

  const [activeShareId, setActiveShareId] = useState<string | null>(() => getInitialShareId());
  const [showGuestPrivacy, setShowGuestPrivacy] = useState<boolean>(() => isInitialPrivacyUrl());
  const [activeTab, setActiveTab] = useState<StudioTab>(() => (isInitialPrivacyUrl() ? 'privacy' : 'chat'));
  const [previousTab, setPreviousTab] = useState<PrimaryTab>('chat');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState<string | null>(null);
  const [pptxTopicDraft, setPptxTopicDraft] = useState<string | null>(null);
  const [customDisplayName, setCustomDisplayName] = useState('');
  const [customInstruction, setCustomInstruction] = useState('');
  const [customAvatarUrl, setCustomAvatarUrl] = useState<string>('');
  const [urgentUnreadCount, setUrgentUnreadCount] = useState(0);

  const isOwner = isOwnerAdmin(user);

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getSavedTheme());
  const [accentColor, setAccentColor] = useState<AccentColor>(() => getSavedAccent());
  const [backgroundStyle, setBackgroundStyle] = useState<BackgroundStyle>(() => getSavedBackgroundStyle());
  const [fontColor, setFontColor] = useState<FontColor>(() => getSavedFontColor());

  const [savedPinHash, setSavedPinHash] = useState<string | null>(() => getStoredPinHash());
  const [isScreenLocked, setIsScreenLocked] = useState<boolean>(() => Boolean(getStoredPinHash()));
  const [pinAttempt, setPinAttempt] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLockoutSeconds, setPinLockoutSeconds] = useState<number>(() =>
    Math.ceil(getPinLockoutRemainingMs() / 1000)
  );

  // Apply theme, accent, background style & font color immediately on mount and whenever changed
  useEffect(() => {
    applyThemePreferences(themeMode, accentColor, backgroundStyle, fontColor);
  }, [themeMode, accentColor, backgroundStyle, fontColor]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userPath = `users/${firebaseUser.uid}`;
        try {
          const snap = await getDoc(doc(db, userPath));
          if (!snap.exists()) {
            const initialDisplayName = (firebaseUser.displayName || 'Nova User').slice(0, 120);
            await setDoc(doc(db, userPath), {
              uid: firebaseUser.uid,
              displayName: initialDisplayName,
              email: (firebaseUser.email || 'user@nova.ai').slice(0, 200),
              customInstruction: '',
              accentColor,
              themeMode,
              backgroundStyle,
              fontColor,
              avatarDataUrl: '',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            setCustomDisplayName(initialDisplayName);
            setCustomInstruction('');
            setCustomAvatarUrl('');
          } else {
            const data = snap.data();
            const storedName =
              typeof data.displayName === 'string' && data.displayName.trim()
                ? data.displayName.trim().slice(0, 120)
                : (firebaseUser.displayName || 'Nova User').slice(0, 120);
            setCustomDisplayName(storedName);
            setCustomInstruction(String(data.customInstruction || ''));
            setCustomAvatarUrl(String(data.avatarDataUrl || ''));
            if (isValidAccentColor(data.accentColor)) {
              setAccentColor(data.accentColor);
            }
            if (data.themeMode === 'dark' || data.themeMode === 'light') {
              setThemeMode(data.themeMode);
            }
            if (isValidBackgroundStyle(data.backgroundStyle)) {
              setBackgroundStyle(data.backgroundStyle);
            }
            if (isValidFontColor(data.fontColor)) {
              setFontColor(data.fontColor);
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

        try {
          let otpData: {
            otpRequired?: boolean;
            otpToken?: string;
            emailMasked?: string;
            cooldownRemainingSec?: number;
          } | null = null;
          let resolvedOk = false;

          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              let idToken = await firebaseUser.getIdToken(attempt > 0);
              let otpRes = await fetch('/api/auth/otp/status', {
                credentials: 'same-origin',
                headers: {
                  Authorization: `Bearer ${idToken}`,
                  ...getOtpHeaders(),
                },
              });
              if (otpRes.status === 401) {
                idToken = await firebaseUser.getIdToken(true);
                otpRes = await fetch('/api/auth/otp/status', {
                  credentials: 'same-origin',
                  headers: {
                    Authorization: `Bearer ${idToken}`,
                    ...getOtpHeaders(),
                  },
                });
              }
              if (otpRes.ok) {
                otpData = await otpRes.json();
                resolvedOk = true;
                break;
              }
              if (otpRes.status >= 500 && attempt < 2) {
                await new Promise((r) => setTimeout(r, (attempt + 1) * 650));
                continue;
              }
              break;
            } catch (fetchErr) {
              if (attempt < 2 && (typeof navigator === 'undefined' || navigator.onLine)) {
                await new Promise((r) => setTimeout(r, (attempt + 1) * 650));
                continue;
              }
              throw fetchErr;
            }
          }

          if (resolvedOk && otpData) {
            if (otpData.otpToken) {
              setOtpSessionToken(otpData.otpToken);
            }
            setOtpEmailMasked(otpData.emailMasked || firebaseUser.email || '');
            setOtpCooldownSec(
              typeof otpData.cooldownRemainingSec === 'number' ? otpData.cooldownRemainingSec : 0
            );
            setOtpStatus(otpData.otpRequired ? 'required' : 'verified');
          } else {
            // Never fail open if the server indicates OTP is configured
            const healthRes = await fetch('/api/health').catch(() => null);
            const healthData = healthRes?.ok
              ? ((await healthRes.json().catch(() => ({}))) as { otpConfigured?: boolean })
              : { otpConfigured: true };
            setOtpEmailMasked(firebaseUser.email || '');
            setOtpStatus(healthData.otpConfigured ? 'required' : 'verified');
          }
        } catch {
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setOtpStatus('verified');
          } else {
            setOtpEmailMasked(firebaseUser.email || '');
            setOtpStatus('required');
          }
        }
      } else {
        setOtpSessionToken(null);
        setOtpStatus('idle');
        setOtpEmailMasked('');
        setOtpCooldownSec(0);
        setCustomDisplayName('');
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

  const clearServerOtpSession = async () => {
    try {
      const current = auth.currentUser;
      if (current) {
        let idToken = await current.getIdToken();
        const logoutHeaders = getOtpHeaders();
        let res = await fetch('/api/auth/otp/logout', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
            'X-Requested-With': 'NovaAI',
            ...logoutHeaders,
          },
          body: JSON.stringify({}),
        });
        if (res.status === 401) {
          idToken = await current.getIdToken(true);
          await fetch('/api/auth/otp/logout', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
              'X-Requested-With': 'NovaAI',
              ...logoutHeaders,
            },
            body: JSON.stringify({}),
          });
        }
      }
    } catch {
      // Non-blocking logout cleanup
    }
  };

  const handleSwitchAccount = async () => {
    await clearServerOtpSession();
    setOtpSessionToken(null);
    setOtpStatus('idle');
    googleProvider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, googleProvider);
  };

  const handleSignOut = async () => {
    await clearServerOtpSession();
    setOtpSessionToken(null);
    setOtpStatus('idle');
    setOtpEmailMasked('');
    setOtpCooldownSec(0);
    await signOut(auth);
    setActiveTab('chat');
  };

  const persistUserField = async (patch: {
    displayName?: string;
    customInstruction?: string;
    accentColor?: AccentColor;
    themeMode?: ThemeMode;
    backgroundStyle?: BackgroundStyle;
    fontColor?: FontColor;
    avatarDataUrl?: string;
  }) => {
    if (!user) return;
    const userPath = `users/${user.uid}`;
    try {
      await updateDoc(doc(db, userPath), {
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
    applyThemePreferences(mode, accentColor, backgroundStyle, fontColor);
    persistUserField({ themeMode: mode }).catch(() => undefined);
  };

  const handleChangeAccent = (color: AccentColor) => {
    setAccentColor(color);
    applyThemePreferences(themeMode, color, backgroundStyle, fontColor);
    persistUserField({ accentColor: color }).catch(() => undefined);
  };

  const handleChangeBackground = (bg: BackgroundStyle) => {
    setBackgroundStyle(bg);
    applyThemePreferences(themeMode, accentColor, bg, fontColor);
    persistUserField({ backgroundStyle: bg }).catch(() => undefined);
  };

  const handleChangeFontColor = (fc: FontColor) => {
    setFontColor(fc);
    applyThemePreferences(themeMode, accentColor, backgroundStyle, fc);
    persistUserField({ fontColor: fc }).catch(() => undefined);
  };

  const handleUpdateAvatar = async (avatarDataUrl: string) => {
    await persistUserField({ avatarDataUrl });
    setCustomAvatarUrl(avatarDataUrl);
  };

  const handleSaveDisplayName = async (nextName: string) => {
    const clean = sanitizeUserText(nextName, 120, false);
    if (!clean) {
      throw new Error('يرجى كتابة اسم عرض صالح (حرف واحد على الأقل).');
    }
    await persistUserField({ displayName: clean });
    setCustomDisplayName(clean);
  };

  const handleSaveInstruction = async (instruction: string) => {
    const clean = sanitizeUserText(instruction, 1000);
    await persistUserField({ customInstruction: clean });
    setCustomInstruction(clean);
  };

  useEffect(() => {
    if (pinLockoutSeconds <= 0) return;
    const timer = setInterval(() => {
      const rem = Math.ceil(getPinLockoutRemainingMs() / 1000);
      setPinLockoutSeconds(rem);
    }, 1000);
    return () => clearInterval(timer);
  }, [pinLockoutSeconds]);

  const handleUpdatePin = (pin: string | null) => {
    if (!pin) {
      saveStoredPinHash(null);
      setSavedPinHash(null);
      setIsScreenLocked(false);
      setPinError(null);
      setPinLockoutSeconds(0);
      return;
    }
    hashPin(pin)
      .then((digest) => {
        saveStoredPinHash(digest);
        clearFailedPinAttempts();
        setSavedPinHash(digest);
        setPinLockoutSeconds(0);
      })
      .catch(() => undefined);
  };

  const handleUnlockPin = async (e: FormEvent) => {
    e.preventDefault();
    const remainingMs = getPinLockoutRemainingMs();
    if (remainingMs > 0) {
      const secs = Math.ceil(remainingMs / 1000);
      setPinLockoutSeconds(secs);
      setPinError(`تم تقييد المحاولات مؤقتًا للحماية. انتظر ${secs} ثانية.`);
      return;
    }
    if (!savedPinHash) {
      setIsScreenLocked(false);
      return;
    }

    const result = await verifyStoredPin(pinAttempt, savedPinHash);
    if (result.valid) {
      clearFailedPinAttempts();
      if (result.upgradedHash) {
        saveStoredPinHash(result.upgradedHash);
        setSavedPinHash(result.upgradedHash);
      }
      setIsScreenLocked(false);
      setPinAttempt('');
      setPinError(null);
      setPinLockoutSeconds(0);
    } else {
      const lockMs = recordFailedPinAttempt();
      if (lockMs > 0) {
        const secs = Math.ceil(lockMs / 1000);
        setPinLockoutSeconds(secs);
        setPinError(`محاولات خاطئة متكررة. تم قفل الإدخال مؤقتًا لمدة ${secs} ثانية.`);
      } else {
        setPinError('رمز القفل غير صحيح');
      }
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

  const resolvedAvatarUrl = customAvatarUrl || user?.photoURL || null;
  const resolvedDisplayName = (customDisplayName || user?.displayName || 'Nova User').trim();

  const openGuestPrivacy = () => {
    setShowGuestPrivacy(true);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/?page=privacy');
    }
  };

  const closeGuestPrivacy = () => {
    setShowGuestPrivacy(false);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/');
    }
  };

  const closeSharedSnippet = () => {
    setActiveShareId(null);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/');
    }
  };

  return (
    <div
      className="min-h-[100dvh] relative flex flex-col transition-colors duration-200 overflow-x-hidden"
      style={{ backgroundColor: 'var(--app-bg-color)', color: 'var(--app-text-color)' }}
    >
      <StarfieldCanvas themeMode={themeMode} backgroundStyle={backgroundStyle} />

      {activeShareId ? (
        <SharedSnippetPage shareId={activeShareId} onGoHome={closeSharedSnippet} />
      ) : !authReady ? (
        <div className="relative z-10 min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-4">
          <NovaStarLogo size="lg" />
          <div className="text-sm text-slate-600 dark:text-slate-300">جاري تجهيز بوابة Nova AI...</div>
        </div>
      ) : !user ? (
        showGuestPrivacy ? (
          <div className="relative z-10 min-h-[100dvh] flex flex-col justify-between">
            <header className="border-b border-slate-200 dark:border-white/10 bg-white/80 dark:bg-[#070B17]/85 backdrop-blur-md">
              <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={closeGuestPrivacy}
                  className="flex items-center gap-2.5 cursor-pointer shrink-0"
                >
                  <NovaStarLogo size="sm" />
                  <span dir="ltr" className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                    Nova AI
                  </span>
                </button>
                <PWAInstallButton variant="header" />
              </div>
            </header>
            <PrivacyPolicyPage onBack={closeGuestPrivacy} backLabel="العودة لصفحة الدخول" />
            <footer className="border-t border-slate-200 dark:border-white/10 py-3 px-4 sm:px-6 text-center text-xs text-slate-500">
              Nova AI · منصة الذكاء الاصطناعي العربية · 2026
            </footer>
          </div>
        ) : (
          <LoginGate
            onSignIn={handleSignIn}
            isLoading={authLoading}
            error={authError}
            onOpenPrivacy={openGuestPrivacy}
          />
        )
      ) : otpStatus === 'required' ? (
        <OtpGate
          user={user}
          initialEmailMasked={otpEmailMasked}
          initialCooldownSec={otpCooldownSec}
          onVerified={() => setOtpStatus('verified')}
          onSignOut={handleSignOut}
        />
      ) : isScreenLocked && savedPinHash ? (
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
              disabled={pinLockoutSeconds > 0}
              value={pinAttempt}
              onChange={(e) => {
                setPinAttempt(e.target.value);
                setPinError(null);
              }}
              placeholder="••••"
              className="accent-focus w-full text-center tracking-[0.4em] rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/15 focus:outline-none px-4 py-3 text-lg text-slate-900 dark:text-white disabled:opacity-50"
            />
            {pinError && (
              <div className="text-xs text-rose-500">
                {pinLockoutSeconds > 0
                  ? `محاولات خاطئة متكررة. انتظر ${pinLockoutSeconds} ثانية قبل المحاولة مجددًا.`
                  : pinError}
              </div>
            )}
            <button
              type="submit"
              disabled={pinLockoutSeconds > 0}
              className="accent-btn w-full py-3 rounded-xl text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
            >
              {pinLockoutSeconds > 0 ? `محظور مؤقتًا (${pinLockoutSeconds}ث)` : 'فتح الواجهة'}
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
          {/* Clean 3-Zone Top Header + Mobile Top Dropdown Anchor */}
          <div className="relative z-30 shrink-0">
            <header className="border-b border-slate-200 dark:border-white/10 bg-white/85 dark:bg-[#070B17]/90 backdrop-blur-md">
              <div className="max-w-7xl mx-auto px-2.5 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4">
                {/* Zone 1: Mobile Dropdown Menu Button + Glowing Star Logo + Nova AI wordmark */}
                <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 shrink-0">
                  <button
                    type="button"
                    onClick={() => setMobileNavOpen((v) => !v)}
                    aria-label={mobileNavOpen ? 'إغلاق قائمة التنقل' : 'فتح قائمة التنقل'}
                    aria-expanded={mobileNavOpen}
                    className="lg:hidden min-w-[40px] min-h-[40px] p-2 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer flex items-center justify-center relative shrink-0"
                  >
                    {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    {isOwner && urgentUnreadCount > 0 && !mobileNavOpen && (
                      <span className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-rose-600 ring-2 ring-white dark:ring-[#070B17]" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateTo('chat')}
                    className="flex items-center gap-2 sm:gap-2.5 min-w-0 shrink-0 cursor-pointer"
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
                <nav aria-label="أقسام التطبيق" className="hidden lg:flex items-center gap-1 xl:gap-1.5">
                  {PUBLIC_NAV_TABS.map((tab) => {
                    const active = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => navigateTo(tab.id)}
                        className={`px-2.5 xl:px-3 py-2 rounded-xl text-xs xl:text-sm font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer border ${
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
                      className={`inline-flex items-center gap-1.5 px-2.5 xl:px-3 py-2 rounded-xl text-xs xl:text-sm font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer border ${
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
                  {savedPinHash && (
                    <button
                      type="button"
                      onClick={() => setIsScreenLocked(true)}
                      aria-label="قفل الجلسة"
                      title="قفل الجلسة"
                      className="min-w-[38px] min-h-[38px] sm:min-w-[40px] sm:min-h-[40px] p-2 sm:p-2.5 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 transition-colors shrink-0 cursor-pointer flex items-center justify-center"
                    >
                      <Lock className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={openSettings}
                    aria-label="الإعدادات"
                    title="الإعدادات"
                    className={`inline-flex items-center justify-center gap-2 min-w-[38px] min-h-[38px] sm:min-w-[40px] sm:min-h-[40px] px-2.5 sm:px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer border ${
                      activeTab === 'settings'
                        ? 'accent-active-tab text-slate-900 dark:text-white'
                        : 'bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border-transparent text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {resolvedAvatarUrl ? (
                      <img
                        src={resolvedAvatarUrl}
                        alt={resolvedDisplayName}
                        referrerPolicy="no-referrer"
                        className="w-5 h-5 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <Settings className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                    )}
                    <span className="hidden sm:inline">الإعدادات</span>
                  </button>
                </div>
              </div>
            </header>

            {/* Top Dropdown Navigation Menu for Mobile & Small Screens */}
            <AnimatePresence>
              {mobileNavOpen && (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16 }}
                    onClick={() => setMobileNavOpen(false)}
                    className="fixed inset-x-0 bottom-0 top-14 sm:top-16 z-20 bg-black/50 backdrop-blur-xs lg:hidden"
                  />
                  <motion.nav
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    aria-label="قائمة التنقل المنسدلة"
                    className="absolute left-0 right-0 top-full z-30 lg:hidden bg-white/98 dark:bg-[#070B18]/98 border-b border-slate-200 dark:border-white/15 backdrop-blur-xl shadow-2xl max-h-[calc(100dvh-4rem)] overflow-y-auto"
                  >
                    <div className="max-w-7xl mx-auto p-3 sm:p-4 space-y-2">
                      {/* User Strip */}
                      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                        {resolvedAvatarUrl ? (
                          <img
                            src={resolvedAvatarUrl}
                            alt={resolvedDisplayName}
                            referrerPolicy="no-referrer"
                            className="w-8 h-8 rounded-full object-cover shrink-0 border border-white/15"
                          />
                        ) : (
                          <div className="accent-btn w-8 h-8 rounded-full text-white flex items-center justify-center text-xs font-bold shrink-0">
                            {resolvedDisplayName.slice(0, 1)}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {resolvedDisplayName}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate" dir="ltr">
                            {user.email}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {PUBLIC_NAV_TABS.map((tab) => {
                          const Icon = tab.icon;
                          const active = activeTab === tab.id;
                          return (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => navigateTo(tab.id)}
                              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-right transition-all cursor-pointer border min-h-[44px] ${
                                active
                                  ? 'accent-active-tab text-slate-900 dark:text-white'
                                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 border-transparent'
                              }`}
                            >
                              <Icon
                                className="w-4 h-4 shrink-0"
                                style={active ? { color: 'var(--accent-primary)' } : undefined}
                              />
                              <span className="truncate">{tab.label}</span>
                            </button>
                          );
                        })}

                        <button
                          type="button"
                          onClick={() => navigateTo('help')}
                          className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-right transition-all cursor-pointer border min-h-[44px] ${
                            activeTab === 'help'
                              ? 'accent-active-tab text-slate-900 dark:text-white'
                              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 border-transparent'
                          }`}
                        >
                          <BookOpen
                            className="w-4 h-4 shrink-0"
                            style={activeTab === 'help' ? { color: 'var(--accent-primary)' } : undefined}
                          />
                          <span className="truncate">دليل المساعدة</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => navigateTo('faq')}
                          className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-right transition-all cursor-pointer border min-h-[44px] ${
                            activeTab === 'faq'
                              ? 'accent-active-tab text-slate-900 dark:text-white'
                              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 border-transparent'
                          }`}
                        >
                          <HelpCircle
                            className="w-4 h-4 shrink-0"
                            style={activeTab === 'faq' ? { color: 'var(--accent-primary)' } : undefined}
                          />
                          <span className="truncate">أسئلة شائعة</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => navigateTo('privacy')}
                          className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-right transition-all cursor-pointer border min-h-[44px] ${
                            activeTab === 'privacy'
                              ? 'accent-active-tab text-slate-900 dark:text-white'
                              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 border-transparent'
                          }`}
                        >
                          <ShieldCheck
                            className="w-4 h-4 shrink-0"
                            style={activeTab === 'privacy' ? { color: 'var(--accent-primary)' } : undefined}
                          />
                          <span className="truncate">سياسة الخصوصية</span>
                        </button>

                        <button
                          type="button"
                          onClick={openSettings}
                          className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-right transition-all cursor-pointer border min-h-[44px] ${
                            activeTab === 'settings'
                              ? 'accent-active-tab text-slate-900 dark:text-white'
                              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 border-transparent'
                          }`}
                        >
                          <Settings className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-primary)' }} />
                          <span className="truncate">الإعدادات والمظهر</span>
                        </button>
                      </div>

                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => navigateTo('owner')}
                          className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-right transition-all cursor-pointer border min-h-[44px] ${
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

                      <div className="pt-1">
                        <PWAInstallButton variant="drawer" />
                      </div>
                    </div>
                  </motion.nav>
                </>
              )}
            </AnimatePresence>
          </div>

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
                    displayName={resolvedDisplayName}
                    userAvatarUrl={resolvedAvatarUrl}
                    customInstruction={customInstruction}
                    draftPrompt={draftPrompt}
                    onConsumeDraftPrompt={() => setDraftPrompt(null)}
                    onOpenPresentation={(topic) => {
                      if (topic) setPptxTopicDraft(topic);
                      navigateTo('pptx');
                    }}
                  />
                )}
                {activeTab === 'study' && <StudyStudio user={user} />}
                {activeTab === 'pptx' && (
                  <PresentationStudio
                    user={user}
                    initialTopic={pptxTopicDraft}
                    onConsumeInitialTopic={() => setPptxTopicDraft(null)}
                  />
                )}
                {activeTab === 'exam' && <ExamStudio user={user} />}
                {activeTab === 'history' && (
                  <UsageHistoryPage
                    user={user}
                    onOpenStudyTool={() => navigateTo('study')}
                    onOpenExamTool={() => navigateTo('exam')}
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
                    onGoToFaq={() => navigateTo('faq')}
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
                    displayName={resolvedDisplayName}
                    onGoToChat={() => navigateTo('chat')}
                    onGoToOwnerDashboard={isOwner ? () => navigateTo('owner') : undefined}
                  />
                )}
                {activeTab === 'privacy' && (
                  <PrivacyPolicyPage onBack={() => navigateTo('chat')} backLabel="العودة للمحادثة" />
                )}
                {activeTab === 'owner' && (
                  <OwnerDashboardPage user={user} onBackToChat={() => navigateTo('chat')} />
                )}
                {activeTab === 'settings' && (
                  <SettingsPage
                    userEmail={user.email || ''}
                    displayName={resolvedDisplayName}
                    avatarUrl={resolvedAvatarUrl}
                    hasCustomAvatar={Boolean(customAvatarUrl)}
                    themeMode={themeMode}
                    accentColor={accentColor}
                    backgroundStyle={backgroundStyle}
                    fontColor={fontColor}
                    customInstruction={customInstruction}
                    hasPin={Boolean(savedPinHash)}
                    onChangeTheme={handleChangeTheme}
                    onChangeAccent={handleChangeAccent}
                    onChangeBackground={handleChangeBackground}
                    onChangeFontColor={handleChangeFontColor}
                    onUpdateAvatar={handleUpdateAvatar}
                    onSaveDisplayName={handleSaveDisplayName}
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

          {/* Compact Persistent Footer */}
          <footer className="shrink-0 border-t border-slate-200 dark:border-white/10 bg-white/80 dark:bg-[#070B17]/85 backdrop-blur-md px-3 sm:px-6 py-1.5 print:hidden">
            <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
              <span>Nova AI · منصة الذكاء الاصطناعي العربية</span>
              <div className="flex items-center gap-3 sm:gap-4">
                <button
                  type="button"
                  onClick={() => navigateTo('help')}
                  className="hover:text-slate-900 dark:hover:text-white cursor-pointer transition-colors"
                >
                  المساعدة
                </button>
                <button
                  type="button"
                  onClick={() => navigateTo('faq')}
                  className="hover:text-slate-900 dark:hover:text-white cursor-pointer transition-colors"
                >
                  الأسئلة الشائعة
                </button>
                <button
                  type="button"
                  onClick={() => navigateTo('privacy')}
                  className="hover:text-slate-900 dark:hover:text-white underline underline-offset-4 cursor-pointer transition-colors font-medium"
                >
                  سياسة الخصوصية
                </button>
              </div>
            </div>
          </footer>
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
