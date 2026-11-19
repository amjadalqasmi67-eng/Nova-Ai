export type AccentColor = 'violet' | 'blue' | 'emerald' | 'rose';
export type ThemeMode = 'dark' | 'light';

export const ACCENT_STORAGE_KEY = 'nova_ai_accent_color';
export const THEME_STORAGE_KEY = 'nova_ai_theme_mode';

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
};

export function getSavedAccent(): AccentColor {
  try {
    const val = localStorage.getItem(ACCENT_STORAGE_KEY);
    if (val === 'violet' || val === 'blue' || val === 'emerald' || val === 'rose') {
      return val;
    }
  } catch {
    // ignore
  }
  return 'violet';
}

export function getSavedTheme(): ThemeMode {
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val === 'dark' || val === 'light') {
      return val;
    }
  } catch {
    // ignore
  }
  return 'dark';
}

export function applyThemePreferences(theme: ThemeMode, accent: AccentColor): void {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  const preset = ACCENT_PRESETS[accent];
  root.style.setProperty('--accent-primary', preset.primary);
  root.style.setProperty('--accent-secondary', preset.secondary);
  root.style.setProperty('--accent-soft', preset.soft);
  root.style.setProperty('--accent-border', preset.border);
  root.style.setProperty('--accent-glow', preset.glow);
  root.style.setProperty('--accent-text', theme === 'dark' ? preset.textDark : preset.textLight);

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  } catch {
    // ignore
  }
}
