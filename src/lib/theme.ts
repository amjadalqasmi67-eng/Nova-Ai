export type AccentColor = 'violet' | 'blue' | 'emerald' | 'rose' | 'amber';
export type ThemeMode = 'dark' | 'light';
export type BackgroundStyle =
  | 'cosmos'
  | 'midnight-violet'
  | 'forest-emerald'
  | 'crimson-night'
  | 'golden-amber'
  | 'clean';
export type FontColor = 'auto' | 'violet' | 'emerald' | 'rose' | 'amber' | 'blue';

export const ACCENT_STORAGE_KEY = 'nova_ai_accent_color';
export const THEME_STORAGE_KEY = 'nova_ai_theme_mode';
export const BG_STORAGE_KEY = 'nova_ai_bg_style';
export const FONT_COLOR_STORAGE_KEY = 'nova_ai_font_color';

export interface AccentPreset {
  id: AccentColor;
  label: string;
  primary: string;
  secondary: string;
  soft: string;
  border: string;
  glow: string;
  textDark: string;
  textLight: string;
}

export const ACCENT_PRESETS: Record<AccentColor, AccentPreset> = {
  violet: {
    id: 'violet',
    label: 'بنفسجي',
    primary: '#7c3aed',
    secondary: '#3b82f6',
    soft: 'rgba(124, 58, 237, 0.16)',
    border: 'rgba(139, 92, 246, 0.42)',
    glow: 'rgba(124, 58, 237, 0.38)',
    textDark: '#c4b5fd',
    textLight: '#6d28d9',
  },
  blue: {
    id: 'blue',
    label: 'أزرق',
    primary: '#2563eb',
    secondary: '#0ea5e9',
    soft: 'rgba(37, 99, 235, 0.16)',
    border: 'rgba(59, 130, 246, 0.42)',
    glow: 'rgba(37, 99, 235, 0.38)',
    textDark: '#93c5fd',
    textLight: '#1d4ed8',
  },
  emerald: {
    id: 'emerald',
    label: 'أخضر',
    primary: '#059669',
    secondary: '#14b8a6',
    soft: 'rgba(16, 185, 129, 0.16)',
    border: 'rgba(16, 185, 129, 0.42)',
    glow: 'rgba(16, 185, 129, 0.35)',
    textDark: '#6ee7b7',
    textLight: '#047857',
  },
  rose: {
    id: 'rose',
    label: 'أحمر',
    primary: '#e11d48',
    secondary: '#f97316',
    soft: 'rgba(225, 29, 72, 0.16)',
    border: 'rgba(244, 63, 94, 0.42)',
    glow: 'rgba(225, 29, 72, 0.35)',
    textDark: '#fda4af',
    textLight: '#be123c',
  },
  amber: {
    id: 'amber',
    label: 'أصفر',
    primary: '#d97706',
    secondary: '#eab308',
    soft: 'rgba(234, 179, 8, 0.18)',
    border: 'rgba(245, 158, 11, 0.45)',
    glow: 'rgba(234, 179, 8, 0.36)',
    textDark: '#fde047',
    textLight: '#b45309',
  },
};

export interface BackgroundPreset {
  id: BackgroundStyle;
  label: string;
  darkBg: string;
  lightBg: string;
  swatch: string;
  auraDark: string;
  auraLight: string;
  showStars: boolean;
}

export const BACKGROUND_PRESETS: Record<BackgroundStyle, BackgroundPreset> = {
  cosmos: {
    id: 'cosmos',
    label: 'الفضاء العميق',
    darkBg: '#050711',
    lightBg: '#f8fafc',
    swatch: 'linear-gradient(135deg, #050711, #1e1b4b)',
    auraDark:
      'radial-gradient(ellipse 65% 45% at 80% 12%, rgba(37, 99, 235, 0.18), transparent 70%), radial-gradient(ellipse 55% 45% at 15% 88%, rgba(124, 58, 237, 0.18), transparent 70%)',
    auraLight:
      'radial-gradient(ellipse 65% 45% at 80% 12%, rgba(59, 130, 246, 0.12), transparent 70%), radial-gradient(ellipse 55% 45% at 15% 88%, rgba(139, 92, 246, 0.12), transparent 70%)',
    showStars: true,
  },
  'midnight-violet': {
    id: 'midnight-violet',
    label: 'بنفسجي ليلي',
    darkBg: '#0f0720',
    lightBg: '#f5f3ff',
    swatch: 'linear-gradient(135deg, #2e1065, #5b21b6)',
    auraDark:
      'radial-gradient(ellipse 70% 50% at 75% 15%, rgba(139, 92, 246, 0.28), transparent 70%), radial-gradient(ellipse 60% 50% at 20% 85%, rgba(192, 132, 252, 0.16), transparent 70%)',
    auraLight:
      'radial-gradient(ellipse 70% 50% at 75% 15%, rgba(139, 92, 246, 0.18), transparent 70%), radial-gradient(ellipse 60% 50% at 20% 85%, rgba(167, 139, 250, 0.16), transparent 70%)',
    showStars: true,
  },
  'forest-emerald': {
    id: 'forest-emerald',
    label: 'أخضر زمردي',
    darkBg: '#04140f',
    lightBg: '#ecfdf5',
    swatch: 'linear-gradient(135deg, #064e3b, #059669)',
    auraDark:
      'radial-gradient(ellipse 70% 50% at 80% 15%, rgba(16, 185, 129, 0.24), transparent 70%), radial-gradient(ellipse 55% 45% at 20% 85%, rgba(20, 184, 166, 0.18), transparent 70%)',
    auraLight:
      'radial-gradient(ellipse 70% 50% at 80% 15%, rgba(16, 185, 129, 0.16), transparent 70%), radial-gradient(ellipse 55% 45% at 20% 85%, rgba(20, 184, 166, 0.14), transparent 70%)',
    showStars: true,
  },
  'crimson-night': {
    id: 'crimson-night',
    label: 'أحمر ياقوتي',
    darkBg: '#17060b',
    lightBg: '#fff1f2',
    swatch: 'linear-gradient(135deg, #881337, #e11d48)',
    auraDark:
      'radial-gradient(ellipse 70% 50% at 78% 14%, rgba(225, 29, 72, 0.24), transparent 70%), radial-gradient(ellipse 55% 45% at 18% 85%, rgba(249, 115, 22, 0.16), transparent 70%)',
    auraLight:
      'radial-gradient(ellipse 70% 50% at 78% 14%, rgba(244, 63, 94, 0.16), transparent 70%), radial-gradient(ellipse 55% 45% at 18% 85%, rgba(251, 146, 60, 0.14), transparent 70%)',
    showStars: true,
  },
  'golden-amber': {
    id: 'golden-amber',
    label: 'ذهبي أصفر',
    darkBg: '#140f04',
    lightBg: '#fefce8',
    swatch: 'linear-gradient(135deg, #78350f, #eab308)',
    auraDark:
      'radial-gradient(ellipse 70% 50% at 78% 14%, rgba(234, 179, 8, 0.22), transparent 70%), radial-gradient(ellipse 55% 45% at 18% 85%, rgba(245, 158, 11, 0.16), transparent 70%)',
    auraLight:
      'radial-gradient(ellipse 70% 50% at 78% 14%, rgba(250, 204, 21, 0.20), transparent 70%), radial-gradient(ellipse 55% 45% at 18% 85%, rgba(245, 158, 11, 0.14), transparent 70%)',
    showStars: true,
  },
  clean: {
    id: 'clean',
    label: 'خلفية صافية',
    darkBg: '#090d16',
    lightBg: '#ffffff',
    swatch: 'linear-gradient(135deg, #334155, #94a3b8)',
    auraDark: 'none',
    auraLight: 'none',
    showStars: false,
  },
};

export interface FontColorPreset {
  id: FontColor;
  label: string;
  swatch: string;
  darkText: string;
  lightText: string;
}

export const FONT_COLOR_PRESETS: Record<FontColor, FontColorPreset> = {
  auto: {
    id: 'auto',
    label: 'تلقائي',
    swatch: 'linear-gradient(135deg, #e2e8f0, #475569)',
    darkText: '#f1f5f9',
    lightText: '#0f172a',
  },
  violet: {
    id: 'violet',
    label: 'بنفسجي',
    swatch: '#a78bfa',
    darkText: '#ddd6fe',
    lightText: '#5b21b6',
  },
  emerald: {
    id: 'emerald',
    label: 'أخضر',
    swatch: '#34d399',
    darkText: '#a7f3d0',
    lightText: '#065f46',
  },
  rose: {
    id: 'rose',
    label: 'أحمر',
    swatch: '#fb7185',
    darkText: '#fecdd3',
    lightText: '#9f1239',
  },
  amber: {
    id: 'amber',
    label: 'أصفر',
    swatch: '#facc15',
    darkText: '#fef08a',
    lightText: '#92400e',
  },
  blue: {
    id: 'blue',
    label: 'أزرق',
    swatch: '#60a5fa',
    darkText: '#bfdbfe',
    lightText: '#1e40af',
  },
};

export function isValidAccentColor(val: unknown): val is AccentColor {
  return val === 'violet' || val === 'blue' || val === 'emerald' || val === 'rose' || val === 'amber';
}

export function isValidBackgroundStyle(val: unknown): val is BackgroundStyle {
  return (
    val === 'cosmos' ||
    val === 'midnight-violet' ||
    val === 'forest-emerald' ||
    val === 'crimson-night' ||
    val === 'golden-amber' ||
    val === 'clean'
  );
}

export function isValidFontColor(val: unknown): val is FontColor {
  return (
    val === 'auto' ||
    val === 'violet' ||
    val === 'emerald' ||
    val === 'rose' ||
    val === 'amber' ||
    val === 'blue'
  );
}

export function getSavedAccent(): AccentColor {
  try {
    const val = localStorage.getItem(ACCENT_STORAGE_KEY);
    if (isValidAccentColor(val)) return val;
  } catch {
    // ignore
  }
  return 'violet';
}

export function getSavedTheme(): ThemeMode {
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val === 'dark' || val === 'light') return val;
  } catch {
    // ignore
  }
  return 'dark';
}

export function getSavedBackgroundStyle(): BackgroundStyle {
  try {
    const val = localStorage.getItem(BG_STORAGE_KEY);
    if (isValidBackgroundStyle(val)) return val;
  } catch {
    // ignore
  }
  return 'cosmos';
}

export function getSavedFontColor(): FontColor {
  try {
    const val = localStorage.getItem(FONT_COLOR_STORAGE_KEY);
    if (isValidFontColor(val)) return val;
  } catch {
    // ignore
  }
  return 'auto';
}

export function applyThemePreferences(
  theme: ThemeMode,
  accent: AccentColor,
  bgStyle: BackgroundStyle = getSavedBackgroundStyle(),
  fontColor: FontColor = getSavedFontColor()
): void {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  const preset = ACCENT_PRESETS[accent] || ACCENT_PRESETS.violet;
  const bgPreset = BACKGROUND_PRESETS[bgStyle] || BACKGROUND_PRESETS.cosmos;
  const fontPreset = FONT_COLOR_PRESETS[fontColor] || FONT_COLOR_PRESETS.auto;

  root.style.setProperty('--accent-primary', preset.primary);
  root.style.setProperty('--accent-secondary', preset.secondary);
  root.style.setProperty('--accent-soft', preset.soft);
  root.style.setProperty('--accent-border', preset.border);
  root.style.setProperty('--accent-glow', preset.glow);
  root.style.setProperty('--accent-text', theme === 'dark' ? preset.textDark : preset.textLight);

  root.style.setProperty('--app-bg-color', theme === 'dark' ? bgPreset.darkBg : bgPreset.lightBg);
  root.style.setProperty('--app-text-color', theme === 'dark' ? fontPreset.darkText : fontPreset.lightText);
  root.dataset.fontColor = fontColor;

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    localStorage.setItem(ACCENT_STORAGE_KEY, accent);
    localStorage.setItem(BG_STORAGE_KEY, bgStyle);
    localStorage.setItem(FONT_COLOR_STORAGE_KEY, fontColor);
  } catch {
    // ignore
  }
}
