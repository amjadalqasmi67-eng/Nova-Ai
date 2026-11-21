const PIN_STORAGE_KEY = 'nova_ai_session_pin';
const PIN_ATTEMPTS_KEY = 'nova_ai_pin_attempts';
const MAX_FAILED_ATTEMPTS = 5;
const BASE_LOCKOUT_MS = 30_000;
const PBKDF2_ITERATIONS = 120_000;

interface PinAttemptState {
  failures: number;
  lockedUntil: number;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function derivePinHash(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const saltCopy = new Uint8Array(salt);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltCopy.buffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

export async function hashPin(pin: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const derived = await derivePinHash(pin, salt);
  return `v1:${bytesToHex(salt)}:${bytesToHex(derived)}`;
}

export async function verifyStoredPin(attempt: string, stored: string): Promise<{ valid: boolean; upgradedHash?: string }> {
  if (!stored || !attempt) return { valid: false };

  if (stored.startsWith('v1:')) {
    const parts = stored.split(':');
    if (parts.length !== 3) return { valid: false };
    const salt = hexToBytes(parts[1]);
    const expected = hexToBytes(parts[2]);
    if (!salt || !expected) return { valid: false };
    const actual = await derivePinHash(attempt, salt);
    return { valid: constantTimeEqual(actual, expected) };
  }

  // Legacy plaintext migration path: verify once and immediately upgrade to PBKDF2 hash
  const encoder = new TextEncoder();
  const a = encoder.encode(attempt);
  const b = encoder.encode(stored);
  if (constantTimeEqual(a, b)) {
    const upgradedHash = await hashPin(attempt);
    return { valid: true, upgradedHash };
  }
  return { valid: false };
}

export function getStoredPinHash(): string | null {
  try {
    return localStorage.getItem(PIN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveStoredPinHash(hashOrNull: string | null): void {
  try {
    if (hashOrNull) {
      localStorage.setItem(PIN_STORAGE_KEY, hashOrNull);
    } else {
      localStorage.removeItem(PIN_STORAGE_KEY);
      localStorage.removeItem(PIN_ATTEMPTS_KEY);
    }
  } catch {
    // Storage unavailable
  }
}

function getAttemptState(): PinAttemptState {
  try {
    const raw = localStorage.getItem(PIN_ATTEMPTS_KEY);
    if (!raw) return { failures: 0, lockedUntil: 0 };
    const parsed = JSON.parse(raw) as Partial<PinAttemptState>;
    return {
      failures: typeof parsed.failures === 'number' && parsed.failures >= 0 ? parsed.failures : 0,
      lockedUntil: typeof parsed.lockedUntil === 'number' && parsed.lockedUntil >= 0 ? parsed.lockedUntil : 0,
    };
  } catch {
    return { failures: 0, lockedUntil: 0 };
  }
}

export function getPinLockoutRemainingMs(): number {
  const state = getAttemptState();
  const remaining = state.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function recordFailedPinAttempt(): number {
  const prev = getAttemptState();
  const failures = prev.failures + 1;
  let lockedUntil = 0;
  if (failures >= MAX_FAILED_ATTEMPTS) {
    const multiplier = Math.min(8, Math.pow(2, Math.floor((failures - MAX_FAILED_ATTEMPTS) / 2)));
    lockedUntil = Date.now() + BASE_LOCKOUT_MS * multiplier;
  }
  try {
    localStorage.setItem(PIN_ATTEMPTS_KEY, JSON.stringify({ failures, lockedUntil }));
  } catch {
    // ignore
  }
  return lockedUntil > Date.now() ? lockedUntil - Date.now() : 0;
}

export function clearFailedPinAttempts(): void {
  try {
    localStorage.removeItem(PIN_ATTEMPTS_KEY);
  } catch {
    // ignore
  }
}
