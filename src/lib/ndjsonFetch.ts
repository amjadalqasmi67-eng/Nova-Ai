export interface NdjsonStreamEvent<T = unknown> {
  type?: string;
  message?: string;
  data?: T;
  error?: string;
  index?: number;
  slide?: unknown;
  deckTitle?: string;
  deckSubtitle?: string;
}

export async function postNdjsonOrJson<T>(
  url: string,
  options: {
    headers: Record<string, string>;
    body: Record<string, unknown>;
    onStatus?: (message: string) => void;
    onEvent?: (event: NdjsonStreamEvent<T>) => void;
  }
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: JSON.stringify({
      ...options.body,
      stream: true,
    }),
  });

  const contentType = (response.headers.get('content-type') || '').toLowerCase();

  // Streaming NDJSON response path (keeps Cloud Run / AI Studio proxy alive via heartbeats)
  if (response.ok && contentType.includes('ndjson') && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalData: T | null = null;

    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('<')) {
        throw new Error('انقطع الاتصال بالخادم أثناء المعالجة. يرجى المحاولة مرة أخرى.');
      }
      const event = JSON.parse(trimmed) as NdjsonStreamEvent<T>;
      options.onEvent?.(event);
      if (event.type === 'status' && typeof event.message === 'string') {
        options.onStatus?.(event.message);
      } else if (event.type === 'done' && event.data !== undefined) {
        finalData = event.data;
      } else if (event.type === 'error') {
        throw new Error(event.error || 'تعذر إكمال الطلب حاليًا.');
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        processLine(line);
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      processLine(buffer);
    }

    if (finalData !== null) {
      return finalData;
    }
    throw new Error('اكتمل الاتصال دون استلام النتيجة الكاملة. يرجى المحاولة مرة أخرى.');
  }

  // Standard JSON or fallback HTML/Gateway error detection
  const rawText = await response.text();
  const trimmedRaw = rawText.trim();

  if (
    contentType.includes('text/html') ||
    trimmedRaw.startsWith('<') ||
    /^<!doctype/i.test(trimmedRaw)
  ) {
    if (response.redirected || response.status === 401 || response.status === 403) {
      throw new Error('انتهت جلسة المتصفح أو أعادت البوابة التوجيه. يرجى تحديث الصفحة ثم المحاولة مجددًا.');
    }
    if (response.status === 502 || response.status === 504) {
      throw new Error('استغرق الخادم وقتًا أطول من المعتاد أو حدث انقطاع مؤقت. يرجى المحاولة مجددًا.');
    }
    throw new Error(
      'استلم المتصفح صفحة ويب بدلاً من استجابة الخادم. إذا كنت تستخدم رابط مشاركة قديمًا فقم بتحديث الصفحة أو استخدم رابط النشر المباشر المحدّث.'
    );
  }

  let parsed: (T & { error?: string }) | null = null;
  if (trimmedRaw) {
    try {
      parsed = JSON.parse(trimmedRaw) as T & { error?: string };
    } catch {
      throw new Error('استلم المتصفح ردًا غير مفهوم من الخادم. يرجى المحاولة مرة أخرى.');
    }
  }

  if (!response.ok || !parsed) {
    throw new Error(parsed?.error || `تعذر إتمام الطلب (رمز الحالة ${response.status}).`);
  }

  if (parsed.error) {
    throw new Error(parsed.error);
  }

  return parsed;
}
