/**
 * Input & URL sanitization utilities for Nova AI client UI.
 * Strips dangerous control characters and bidi override sequences,
 * and ensures external links strictly use http:/https: protocols.
 */

const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;

export function sanitizeUserText(raw: string, maxLength = 20000, preserveNewlines = true): string {
  if (typeof raw !== 'string') return '';
  let cleaned = raw.replace(CONTROL_CHARS_RE, '');
  if (!preserveNewlines) {
    cleaned = cleaned.replace(/[\r\n\t]+/g, ' ');
  }
  return cleaned.trim().slice(0, maxLength);
}

export function safeHttpUrl(rawUrl: string | undefined | null): string | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.replace(CONTROL_CHARS_RE, '').trim();
  if (!trimmed || trimmed.length > 1000) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}
