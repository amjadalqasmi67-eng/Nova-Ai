let activeOtpSessionToken: string | null = null;

export function setOtpSessionToken(token: string | null): void {
  activeOtpSessionToken = token && token.trim().length > 0 ? token.trim() : null;
}

export function getOtpSessionToken(): string | null {
  return activeOtpSessionToken;
}

export function getOtpHeaders(): Record<string, string> {
  if (!activeOtpSessionToken) return {};
  return { 'X-Nova-Otp-Token': activeOtpSessionToken };
}
