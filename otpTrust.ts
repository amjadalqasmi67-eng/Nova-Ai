import crypto from 'crypto';

export const OTP_COOKIE_NAME = 'nova_otp_session';
export const OTP_CHALLENGE_COOKIE_NAME = 'nova_otp_challenge';
export const OTP_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LOCKOUT_MS = 10 * 60 * 1000;
export const OTP_TRUSTED_DEVICE_DAYS = 30;
export const OTP_TRUSTED_DEVICE_TTL_MS = OTP_TRUSTED_DEVICE_DAYS * 24 * 60 * 60 * 1000;
export const OTP_TRUSTED_DEVICE_MAX_AGE_SEC = OTP_TRUSTED_DEVICE_DAYS * 24 * 60 * 60;
export const OTP_WS_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export interface TrustedTokenPayload {
  v: 2;
  kind: 'trusted_device' | 'ws_session';
  uid: string;
  did: string;
  fp: string;
  iat: number;
  exp: number;
}

export interface ChallengeCookiePayload {
  v: 2;
  cid: string;
  uid: string;
  salt: string;
  codeHash: string;
  exp: number;
}

/**
 * Derives a deterministic HMAC signing key across server restarts and new deployments.
 * Priority:
 * 1. Explicit `OTP_SIGNING_SECRET` environment variable
 * 2. Deterministic HKDF from persistent server-only secrets (`RESEND_API_KEY`, `SMTP_PASS`, `SMTP_USER`, `GEMINI_API_KEY`) + `projectId`
 * 3. Ephemeral CSPRNG secret only when zero server secrets exist (bare local dev/test)
 */
export function deriveOtpSigningSecret(
  env: Record<string, string | undefined>,
  projectId?: string
): string {
  const explicit = env.OTP_SIGNING_SECRET?.trim();
  if (explicit) {
    return crypto
      .createHmac('sha256', 'nova-ai:otp:explicit:v2')
      .update(explicit)
      .digest('hex');
  }

  const persistentMaterials = [
    env.RESEND_API_KEY?.trim() || '',
    env.SMTP_PASS?.trim() || '',
    env.SMTP_USER?.trim() || '',
    env.GEMINI_API_KEY?.trim() || '',
  ];
  const hasServerSecret = persistentMaterials.some((value) => value.length > 0);
  if (hasServerSecret) {
    return crypto
      .createHmac('sha256', 'nova-ai:otp:derived:v2')
      .update(JSON.stringify([projectId || 'nova-ai', ...persistentMaterials]))
      .digest('hex');
  }

  return crypto.randomBytes(32).toString('hex');
}

/**
 * Normalizes User-Agent to a stable OS + form factor + browser family descriptor.
 * - Survives routine browser auto-updates (e.g. Chrome 134 -> Chrome 135) on the same browser/device.
 * - Rejects switching to a different browser family (Chrome vs Firefox vs Safari vs Edge)
 *   or a different OS/device (Windows vs macOS vs Android vs iOS).
 */
export function extractDeviceBrowserDescriptor(userAgent: string | undefined): string {
  const ua = (userAgent || '').trim();
  if (!ua) return 'unknown-os|unknown-browser|unknown-form';
  const lower = ua.toLowerCase();

  let os = 'other-os';
  if (/iphone/.test(lower)) os = 'ios-iphone';
  else if (/ipad/.test(lower)) os = 'ios-ipad';
  else if (/android/.test(lower)) os = 'android';
  else if (/cros/.test(lower)) os = 'chromeos';
  else if (/windows nt|win64|wow64/.test(lower)) os = 'windows';
  else if (/macintosh|mac os x/.test(lower)) os = 'macos';
  else if (/linux|x11/.test(lower)) os = 'linux';

  const form = /ipad|tablet/.test(lower)
    ? 'tablet'
    : /mobile|iphone|ipod|android/.test(lower)
      ? 'mobile'
      : 'desktop';

  let browser = '';
  if (/edg\/|edga\/|edgios\/|edge\//.test(lower)) browser = 'edge';
  else if (/opr\/|opera/.test(lower)) browser = 'opera';
  else if (/samsungbrowser\//.test(lower)) browser = 'samsung';
  else if (/firefox\/|fxios\//.test(lower)) browser = 'firefox';
  else if (/crios\/|chrome\//.test(lower)) browser = 'chrome';
  else if (/safari\//.test(lower)) browser = 'safari';
  else {
    browser = lower
      .replace(/\/[\d._-]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }

  return `${os}|${browser || 'generic'}|${form}`;
}

export function computeDeviceFingerprint(signingSecret: string, userAgent: string | undefined): string {
  const descriptor = extractDeviceBrowserDescriptor(userAgent);
  return crypto
    .createHmac('sha256', signingSecret)
    .update(`fp:v2:${descriptor}`)
    .digest('base64url')
    .slice(0, 32);
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf-8');
  const bBuf = Buffer.from(b, 'utf-8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function hashOtpCodeWithSecret(
  signingSecret: string,
  uid: string,
  salt: string,
  code: string
): string {
  return crypto
    .createHmac('sha256', signingSecret)
    .update(`otp:${uid}:${salt}:${code}`)
    .digest('hex');
}

function signTokenPayload(signingSecret: string, domain: string, payloadObj: unknown): string {
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf-8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', signingSecret)
    .update(`${domain}:${payloadB64}`)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifySignedPayload<T>(
  signingSecret: string,
  domain: string,
  token: string | undefined
): T | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const dotIdx = token.indexOf('.');
  const payloadB64 = token.slice(0, dotIdx);
  const sigB64 = token.slice(dotIdx + 1);
  if (!payloadB64 || !sigB64 || sigB64.includes('.')) return null;

  const expectedSig = crypto
    .createHmac('sha256', signingSecret)
    .update(`${domain}:${payloadB64}`)
    .digest('base64url');
  if (!timingSafeEqualStr(sigB64, expectedSig)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as T;
  } catch {
    return null;
  }
}

export function issueTrustedDeviceToken(
  signingSecret: string,
  uid: string,
  userAgent: string | undefined,
  now = Date.now(),
  deviceId: string = crypto.randomUUID()
): { token: string; deviceId: string; issuedAt: number; expiresAt: number } {
  const expiresAt = now + OTP_TRUSTED_DEVICE_TTL_MS;
  const payload: TrustedTokenPayload = {
    v: 2,
    kind: 'trusted_device',
    uid,
    did: deviceId,
    fp: computeDeviceFingerprint(signingSecret, userAgent),
    iat: now,
    exp: expiresAt,
  };
  return {
    token: signTokenPayload(signingSecret, 'session', payload),
    deviceId,
    issuedAt: now,
    expiresAt,
  };
}

export function issueShortSessionToken(
  signingSecret: string,
  uid: string,
  userAgent: string | undefined,
  trustedExpiresAt: number,
  deviceId: string = crypto.randomUUID(),
  now = Date.now()
): { token: string; expiresAt: number } {
  const expiresAt = Math.min(trustedExpiresAt, now + OTP_WS_TOKEN_TTL_MS);
  const payload: TrustedTokenPayload = {
    v: 2,
    kind: 'ws_session',
    uid,
    did: deviceId,
    fp: computeDeviceFingerprint(signingSecret, userAgent),
    iat: now,
    exp: expiresAt,
  };
  return {
    token: signTokenPayload(signingSecret, 'session', payload),
    expiresAt,
  };
}

export function verifyTrustedOrSessionToken(
  signingSecret: string,
  token: string | undefined,
  uid: string,
  userAgent: string | undefined,
  revokedDeviceIds: Map<string, number>,
  now = Date.now(),
  allowedKind?: 'trusted_device' | 'ws_session'
): TrustedTokenPayload | null {
  const parsed = verifySignedPayload<TrustedTokenPayload>(signingSecret, 'session', token);
  if (!parsed || parsed.v !== 2) return null;
  if (allowedKind && parsed.kind !== allowedKind) return null;
  if (parsed.kind !== 'trusted_device' && parsed.kind !== 'ws_session') return null;
  if (parsed.uid !== uid) return null;
  if (typeof parsed.did !== 'string' || parsed.did.length < 8) return null;
  if (revokedDeviceIds.has(parsed.did)) return null;
  if (typeof parsed.iat !== 'number' || typeof parsed.exp !== 'number') return null;
  if (parsed.exp <= now) return null;
  if (parsed.exp - parsed.iat > OTP_TRUSTED_DEVICE_TTL_MS + 60_000) return null;

  const expectedFp = computeDeviceFingerprint(signingSecret, userAgent);
  if (typeof parsed.fp !== 'string' || !timingSafeEqualStr(parsed.fp, expectedFp)) {
    return null;
  }

  return parsed;
}

export function extractValidDeviceIdForLogout(
  signingSecret: string,
  token: string | undefined,
  uid: string
): { did: string; exp: number } | null {
  const parsed = verifySignedPayload<TrustedTokenPayload>(signingSecret, 'session', token);
  if (!parsed || parsed.v !== 2 || parsed.uid !== uid) return null;
  if (typeof parsed.did !== 'string' || parsed.did.length < 8) return null;
  const exp = typeof parsed.exp === 'number' ? parsed.exp : Date.now() + OTP_TRUSTED_DEVICE_TTL_MS;
  return { did: parsed.did, exp };
}

export function signOtpChallengeCookie(
  signingSecret: string,
  payload: Omit<ChallengeCookiePayload, 'v'>
): string {
  return signTokenPayload(signingSecret, 'challenge', { v: 2, ...payload });
}

export function verifyOtpChallengeCookie(
  signingSecret: string,
  token: string | undefined,
  uid: string,
  now = Date.now()
): ChallengeCookiePayload | null {
  const parsed = verifySignedPayload<ChallengeCookiePayload>(signingSecret, 'challenge', token);
  if (!parsed || parsed.v !== 2) return null;
  if (parsed.uid !== uid) return null;
  if (
    typeof parsed.cid !== 'string' ||
    parsed.cid.length < 8 ||
    typeof parsed.salt !== 'string' ||
    !parsed.salt ||
    typeof parsed.codeHash !== 'string' ||
    !parsed.codeHash ||
    typeof parsed.exp !== 'number' ||
    parsed.exp <= now
  ) {
    return null;
  }
  return parsed;
}
