import { useState, useRef, FormEvent, ChangeEvent } from 'react';
import {
  ArrowRight,
  Sun,
  Moon,
  Palette,
  UserCheck,
  RefreshCw,
  LogOut,
  Save,
  Lock,
  Check,
  Sparkles,
  Camera,
  Upload,
  Trash2,
  Type as TypeIcon,
  Image as ImageIcon,
} from 'lucide-react';
import {
  ACCENT_PRESETS,
  BACKGROUND_PRESETS,
  FONT_COLOR_PRESETS,
  AccentColor,
  BackgroundStyle,
  FontColor,
  ThemeMode,
} from '../lib/theme';
import { compressAvatarFile } from '../lib/imageUtils';
import { PWAInstallButton } from './PWAInstallButton';

interface SettingsPageProps {
  userEmail: string;
  displayName: string;
  avatarUrl: string | null;
  hasCustomAvatar: boolean;
  themeMode: ThemeMode;
  accentColor: AccentColor;
  backgroundStyle: BackgroundStyle;
  fontColor: FontColor;
  customInstruction: string;
  hasPin: boolean;
  onChangeTheme: (mode: ThemeMode) => void;
  onChangeAccent: (color: AccentColor) => void;
  onChangeBackground: (bg: BackgroundStyle) => void;
  onChangeFontColor: (fontColor: FontColor) => void;
  onUpdateAvatar: (avatarDataUrl: string) => Promise<void>;
  onSaveInstruction: (instruction: string) => Promise<void>;
  onUpdatePin: (pin: string | null) => void;
  onSwitchAccount: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onBack: () => void;
}

const COLOR_ORDER: AccentColor[] = ['violet', 'blue', 'emerald', 'rose', 'amber'];
const BG_ORDER: BackgroundStyle[] = [
  'cosmos',
  'midnight-violet',
  'forest-emerald',
  'crimson-night',
  'golden-amber',
  'clean',
];
const FONT_COLOR_ORDER: FontColor[] = ['auto', 'violet', 'emerald', 'rose', 'amber', 'blue'];

export function SettingsPage({
  userEmail,
  displayName,
  avatarUrl,
  hasCustomAvatar,
  themeMode,
  accentColor,
  backgroundStyle,
  fontColor,
  customInstruction,
  hasPin,
  onChangeTheme,
  onChangeAccent,
  onChangeBackground,
  onChangeFontColor,
  onUpdateAvatar,
  onSaveInstruction,
  onUpdatePin,
  onSwitchAccount,
  onSignOut,
  onBack,
}: SettingsPageProps) {
  const [instruction, setInstruction] = useState(customInstruction);
  const [pinInput, setPinInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [updatingAvatar, setUpdatingAvatar] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const avatarFileRef = useRef<HTMLInputElement | null>(null);
  const avatarCameraRef = useRef<HTMLInputElement | null>(null);

  const handleAvatarSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setFeedback({ type: 'err', text: 'يرجى اختيار ملف صورة صالح لحسابك.' });
      return;
    }

    setUpdatingAvatar(true);
    setFeedback(null);
    try {
      const compressedDataUrl = await compressAvatarFile(file);
      await onUpdateAvatar(compressedDataUrl);
      setFeedback({ type: 'ok', text: 'تم تحديث صورة حسابك وحفظها بنجاح.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر تحديث صورة الحساب.',
      });
    } finally {
      setUpdatingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setUpdatingAvatar(true);
    setFeedback(null);
    try {
      await onUpdateAvatar('');
      setFeedback({ type: 'ok', text: 'تمت إزالة الصورة المخصصة بنجاح.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر إزالة الصورة.',
      });
    } finally {
      setUpdatingAvatar(false);
    }
  };

  const handleSavePreferences = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      await onSaveInstruction(instruction.trim());
      if (pinInput.trim().length >= 4) {
        onUpdatePin(pinInput.trim());
        setPinInput('');
      }
      setFeedback({ type: 'ok', text: 'تم حفظ إعدادات Nova AI وتفضيلاتك بنجاح.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر حفظ التغييرات، يرجى المحاولة مجددًا.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSwitch = async () => {
    setSwitchingAccount(true);
    setFeedback(null);
    try {
      await onSwitchAccount();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر تبديل الحساب حاليًا.',
      });
    } finally {
      setSwitchingAccount(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto max-w-4xl w-full mx-auto px-3.5 sm:px-6 py-5 sm:py-6 space-y-5 sm:space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">إعدادات Nova AI</h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
            تحكم في صورة الحساب، الخلفية، ألوان الخطوط والأزرار، وإعدادات حسابك الشخصي.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white dark:bg-[#0B1020] border border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/25 text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-200 transition-colors cursor-pointer shrink-0"
        >
          <ArrowRight className="w-4 h-4" />
          <span>العودة للواجهة</span>
        </button>
      </div>

      {/* Section 1: Account Photo & Management */}
      <section className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-6 backdrop-blur-md space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
          <UserCheck className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          <span>صورة الحساب وإدارته</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-4 min-w-0">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName}
                referrerPolicy="no-referrer"
                className="w-16 h-16 rounded-full object-cover border-2 shrink-0 shadow-sm"
                style={{ borderColor: 'var(--accent-primary)' }}
              />
            ) : (
              <div className="accent-btn w-16 h-16 rounded-full text-white flex items-center justify-center text-xl font-bold shrink-0">
                {displayName.slice(0, 1)}
              </div>
            )}

            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900 dark:text-white truncate">{displayName}</div>
              <div className="text-xs text-slate-600 dark:text-slate-400 font-mono mt-0.5 break-all" dir="ltr">
                {userEmail}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                <input
                  ref={avatarFileRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarSelected}
                  className="hidden"
                />
                <input
                  ref={avatarCameraRef}
                  type="file"
                  accept="image/*"
                  capture="user"
                  onChange={handleAvatarSelected}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={updatingAvatar}
                  onClick={() => avatarFileRef.current?.click()}
                  className="accent-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{updatingAvatar ? 'جاري الرفع...' : 'رفع صورة للحساب'}</span>
                </button>
                <button
                  type="button"
                  disabled={updatingAvatar}
                  onClick={() => avatarCameraRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-[#111936] border border-slate-200 dark:border-white/15 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer disabled:opacity-50"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>التقاط صورة</span>
                </button>
                {hasCustomAvatar && (
                  <button
                    type="button"
                    disabled={updatingAvatar}
                    onClick={handleRemoveAvatar}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/25 text-xs font-semibold text-rose-600 dark:text-rose-300 cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>إزالة</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleSwitch}
              disabled={switchingAccount}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white dark:bg-[#111936] border border-slate-200 dark:border-white/15 hover:border-slate-300 dark:hover:border-white/30 text-xs font-semibold text-slate-800 dark:text-slate-100 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${switchingAccount ? 'animate-spin' : ''}`} />
              <span>تغيير الحساب</span>
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-xs font-semibold text-rose-600 dark:text-rose-300 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </div>
      </section>

      {/* Section 2: Theme Mode, Background Style, Accent Colors & Font Colors */}
      <section className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-6 space-y-6 backdrop-blur-md">
        {/* Dark / Light Switch */}
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white mb-3">
            {themeMode === 'dark' ? (
              <Moon className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            ) : (
              <Sun className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            )}
            <span>مظهر الإضاءة</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onChangeTheme('dark')}
              className={`flex items-center justify-between p-4 rounded-xl border transition-all cursor-pointer ${
                themeMode === 'dark'
                  ? 'accent-active-tab text-slate-900 dark:text-white'
                  : 'bg-slate-50 dark:bg-[#060916] border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#050711] border border-white/15 flex items-center justify-center text-blue-400">
                  <Moon className="w-4 h-4" />
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">الوضع الداكن</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">إضاءة ليلية مريحة للعين</div>
                </div>
              </div>
              {themeMode === 'dark' && <Check className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />}
            </button>

            <button
              type="button"
              onClick={() => onChangeTheme('light')}
              className={`flex items-center justify-between p-4 rounded-xl border transition-all cursor-pointer ${
                themeMode === 'light'
                  ? 'accent-active-tab text-slate-900 dark:text-white'
                  : 'bg-slate-50 dark:bg-[#060916] border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-300 flex items-center justify-center text-amber-500">
                  <Sun className="w-4 h-4" />
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">الوضع الفاتح</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">إضاءة نهارية واضحة ونقية</div>
                </div>
              </div>
              {themeMode === 'light' && <Check className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />}
            </button>
          </div>
        </div>

        {/* Background Style Selector */}
        <div className="pt-5 border-t border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white mb-1">
            <ImageIcon className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            <span>لون ونمط الخلفية</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
            غيّر خلفية التطبيق بالكامل باللون والأجواء التي تفضلها.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {BG_ORDER.map((bgKey) => {
              const preset = BACKGROUND_PRESETS[bgKey];
              const isSelected = backgroundStyle === bgKey;
              return (
                <button
                  key={bgKey}
                  type="button"
                  onClick={() => onChangeBackground(bgKey)}
                  className={`flex items-center justify-between gap-2 p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-slate-900 dark:border-white bg-slate-100 dark:bg-white/10 shadow-sm'
                      : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#060916] hover:border-slate-300 dark:hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-6 h-6 rounded-lg shrink-0 border border-white/20 shadow-sm"
                      style={{ backgroundImage: preset.swatch }}
                    />
                    <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {preset.label}
                    </span>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-slate-900 dark:text-white shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Font Color Selector */}
        <div className="pt-5 border-t border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white mb-1">
            <TypeIcon className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            <span>ألوان الخطوط والنصوص</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
            اختر لون الخطوط والعناوين في المحادثة وصفحات التطبيق (بنفسجي، أخضر، أحمر، أصفر، أزرق، أو تلقائي).
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {FONT_COLOR_ORDER.map((fcKey) => {
              const preset = FONT_COLOR_PRESETS[fcKey];
              const isSelected = fontColor === fcKey;
              return (
                <button
                  key={fcKey}
                  type="button"
                  onClick={() => onChangeFontColor(fcKey)}
                  className={`flex items-center justify-between gap-2 p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-slate-900 dark:border-white bg-slate-100 dark:bg-white/10 shadow-sm'
                      : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#060916] hover:border-slate-300 dark:hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-6 h-6 rounded-full shrink-0 border border-black/15 shadow-sm"
                      style={{ background: preset.swatch }}
                    />
                    <span
                      className="text-xs sm:text-sm font-bold truncate"
                      style={{ color: themeMode === 'dark' ? preset.darkText : preset.lightText }}
                    >
                      {preset.label}
                    </span>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-slate-900 dark:text-white shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Accent Color Selector */}
        <div className="pt-5 border-t border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white mb-1">
            <Palette className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            <span>لون الأزرار والواجهة الرئيسي</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
            يُحفظ اللون المختار تلقائيًا ويُطبّق على الأزرار والتبويبات واللمسات التفاعلية.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {COLOR_ORDER.map((key) => {
              const preset = ACCENT_PRESETS[key];
              const isSelected = accentColor === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onChangeAccent(key)}
                  className={`flex items-center justify-between gap-2 p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-slate-900 dark:border-white bg-slate-100 dark:bg-white/10 shadow-sm'
                      : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#060916] hover:border-slate-300 dark:hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-5 h-5 rounded-full shrink-0 shadow-sm"
                      style={{
                        backgroundImage: `linear-gradient(135deg, ${preset.primary}, ${preset.secondary})`,
                      }}
                    />
                    <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {preset.label}
                    </span>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-slate-900 dark:text-white shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Section 3: Install App on Any Device (PWA) */}
      <section className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-6 backdrop-blur-md space-y-3">
        <div className="text-sm font-bold text-slate-900 dark:text-white">
          تثبيت التطبيق على أجهزتك
        </div>
        <PWAInstallButton variant="card" />
      </section>

      {/* Section 4: AI Persona & Quick PIN Lock */}
      <form
        onSubmit={handleSavePreferences}
        className="rounded-2xl bg-white/90 dark:bg-[#0B1020]/90 border border-slate-200 dark:border-white/10 p-4 sm:p-6 space-y-5 backdrop-blur-md"
      >
        <div>
          <label
            htmlFor="settings-instruction"
            className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white mb-2"
          >
            <Sparkles className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            <span>تعليمات Nova AI الشخصية</span>
          </label>
          <textarea
            id="settings-instruction"
            rows={4}
            maxLength={1000}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="مثال: خاطبني بأسلوب عملي مباشر، وقدّم خطوات تنفيذية واضحة في كل إجابة..."
            className="accent-focus w-full rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 focus:outline-none px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 resize-none"
          />
          <div className="mt-1.5 text-left text-xs text-slate-500 tabular-nums" dir="ltr">
            {instruction.length} / 1000
          </div>
        </div>

        <div className="pt-4 border-t border-slate-200 dark:border-white/10">
          <div className="flex items-center justify-between mb-2">
            <label
              htmlFor="settings-pin"
              className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"
            >
              <Lock className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <span>رمز قفل الشاشة السريع (اختياري)</span>
            </label>
            {hasPin && (
              <button
                type="button"
                onClick={() => {
                  onUpdatePin(null);
                  setFeedback({ type: 'ok', text: 'تمت إزالة رمز القفل السريع.' });
                }}
                className="text-xs text-rose-500 hover:text-rose-400 cursor-pointer"
              >
                إزالة الرمز الحالي
              </button>
            )}
          </div>
          <input
            id="settings-pin"
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            placeholder={
              hasPin ? 'أدخل رمزًا جديدًا (4 أرقام فأكثر) للتحديث' : 'أدخل 4 أرقام فأكثر لتفعيل قفل الشاشة السريع'
            }
            className="accent-focus w-full rounded-xl bg-slate-50 dark:bg-[#060916] border border-slate-200 dark:border-white/10 focus:outline-none px-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
        </div>

        {feedback && (
          <div
            role="status"
            className={`rounded-xl px-4 py-3 text-xs border ${
              feedback.type === 'ok'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-200'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-200'
            }`}
          >
            {feedback.text}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="accent-btn inline-flex items-center gap-2 px-6 py-2.5 rounded-xl disabled:opacity-60 text-white text-sm font-semibold transition-all cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
