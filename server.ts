import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const firebaseConfigPath = path.resolve(__dirname, 'firebase-applet-config.json');
const firebaseConfig = fs.existsSync(firebaseConfigPath)
  ? JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8'))
  : null;

let cachedAiClient: { apiKey: string; client: GoogleGenAI } | null = null;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('MISSING_GEMINI_API_KEY');
  }
  if (cachedAiClient && cachedAiClient.apiKey === apiKey) {
    return cachedAiClient.client;
  }
  const client = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  cachedAiClient = { apiKey, client };
  return client;
}

function mapGeminiError(err: unknown): { status: number; message: string; requiresPaidKey?: boolean } {
  const raw = err instanceof Error ? err.message : String(err);
  const statusMatch = raw.match(/\b(400|401|403|404|429|500|503|504)\b/);
  const statusCode = statusMatch ? Number(statusMatch[1]) : 500;

  if (raw === 'MISSING_GEMINI_API_KEY') {
    return {
      status: 500,
      message: 'مفتاح GEMINI_API_KEY غير مضاف أو غير مفعّل في إعدادات الخادم (Settings > Secrets).',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || statusCode === 429) {
    return {
      status: 429,
      requiresPaidKey: true,
      message:
        'تم تجاوز حد الاستخدام المجاني أو أن هذا النموذج يتطلب مفتاح API مدفوعًا من Settings > Secrets.',
    };
  }
  if (
    raw.includes('PERMISSION_DENIED') ||
    raw.includes('API_KEY_INVALID') ||
    raw.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') ||
    statusCode === 403 ||
    statusCode === 401
  ) {
    return {
      status: 403,
      requiresPaidKey: true,
      message:
        'مفتاح API الحالي لا يملك صلاحية الوصول إلى هذا النموذج. يرجى التأكد من تفعيل GEMINI_API_KEY في Settings > Secrets.',
    };
  }
  if (raw.includes('NOT_FOUND') || statusCode === 404) {
    return {
      status: 404,
      message: 'النموذج المطلوب غير متاح حاليًا في هذا الإعداد.',
    };
  }
  if (raw.includes('UNAVAILABLE') || raw.includes('high demand') || statusCode === 503) {
    return {
      status: 503,
      message: 'يواجه نموذج الذكاء الاصطناعي ضغطًا مرتفعًا مؤقتًا الآن (503). يرجى المحاولة مرة أخرى بعد لحظات.',
    };
  }
  if (raw.includes('AbortError') || raw.includes('TimeoutError') || raw.includes('ETIMEDOUT') || statusCode === 504) {
    return {
      status: 504,
      message: 'استغرق نموذج الذكاء الاصطناعي وقتًا أطول من المتوقع في معالجة السؤال. يرجى المحاولة مرة أخرى أو تقسيم السؤال.',
    };
  }
  return {
    status: statusCode >= 400 && statusCode < 600 ? statusCode : 500,
    message: 'حدث خطأ أثناء الاتصال بمحرك Gemini. يرجى المحاولة مرة أخرى.',
  };
}

function extractGeminiText(response: {
  text?: string;
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
}): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const answerParts = parts
    .filter((p) => !p.thought && typeof p.text === 'string' && p.text.length > 0)
    .map((p) => p.text!);

  if (answerParts.length > 0) {
    return answerParts.join('').trim();
  }

  const direct = response.text?.trim();
  if (direct) return direct;

  const anyParts = parts
    .filter((p) => typeof p.text === 'string' && p.text.trim().length > 0)
    .map((p) => p.text!.trim());

  return anyParts.join('\n').trim();
}

function extractStreamChunkInfo(chunk: {
  text?: string;
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
}): { delta: string; hasThought: boolean; finishReason?: string } {
  const candidate = chunk.candidates?.[0];
  const parts = candidate?.content?.parts;
  let hasThought = false;
  let delta = '';

  if (Array.isArray(parts) && parts.length > 0) {
    for (const part of parts) {
      if (part.thought) {
        hasThought = true;
      } else if (typeof part.text === 'string' && part.text.length > 0) {
        delta += part.text;
      }
    }
  } else if (typeof chunk.text === 'string' && chunk.text.length > 0) {
    delta = chunk.text;
  }

  return {
    delta,
    hasThought,
    finishReason: candidate?.finishReason,
  };
}

type ChatContentPart = { text?: string; inlineData?: { data: string; mimeType: string } };
type ChatContentTurn = { role: string; parts: ChatContentPart[] };
type ChatAttempt = {
  model: string;
  thinkingLevel: ThinkingLevel;
  delayMs: number;
  inactivityTimeoutMs: number;
};

function isComplexPrompt(contents: ChatContentTurn[]): boolean {
  const lastTurn = contents[contents.length - 1];
  if (!lastTurn) return false;

  const hasImage = lastTurn.parts.some((p) => Boolean(p.inlineData));
  const text = lastTurn.parts
    .map((p) => p.text || '')
    .join(' ')
    .trim();

  if (hasImage || text.length >= 130) {
    return true;
  }

  const hardKeywords =
    /(اشرح بالتفصيل|فسّر|برهن|أثبت|حلل|قارن|معادلة|خوارزمية|برمجة|كود|خطأ برمجي|مسألة|احسب|فيزياء|كيمياء|رياضيات|تفاضل|تكامل|منطق|فلسفة|اقتصاد|استنتاج|بنية|معمارية|خطة عمل|استراتيجية|لماذا|كيف يعمل|debug|prove|algorithm|architecture|analyze|calculus|equation|theorem)/i;
  const symbolHint = /[{}=><^√∫∑]|```|\n/;

  return hardKeywords.test(text) || symbolHint.test(text);
}

function buildChatAttempts(thinkingDepth: 'low' | 'high' | undefined, isComplex: boolean): ChatAttempt[] {
  if (thinkingDepth === 'high') {
    return [
      {
        model: 'gemini-4-hydrogen',
        thinkingLevel: ThinkingLevel.MEDIUM,
        delayMs: 0,
        inactivityTimeoutMs: 55000,
      },
      {
        model: 'gemini-3.1-flash-lite',
        thinkingLevel: ThinkingLevel.MEDIUM,
        delayMs: 250,
        inactivityTimeoutMs: 45000,
      },
      {
        model: 'gemini-4-hydrogen',
        thinkingLevel: ThinkingLevel.LOW,
        delayMs: 250,
        inactivityTimeoutMs: 40000,
      },
    ];
  }

  if (isComplex) {
    return [
      {
        model: 'gemini-4-hydrogen',
        thinkingLevel: ThinkingLevel.LOW,
        delayMs: 0,
        inactivityTimeoutMs: 45000,
      },
      {
        model: 'gemini-3.1-flash-lite',
        thinkingLevel: ThinkingLevel.MEDIUM,
        delayMs: 250,
        inactivityTimeoutMs: 45000,
      },
      {
        model: 'gemini-3.1-flash-lite',
        thinkingLevel: ThinkingLevel.LOW,
        delayMs: 250,
        inactivityTimeoutMs: 35000,
      },
    ];
  }

  return [
    {
      model: 'gemini-3.1-flash-lite',
      thinkingLevel: ThinkingLevel.MINIMAL,
      delayMs: 0,
      inactivityTimeoutMs: 30000,
    },
    {
      model: 'gemini-4-hydrogen',
      thinkingLevel: ThinkingLevel.LOW,
      delayMs: 200,
      inactivityTimeoutMs: 35000,
    },
    {
      model: 'gemini-3.1-flash-lite',
      thinkingLevel: ThinkingLevel.LOW,
      delayMs: 200,
      inactivityTimeoutMs: 30000,
    },
  ];
}

function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('503') ||
    msg.includes('500') ||
    msg.includes('504') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('EMPTY_REPLY') ||
    msg.includes('AbortError') ||
    msg.includes('TimeoutError') ||
    msg.includes('ECONNRESET') ||
    msg.includes('fetch failed')
  );
}

async function generateChatReply(
  ai: GoogleGenAI,
  contents: ChatContentTurn[],
  systemInstruction: string,
  thinkingDepth?: 'low' | 'high'
): Promise<{ text: string; finishReason?: string; modelUsed: string }> {
  const complex = isComplexPrompt(contents);
  const attempts = buildChatAttempts(thinkingDepth, complex);

  let lastError: unknown;
  for (const attempt of attempts) {
    if (attempt.delayMs > 0) {
      await new Promise((r) => setTimeout(r, attempt.delayMs));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('TimeoutError: Attempt exceeded limit')), attempt.inactivityTimeoutMs + 25000);

    try {
      const response = await ai.models.generateContent({
        model: attempt.model,
        contents,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: attempt.thinkingLevel },
          abortSignal: controller.signal,
        },
      });

      const extracted = extractGeminiText(response);
      if (extracted) {
        return {
          text: extracted,
          finishReason: response.candidates?.[0]?.finishReason,
          modelUsed: attempt.model,
        };
      }

      lastError = new Error(
        `EMPTY_REPLY:${response.candidates?.[0]?.finishReason || 'UNKNOWN'}`
      );
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err)) {
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

interface AuthedRequest extends Request {
  uid?: string;
}

const authTokenCache = new Map<string, { uid: string; expiresAt: number }>();

function getJwtExpMs(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf-8');
    const payload = JSON.parse(payloadJson) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function requireFirebaseAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'يجب تسجيل الدخول أولاً للوصول إلى خدمات Nova AI.' });
      return;
    }

    const idToken = authHeader.slice('Bearer '.length).trim();
    if (!idToken) {
      res.status(401).json({ error: 'رمز التحقق غير صالح.' });
      return;
    }

    const now = Date.now();
    const cached = authTokenCache.get(idToken);
    if (cached && cached.expiresAt > now) {
      req.uid = cached.uid;
      next();
      return;
    }
    if (cached) {
      authTokenCache.delete(idToken);
    }

    if (!firebaseConfig?.apiKey) {
      res.status(500).json({ error: 'إعدادات المصادقة غير مكتملة على الخادم.' });
      return;
    }

    const lookupRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!lookupRes.ok) {
      res.status(401).json({ error: 'انتهت صلاحية الجلسة أو تعذر التحقق من الهوية. يرجى إعادة تسجيل الدخول.' });
      return;
    }

    const data = (await lookupRes.json()) as { users?: Array<{ localId?: string }> };
    const user = data.users?.[0];
    if (!user?.localId) {
      res.status(401).json({ error: 'تعذر التحقق من هوية المستخدم.' });
      return;
    }

    const jwtExpMs = getJwtExpMs(idToken);
    const cacheUntil = jwtExpMs
      ? Math.min(now + 5 * 60_000, jwtExpMs - 30_000)
      : now + 5 * 60_000;

    if (cacheUntil > now) {
      if (authTokenCache.size >= 500) {
        const oldestKey = authTokenCache.keys().next().value;
        if (oldestKey) authTokenCache.delete(oldestKey);
      }
      authTokenCache.set(idToken, { uid: user.localId, expiresAt: cacheUntil });
    }

    req.uid = user.localId;
    next();
  } catch (err) {
    console.error('Auth verification error:', err);
    res.status(401).json({ error: 'فشل التحقق من جلسة المستخدم.' });
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'Nova AI',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    });
  });

  // 1. Fast & Resilient Arabic Chat Endpoint (Supports NDJSON Streaming + JSON)
  app.post('/api/nova/chat', requireFirebaseAuth, async (req: AuthedRequest, res: Response) => {
    let isStreamingStarted = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const cleanupHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    try {
      const { messages, customInstruction, thinkingDepth, stream } = req.body as {
        messages?: Array<{
          role: 'user' | 'assistant';
          content: string;
          attachment?: { data: string; mimeType: string };
        }>;
        customInstruction?: string;
        thinkingDepth?: 'low' | 'high';
        stream?: boolean;
      };

      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'يرجى كتابة رسالة صالحة قبل الإرسال.' });
        return;
      }

      const ai = getAiClient();

      const baseInstruction = [
        'أنت Nova AI، مساعد ذكاء اصطناعي شخصي ذكي ومتطور.',
        'التزم بالرد دائمًا باللغة العربية الفصحى الواضحة والأنيقة على كل رسالة يرسلها المستخدم، وافهم طلبه بدقة ونفّذه مباشرة دون حشو أو مقدمات مكررة.',
        'في الأسئلة الصعبة أو العلمية أو البرمجية المعقدة، قدّم حلاً دقيقًا ومفصلًا ومنظمًا بخطوات واضحة وأمثلة أو أكواد عملية عند الحاجة.',
        customInstruction?.trim()
          ? `\nتعليمات المستخدم الشخصية المخصصة:\n${customInstruction.trim()}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      // Normalize contents and merge consecutive same-role turns cleanly
      const rawContents = messages
        .filter((m) => typeof m.content === 'string' && m.content.trim().length > 0)
        .map((msg) => {
          const parts: ChatContentPart[] = [];
          if (msg.attachment?.data && msg.attachment?.mimeType) {
            parts.push({
              inlineData: {
                data: msg.attachment.data,
                mimeType: msg.attachment.mimeType,
              },
            });
          }
          parts.push({ text: msg.content.trim() });
          return {
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts,
          };
        });

      const contents: ChatContentTurn[] = [];
      for (const turn of rawContents) {
        const prev = contents[contents.length - 1];
        if (prev && prev.role === turn.role) {
          prev.parts.push(...turn.parts);
        } else {
          contents.push(turn);
        }
      }

      if (contents.length === 0) {
        res.status(400).json({ error: 'يرجى كتابة رسالة صالحة قبل الإرسال.' });
        return;
      }

      // Non-streaming compatibility path
      if (!stream) {
        const result = await generateChatReply(ai, contents, baseInstruction, thinkingDepth);
        if (!result.text) {
          res.status(502).json({
            error: result.finishReason
              ? `لم يتمكن النموذج من إكمال الرد (السبب: ${result.finishReason}). يرجى إعادة صياغة رسالتك.`
              : 'أرجع نموذج Gemini ردًا فارغًا. يرجى المحاولة مرة أخرى.',
          });
          return;
        }
        res.json({ reply: result.text, model: result.modelUsed });
        return;
      }

      // Streaming NDJSON path for low first-token latency & zero proxy timeouts on hard questions
      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      isStreamingStarted = true;

      let clientDisconnected = false;
      let activeAbortController: AbortController | null = null;

      res.on('close', () => {
        if (!res.writableEnded) {
          clientDisconnected = true;
          cleanupHeartbeat();
          activeAbortController?.abort();
        }
      });

      const writeEvent = (payload: Record<string, unknown>) => {
        if (clientDisconnected || res.writableEnded) return;
        res.write(`${JSON.stringify(payload)}\n`);
      };

      const complex = isComplexPrompt(contents);
      const attempts = buildChatAttempts(thinkingDepth, complex);

      writeEvent({ type: 'status', phase: complex || thinkingDepth === 'high' ? 'thinking' : 'generating' });

      heartbeatTimer = setInterval(() => {
        writeEvent({ type: 'ping' });
      }, 3000);

      let lastError: unknown = null;
      let lastFinishReason: string | undefined;

      for (let i = 0; i < attempts.length; i++) {
        if (clientDisconnected) return;
        const attempt = attempts[i];

        if (i > 0) {
          writeEvent({ type: 'status', phase: 'retrying' });
        }
        if (attempt.delayMs > 0) {
          await new Promise((r) => setTimeout(r, attempt.delayMs));
        }
        if (clientDisconnected) return;

        const attemptController = new AbortController();
        activeAbortController = attemptController;
        let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
        const resetInactivityTimer = () => {
          if (inactivityTimer) clearTimeout(inactivityTimer);
          inactivityTimer = setTimeout(() => {
            attemptController.abort(new Error('TimeoutError: Stream chunk inactivity timeout'));
          }, attempt.inactivityTimeoutMs);
        };

        let accumulatedText = '';
        let sentThinkingHint = false;

        try {
          resetInactivityTimer();
          const responseStream = await ai.models.generateContentStream({
            model: attempt.model,
            contents,
            config: {
              systemInstruction: baseInstruction,
              thinkingConfig: { thinkingLevel: attempt.thinkingLevel },
              abortSignal: attemptController.signal,
            },
          });

          for await (const chunk of responseStream) {
            if (clientDisconnected) break;
            resetInactivityTimer();

            const { delta, hasThought, finishReason } = extractStreamChunkInfo(chunk);
            if (finishReason) {
              lastFinishReason = finishReason;
            }
            if (hasThought && !accumulatedText && !sentThinkingHint) {
              sentThinkingHint = true;
              writeEvent({ type: 'status', phase: 'thinking' });
            }
            if (delta) {
              accumulatedText += delta;
              writeEvent({ type: 'delta', text: delta });
            }
          }

          if (clientDisconnected) return;

          const trimmed = accumulatedText.trim();
          if (trimmed.length > 0) {
            cleanupHeartbeat();
            writeEvent({ type: 'done', reply: trimmed, model: attempt.model });
            res.end();
            return;
          }

          lastError = new Error(`EMPTY_REPLY:${lastFinishReason || 'UNKNOWN'}`);
        } catch (err) {
          if (clientDisconnected) return;

          // If substantial text was already streamed before an upstream close, finalize it gracefully
          const partial = accumulatedText.trim();
          if (partial.length > 0) {
            cleanupHeartbeat();
            writeEvent({ type: 'done', reply: partial, model: attempt.model });
            res.end();
            return;
          }

          lastError = err;
          if (!isRetryableError(err)) {
            throw err;
          }
        } finally {
          if (inactivityTimer) clearTimeout(inactivityTimer);
          activeAbortController = null;
        }
      }

      throw lastError ?? new Error('EMPTY_REPLY:UNKNOWN');
    } catch (err) {
      cleanupHeartbeat();
      console.error('[Nova AI Chat Error]:', err);
      const mapped = mapGeminiError(err);
      if (isStreamingStarted) {
        if (!res.writableEnded) {
          res.write(`${JSON.stringify({ type: 'error', error: mapped.message, requiresPaidKey: mapped.requiresPaidKey })}\n`);
          res.end();
        }
      } else {
        res.status(mapped.status).json({ error: mapped.message, requiresPaidKey: mapped.requiresPaidKey });
      }
    }
  });

  // 2. Automatic AI Triage for Contact Us Messages
  app.post('/api/nova/contact-triage', requireFirebaseAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const { senderName, category = 'general', message } = req.body as {
        senderName?: string;
        category?: 'issue' | 'suggestion' | 'general';
        message?: string;
      };

      if (!message || typeof message !== 'string' || message.trim().length < 5) {
        res.status(400).json({ error: 'محتوى الرسالة قصير جدًا للتحليل.' });
        return;
      }

      const ai = getAiClient();
      const categoryLabel =
        category === 'issue' ? 'مشكلة تقنية' : category === 'suggestion' ? 'اقتراح تطوير' : 'استفسار عام';

      const systemInstruction = [
        'أنت محلل الدعم الفني والرد الذكي في منصة Nova AI.',
        'قم بتحليل رسالة المستخدم المرسلة من صفحة "تواصل معنا" وأعد النتيجة بصيغة JSON مطابقة للمخطط.',
        'قواعد التصنيف:',
        '- اختر "simple" إذا كانت الرسالة سؤالاً عن طريقة استخدام Nova AI أو استفساراً بسيطاً أو اقتراحاً عادياً أو مشكلة خفيفة يمكن إرشاد المستخدم لحلها فوراً. في حقل reply قدّم إجابة عربية مهذبة، واضحة، وعملية تساعد المستخدم مباشرة.',
        '- اختر "urgent" إذا كانت الرسالة تتضمن مشكلة تقنية كبيرة أو عطلاً فعلياً أو خطأً في النظام أو فقدان بيانات أو مشكلة في الحساب/تسجيل الدخول أو شكوى جدية تتطلب تدخل مطور الموقع. في حقل reply قدّم رداً عربياً مهذباً يوضح للمستخدم أن رسالته صُنفت كرسالة عاجلة ووصلت مباشرة إلى مطور الموقع للمراجعة العاجلة.',
        'مزايا التطبيق الحالية لمساعدتك في الإجابة: يدعم Nova AI المحادثة العربية الذكية (بوضع استجابة سريعة أو تحليل عميق)، وإرفاق الصور في المحادثة لتحليلها، وتخصيص ألوان الواجهة (البنفسجي والأزرق والأخضر والأحمر) والوضع الداكن والفاتح وتغيير الحساب وقفل الشاشة السريع من صفحة الإعدادات، وصفحات من نحن والمساعدة والأسئلة الشائعة وتواصل معنا.',
      ].join('\n');

      const userPrompt = [
        `اسم المرسل: ${(senderName || 'مستخدم').trim()}`,
        `التصنيف المختار: ${categoryLabel}`,
        `نص الرسالة:\n${message.trim()}`,
      ].join('\n');

      const attempts: Array<{ model: string; delayMs: number }> = [
        { model: 'gemini-3.1-flash-lite', delayMs: 0 },
        { model: 'gemini-3.1-flash-lite', delayMs: 600 },
        { model: 'gemini-4-hydrogen', delayMs: 400 },
      ];

      let lastError: unknown;
      for (const attempt of attempts) {
        if (attempt.delayMs > 0) {
          await new Promise((r) => setTimeout(r, attempt.delayMs));
        }
        try {
          const response = await ai.models.generateContent({
            model: attempt.model,
            contents: userPrompt,
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  classification: {
                    type: Type.STRING,
                    enum: ['simple', 'urgent'],
                  },
                  reply: {
                    type: Type.STRING,
                  },
                  summary: {
                    type: Type.STRING,
                  },
                },
                required: ['classification', 'reply', 'summary'],
              },
            },
          });

          const rawText = extractGeminiText(response);
          if (!rawText) {
            lastError = new Error('EMPTY_TRIAGE_REPLY');
            continue;
          }

          const parsed = JSON.parse(rawText) as {
            classification?: string;
            reply?: string;
            summary?: string;
          };

          const classification = parsed.classification === 'urgent' ? 'urgent' : 'simple';
          const reply = (parsed.reply || '').trim();
          const summary = (parsed.summary || '').trim();

          if (!reply) {
            lastError = new Error('EMPTY_TRIAGE_REPLY_FIELD');
            continue;
          }

          res.json({
            classification,
            reply: reply.slice(0, 4000),
            summary: (summary || message.trim().slice(0, 120)).slice(0, 500),
            model: attempt.model,
          });
          return;
        } catch (err) {
          lastError = err;
          const msg = err instanceof Error ? err.message : String(err);
          const isTransient =
            msg.includes('503') ||
            msg.includes('UNAVAILABLE') ||
            msg.includes('500') ||
            msg.includes('SyntaxError') ||
            msg.includes('JSON');
          if (!isTransient) {
            throw err;
          }
        }
      }

      throw lastError;
    } catch (err) {
      console.error('[Nova AI Contact Triage Error]:', err);
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message, requiresPaidKey: mapped.requiresPaidKey });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Nova AI server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
