export function isValidEmailFormat(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export function mapFirebaseAuthError(err: unknown, context: 'login' | 'signup' | 'reset' | 'oauth'): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: string }).code || '')
      : '';
  const msg = err instanceof Error ? err.message : String(err || '');
  const combined = `${code} ${msg}`.toLowerCase();

  if (combined.includes('popup-closed-by-user')) {
    return 'تم إغلاق نافذة تسجيل الدخول قبل إتمام العملية.';
  }
  if (combined.includes('cancelled-popup-request')) {
    return 'تم فتح نافذة تسجيل دخول أخرى. يرجى إتمام النافذة الحالية.';
  }
  if (combined.includes('popup-blocked')) {
    return 'حظر المتصفح النافذة المنبثقة. يرجى السماح بالنوافذ المنبثقة ثم المحاولة مجددًا.';
  }
  if (combined.includes('invalid-credential') || combined.includes('wrong-password') || combined.includes('user-not-found')) {
    return context === 'reset'
      ? 'إذا كان البريد مسجلاً لدينا، فسيصلك رابط استعادة كلمة المرور خلال لحظات.'
      : 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  }
  if (combined.includes('email-already-in-use')) {
    return 'هذا البريد الإلكتروني مسجل مسبقًا. يمكنك تسجيل الدخول أو استعادة كلمة المرور.';
  }
  if (combined.includes('weak-password')) {
    return 'كلمة المرور قصيرة أو ضعيفة. يرجى استخدام 6 أحرف أو أرقام على الأقل.';
  }
  if (combined.includes('invalid-email')) {
    return 'صيغة البريد الإلكتروني غير صحيحة.';
  }
  if (combined.includes('too-many-requests')) {
    return 'تم تقييد المحاولات مؤقتًا بسبب كثرة الطلبات. يرجى الانتظار قليلاً ثم المحاولة.';
  }
  if (combined.includes('account-exists-with-different-credential')) {
    return 'هذا البريد الإلكتروني مرتبط بطريقة دخول أخرى (مثل جوجل أو كلمة المرور). جرّب الدخول بالطريقة الأساسية.';
  }
  if (combined.includes('operation-not-allowed') || combined.includes('unauthorized-domain')) {
    return 'طريقة الدخول هذه غير مفعّلة بعد في إعدادات Firebase Authentication للمشروع. يمكنك الدخول بحساب جوجل الآن أو تفعيل المزوّد من لوحة Firebase Console.';
  }
  if (combined.includes('network-request-failed')) {
    return 'تعذر الاتصال بالشبكة حاليًا. تحقق من اتصال الإنترنت ثم أعد المحاولة.';
  }

  if (context === 'signup') return 'تعذر إنشاء الحساب حاليًا. يرجى التحقق من البيانات والمحاولة مجددًا.';
  if (context === 'reset') return 'تعذر إرسال رابط الاستعادة حاليًا. يرجى المحاولة بعد قليل.';
  if (context === 'oauth') return 'تعذر إتمام تسجيل الدخول عبر المزوّد المحدد. يرجى المحاولة مجددًا.';
  return 'تعذر إتمام تسجيل الدخول حاليًا. يرجى المحاولة مجددًا.';
}
