import http from 'http';
import type { IncomingMessage } from 'http';
import crypto from 'crypto';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { GoogleGenAI, Modality, ThinkingLevel, Type } from '@google/genai';
import type { FunctionDeclaration, LiveServerMessage } from '@google/genai';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import {
  OTP_CHALLENGE_COOKIE_NAME,
  OTP_CHALLENGE_TTL_MS,
  OTP_COOKIE_NAME,
  OTP_LOCKOUT_MS,
  OTP_MAX_ATTEMPTS,
  OTP_TRUSTED_DEVICE_DAYS,
  OTP_TRUSTED_DEVICE_MAX_AGE_SEC,
  OTP_TRUSTED_DEVICE_TTL_MS,
  computeDeviceFingerprint,
  deriveOtpSigningSecret,
  extractValidDeviceIdForLogout,
  hashOtpCodeWithSecret,
  issueShortSessionToken,
  issueTrustedDeviceToken,
  signOtpChallengeCookie,
  timingSafeEqualStr,
  verifyOtpChallengeCookie,
  verifyTrustedOrSessionToken,
} from './otpTrust.ts';
import { cleanTextForSpeech, splitArabicSpeechSentences } from './speechUtils.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const firebaseConfigPath =
  [
    path.resolve(__dirname, 'firebase-applet-config.json'),
    path.resolve(__dirname, '..', 'firebase-applet-config.json'),
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
  ].find((candidate) => fs.existsSync(candidate)) || path.resolve(__dirname, 'firebase-applet-config.json');
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

export interface ExtractedFunctionCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

function extractStreamChunkInfo(chunk: {
  text?: string;
  functionCalls?: Array<{ name?: string; args?: Record<string, unknown>; id?: string }>;
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{
        text?: string;
        thought?: boolean;
        functionCall?: { name?: string; args?: Record<string, unknown>; id?: string };
      }>;
    };
  }>;
}): { delta: string; hasThought: boolean; finishReason?: string; functionCall?: ExtractedFunctionCall } {
  const candidate = chunk.candidates?.[0];
  const parts = candidate?.content?.parts;
  let hasThought = false;
  let delta = '';
  let functionCall: ExtractedFunctionCall | undefined;

  if (Array.isArray(parts) && parts.length > 0) {
    for (const part of parts) {
      if (part.thought) {
        hasThought = true;
      } else if (part.functionCall && typeof part.functionCall.name === 'string' && !functionCall) {
        functionCall = {
          name: part.functionCall.name,
          args:
            part.functionCall.args && typeof part.functionCall.args === 'object'
              ? part.functionCall.args
              : {},
          id: part.functionCall.id,
        };
      } else if (typeof part.text === 'string' && part.text.length > 0) {
        delta += part.text;
      }
    }
  } else if (typeof chunk.text === 'string' && chunk.text.length > 0) {
    delta = chunk.text;
  }

  if (!functionCall && Array.isArray(chunk.functionCalls) && chunk.functionCalls.length > 0) {
    const fc = chunk.functionCalls[0];
    if (fc && typeof fc.name === 'string') {
      functionCall = {
        name: fc.name,
        args: fc.args && typeof fc.args === 'object' ? fc.args : {},
        id: fc.id,
      };
    }
  }

  return {
    delta,
    hasThought,
    finishReason: candidate?.finishReason,
    functionCall,
  };
}

const NOVA_CHAT_TOOLS: FunctionDeclaration[] = [
  {
    name: 'create_presentation',
    description:
      'ينشئ عرضًا تقديميًا متكاملًا بصيغتي PowerPoint وPDF. استخدم هذه الأداة فقط عندما يطلب المستخدم عرضًا تقديميًا أو شرائح أو باوربوينت ويكون موضوع العرض واضحًا في رسالته أو سياق المحادثة.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: {
          type: Type.STRING,
          description: 'موضوع العرض التقديمي الرئيسي بدقة كما طلبه المستخدم.',
        },
        details: {
          type: Type.STRING,
          description: 'تفاصيل أو محاور أو نقاط إضافية طلبها المستخدم للعرض (اختياري).',
        },
        slideCount: {
          type: Type.INTEGER,
          description: 'عدد الشرائح المطلوب من 3 إلى 12 (الافتراضي 6 إذا لم يُحدد).',
        },
        audience: {
          type: Type.STRING,
          description: 'الجمهور المستهدف مثل: طلاب، معلمون، تنفيذي، عام.',
        },
        language: {
          type: Type.STRING,
          description: 'لغة شرائح العرض: ar للعربية أو en للإنجليزية.',
          enum: ['ar', 'en'],
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'create_exam',
    description:
      'ينشئ اختبارًا مدرسيًا بأربعة خيارات ثابتة لكل سؤال. استخدم هذه الأداة فقط عندما يطلب المستخدم اختبارًا أو امتحانًا أو كويز وتتوفر المادة/الصف واسم الدرس (أو نص/صورة الدرس في الرسالة). لا تخمّن مادة أو درسًا غير مذكور.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        subjectGrade: {
          type: Type.STRING,
          description: 'المادة والصف الدراسي (مثال: العلوم - الصف السادس، أو "من المحتوى المرفق" إذا أرفق المستخدم نصًا أو صورة).',
        },
        lessonOrPages: {
          type: Type.STRING,
          description: 'اسم الدرس أو الوحدة أو أرقام الصفحات المطلوب الاختبار فيها.',
        },
        curriculum: {
          type: Type.STRING,
          description: 'اسم المنهج الدراسي إذا ذكره المستخدم (مثل: العُمانية، السعودية، المصرية).',
        },
        lessonContent: {
          type: Type.STRING,
          description: 'نص الدرس إذا لصقه المستخدم داخل رسالته لصياغة الأسئلة منه.',
        },
        questionCount: {
          type: Type.INTEGER,
          description: 'عدد أسئلة الاختبار من 3 إلى 25 (الافتراضي 5 إذا لم يُحدد).',
        },
        difficulty: {
          type: Type.STRING,
          description: 'مستوى الصعوبة المطلوب.',
          enum: ['mixed', 'easy', 'medium', 'hard'],
        },
        useAttachedImage: {
          type: Type.BOOLEAN,
          description: 'true إذا كان المستخدم قد أرفق صورة صفحة كتاب أو درس ليُبنى الاختبار منها.',
        },
      },
      required: ['subjectGrade', 'lessonOrPages'],
    },
  },
  {
    name: 'summarize_lesson',
    description:
      'يلخّص درسًا أو نصًا أو صورة صفحة كتاب في نقاط مركزة ومصطلحات رئيسية. استخدم هذه الأداة فقط عندما يطلب المستخدم تلخيص درس أو نص وتتوفر بيانات التلخيص (نص لصقه المستخدم، أو صورة مرفقة، أو اسم درس محدد بوضوح).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        subject: {
          type: Type.STRING,
          description: 'اسم المادة الدراسية إن وُجدت (اختياري).',
        },
        topic: {
          type: Type.STRING,
          description: 'اسم الدرس أو الموضوع المحدد المراد تلخيصه إذا لم يلصق المستخدم نصًا طويلاً.',
        },
        lessonText: {
          type: Type.STRING,
          description: 'نص الدرس الكامل الذي لصقه المستخدم للتلخيص.',
        },
        useAttachedImage: {
          type: Type.BOOLEAN,
          description: 'true إذا أرفق المستخدم صورة الدرس أو السبورة لتلخيصها.',
        },
      },
    },
  },
  {
    name: 'create_flashcards',
    description:
      'يولّد بطاقات مراجعة تفاعلية (سؤال وجواب وتلميح) للمذاكرة السريعة. استخدم هذه الأداة فقط عندما يطلب المستخدم بطاقات مراجعة أو فلاش كاردز وتتوفر مادة البطاقات (نص الدرس، أو صورة مرفقة، أو اسم درس واضح).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        subject: {
          type: Type.STRING,
          description: 'اسم المادة أو عنوان المجموعة (اختياري).',
        },
        topic: {
          type: Type.STRING,
          description: 'اسم الدرس أو الموضوع المطلوب إنشاء بطاقات مراجعة له.',
        },
        lessonText: {
          type: Type.STRING,
          description: 'نص الدرس المرفق من المستخدم لاستخراج البطاقات منه.',
        },
        count: {
          type: Type.INTEGER,
          description: 'عدد البطاقات المطلوب من 4 إلى 15 (الافتراضي 8).',
        },
        useAttachedImage: {
          type: Type.BOOLEAN,
          description: 'true إذا أرفق المستخدم صورة درس لإنشاء البطاقات منها.',
        },
      },
    },
  },
];

export type NormalizedChatToolIntent =
  | {
      valid: true;
      tool: 'create_presentation' | 'create_exam' | 'summarize_lesson' | 'create_flashcards';
      params: Record<string, unknown>;
    }
  | {
      valid: false;
      clarification: string;
    };

export function normalizeChatToolCall(
  call: ExtractedFunctionCall,
  options: { hasImageInLatestTurn: boolean; latestUserText: string }
): NormalizedChatToolIntent {
  const args = call.args || {};

  if (call.name === 'create_presentation') {
    const topic = sanitizeTextInput(String(args.topic ?? ''), 240, false);
    if (topic.length < 3 || /^(غير محدد|موضوع|عرض|null|undefined)$/i.test(topic)) {
      return {
        valid: false,
        clarification: 'ما موضوع العرض التقديمي الذي تريد إنشاءه، وكم شريحة تفضّل؟',
      };
    }
    const details = sanitizeTextInput(String(args.details ?? ''), 4000);
    const audience = sanitizeTextInput(String(args.audience ?? ''), 120, false) || 'عام';
    const rawSlides = Number(args.slideCount);
    const slideCount = Number.isFinite(rawSlides) ? Math.min(12, Math.max(3, Math.round(rawSlides))) : 6;
    const language = args.language === 'en' ? 'en' : 'ar';
    return {
      valid: true,
      tool: 'create_presentation',
      params: { topic, details, slideCount, audience, language },
    };
  }

  if (call.name === 'create_exam') {
    const lessonContent = sanitizeTextInput(String(args.lessonContent ?? ''), 8000);
    const useAttachedImage = Boolean(args.useAttachedImage) && options.hasImageInLatestTurn;
    const subjectGrade =
      sanitizeTextInput(String(args.subjectGrade ?? ''), 180, false) ||
      (lessonContent.length >= 40 || useAttachedImage ? 'من المحتوى المرفق' : '');
    const lessonOrPages =
      sanitizeTextInput(String(args.lessonOrPages ?? ''), 800) ||
      (lessonContent.length >= 40 || useAttachedImage ? 'أسئلة من الدرس المرفق' : '');

    if (
      (subjectGrade.length < 2 || /^(غير محدد|مادة|null|undefined)$/i.test(subjectGrade)) &&
      lessonContent.length < 40 &&
      !useAttachedImage
    ) {
      return {
        valid: false,
        clarification: 'ما المادة والصف الدراسي واسم الدرس الذي تريد الاختبار فيه؟ يمكنك أيضًا لصق نص الدرس أو إرفاق صورته.',
      };
    }
    if (
      (lessonOrPages.length < 2 || /^(غير محدد|درس|null|undefined)$/i.test(lessonOrPages)) &&
      lessonContent.length < 40 &&
      !useAttachedImage
    ) {
      return {
        valid: false,
        clarification: `في أي درس أو صفحات من مادة «${subjectGrade}» تريد إنشاء الاختبار؟`,
      };
    }

    const curriculum = sanitizeTextInput(String(args.curriculum ?? ''), 160, false);
    const rawCount = Number(args.questionCount);
    const questionCount = Number.isFinite(rawCount) ? Math.min(25, Math.max(3, Math.round(rawCount))) : 5;
    const diff = args.difficulty;
    const difficulty = diff === 'easy' || diff === 'medium' || diff === 'hard' ? diff : 'mixed';
    return {
      valid: true,
      tool: 'create_exam',
      params: {
        subjectGrade,
        lessonOrPages,
        curriculum: curriculum || 'المناهج العُمانية (المكتبة الإلكترونية)',
        lessonContent,
        questionCount,
        difficulty,
        useAttachedImage,
      },
    };
  }

  if (call.name === 'summarize_lesson') {
    const subject = sanitizeTextInput(String(args.subject ?? ''), 120, false);
    const topic = sanitizeTextInput(String(args.topic ?? ''), 240, false);
    let lessonText = sanitizeTextInput(String(args.lessonText ?? ''), 20000);
    const useAttachedImage = Boolean(args.useAttachedImage) && options.hasImageInLatestTurn;

    if (!useAttachedImage && lessonText.length < 15 && topic.length < 3) {
      if (options.latestUserText.length >= 60) {
        lessonText = options.latestUserText.slice(0, 20000);
      } else {
        return {
          valid: false,
          clarification: 'أرسل لي نص الدرس أو صوّر صفحته أو اكتب اسم الدرس الذي تريد تلخيصه.',
        };
      }
    }

    return {
      valid: true,
      tool: 'summarize_lesson',
      params: { subject, topic, lessonText, useAttachedImage },
    };
  }

  if (call.name === 'create_flashcards') {
    const subject = sanitizeTextInput(String(args.subject ?? ''), 120, false);
    const topic = sanitizeTextInput(String(args.topic ?? ''), 240, false);
    let lessonText = sanitizeTextInput(String(args.lessonText ?? ''), 20000);
    const useAttachedImage = Boolean(args.useAttachedImage) && options.hasImageInLatestTurn;
    const rawCount = Number(args.count);
    const count = Number.isFinite(rawCount) ? Math.min(15, Math.max(4, Math.round(rawCount))) : 8;

    if (!useAttachedImage && lessonText.length < 15 && topic.length < 3) {
      if (options.latestUserText.length >= 60) {
        lessonText = options.latestUserText.slice(0, 20000);
      } else {
        return {
          valid: false,
          clarification: 'ما الدرس أو النص الذي تريد إنشاء بطاقات مراجعة له؟ يمكنك كتابة اسم الدرس أو لصق النص أو إرفاق صورة.',
        };
      }
    }

    return {
      valid: true,
      tool: 'create_flashcards',
      params: { subject, topic, lessonText, count, useAttachedImage },
    };
  }

  return {
    valid: false,
    clarification: 'هل يمكنك توضيح طلبك أكثر؟ يمكنني الدردشة معك أو إنشاء عرض تقديمي أو اختبار أو ملخص درس أو بطاقات مراجعة.',
  };
}

type ChatContentPart = { text?: string; inlineData?: { data: string; mimeType: string } };
type ChatContentTurn = { role: string; parts: ChatContentPart[] };
type ChatAttempt = {
  model: string;
  thinkingLevel: ThinkingLevel;
  delayMs: number;
  firstTokenTimeoutMs: number;
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

  if (hasImage || text.length >= 220) {
    return true;
  }

  const hardKeywords =
    /(اشرح بالتفصيل|برهن|أثبت|معادلة|خوارزمية|خطأ برمجي|مسألة|تفاضل|تكامل|معمارية|debug|prove|algorithm|architecture|calculus|equation|theorem)/i;
  const symbolHint = /[{}=^√∫∑]|```/;

  return hardKeywords.test(text) || symbolHint.test(text);
}

function buildChatAttempts(thinkingDepth: 'low' | 'high' | undefined, hasImage = false): ChatAttempt[] {
  if (hasImage) {
    return [
      {
        model: 'gemini-4-hydrogen',
        thinkingLevel: ThinkingLevel.LOW,
        delayMs: 0,
        firstTokenTimeoutMs: 16000,
        inactivityTimeoutMs: 45000,
      },
      {
        model: 'gemini-3.1-flash-lite',
        thinkingLevel: ThinkingLevel.MEDIUM,
        delayMs: 0,
        firstTokenTimeoutMs: 14000,
        inactivityTimeoutMs: 40000,
      },
      {
        model: 'gemini-4-hydrogen',
        thinkingLevel: ThinkingLevel.MEDIUM,
        delayMs: 0,
        firstTokenTimeoutMs: 20000,
        inactivityTimeoutMs: 45000,
      },
    ];
  }

  if (thinkingDepth === 'high') {
    return [
      {
        model: 'gemini-4-hydrogen',
        thinkingLevel: ThinkingLevel.LOW,
        delayMs: 0,
        firstTokenTimeoutMs: 14000,
        inactivityTimeoutMs: 45000,
      },
      {
        model: 'gemini-3.1-flash-lite',
        thinkingLevel: ThinkingLevel.MEDIUM,
        delayMs: 0,
        firstTokenTimeoutMs: 12000,
        inactivityTimeoutMs: 40000,
      },
      {
        model: 'gemini-4-hydrogen',
        thinkingLevel: ThinkingLevel.MEDIUM,
        delayMs: 0,
        firstTokenTimeoutMs: 18000,
        inactivityTimeoutMs: 45000,
      },
    ];
  }

  return [
    {
      model: 'gemini-3.1-flash-lite',
      thinkingLevel: ThinkingLevel.MINIMAL,
      delayMs: 0,
      firstTokenTimeoutMs: 9000,
      inactivityTimeoutMs: 30000,
    },
    {
      model: 'gemini-4-hydrogen',
      thinkingLevel: ThinkingLevel.LOW,
      delayMs: 0,
      firstTokenTimeoutMs: 14000,
      inactivityTimeoutMs: 40000,
    },
    {
      model: 'gemini-3.1-flash-lite',
      thinkingLevel: ThinkingLevel.LOW,
      delayMs: 0,
      firstTokenTimeoutMs: 12000,
      inactivityTimeoutMs: 35000,
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
  thinkingDepth?: 'low' | 'high',
  hasImage = false
): Promise<{ text: string; finishReason?: string; modelUsed: string }> {
  const attempts = buildChatAttempts(thinkingDepth, hasImage);

  let lastError: unknown;
  for (const attempt of attempts) {
    if (attempt.delayMs > 0) {
      await new Promise((r) => setTimeout(r, attempt.delayMs));
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('TimeoutError: Attempt exceeded limit')),
      attempt.inactivityTimeoutMs + 15000
    );

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
  userEmail?: string;
  authTime?: number;
}

const OWNER_ADMIN_EMAIL = 'amjad.alqasmi67@gmail.com';
const OTP_SIGNING_SECRET = deriveOtpSigningSecret(
  process.env,
  typeof firebaseConfig?.projectId === 'string' ? firebaseConfig.projectId : undefined
);

const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;

function sanitizeTextInput(raw: unknown, maxLength: number, preserveNewlines = true): string {
  if (typeof raw !== 'string') return '';
  let cleaned = raw.replace(CONTROL_CHARS_RE, '');
  if (!preserveNewlines) {
    cleaned = cleaned.replace(/[\r\n\t]+/g, ' ');
  }
  return cleaned.trim().slice(0, maxLength);
}

function isSafeExternalUrl(rawUrl: string): string | null {
  const cleaned = sanitizeTextInput(rawUrl, 1000, false);
  if (!cleaned) return null;
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase();
    const isPrivateHost =
      host === 'localhost' ||
      host === '::1' ||
      host === '[::1]' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    if (isPrivateHost) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

const authTokenCache = new Map<string, { uid: string; email: string; authTime: number; expiresAt: number }>();

function getJwtClaims(token: string): { expMs: number | null; authTime: number } {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { expMs: null, authTime: 0 };
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf-8');
    const payload = JSON.parse(payloadJson) as { exp?: number; auth_time?: number };
    return {
      expMs: typeof payload.exp === 'number' ? payload.exp * 1000 : null,
      authTime: typeof payload.auth_time === 'number' && Number.isFinite(payload.auth_time) ? payload.auth_time : 0,
    };
  } catch {
    return { expMs: null, authTime: 0 };
  }
}

async function verifyFirebaseIdToken(
  idToken: string
): Promise<{ uid: string; email: string; authTime: number } | null> {
  if (!idToken || idToken.length < 50 || idToken.length > 4096) return null;
  if (!/^[A-Za-z0-9_.\-]+$/.test(idToken) || idToken.split('.').length !== 3) return null;

  const now = Date.now();
  const cached = authTokenCache.get(idToken);
  if (cached && cached.expiresAt > now) {
    return { uid: cached.uid, email: cached.email, authTime: cached.authTime };
  }
  if (cached) {
    authTokenCache.delete(idToken);
  }

  if (!firebaseConfig?.apiKey) {
    throw new Error('MISSING_FIREBASE_CONFIG');
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
    return null;
  }

  const data = (await lookupRes.json()) as {
    users?: Array<{ localId?: string; email?: string; emailVerified?: boolean; disabled?: boolean }>;
  };
  const account = data.users?.[0];
  const uid = account?.localId;
  const email = account?.email?.trim() || '';
  if (!uid || !email || account?.disabled === true || account?.emailVerified !== true) {
    return null;
  }

  const { expMs: jwtExpMs, authTime } = getJwtClaims(idToken);
  const cacheUntil = jwtExpMs
    ? Math.min(now + 5 * 60_000, jwtExpMs - 30_000)
    : now + 5 * 60_000;

  if (cacheUntil > now) {
    if (authTokenCache.size >= 500) {
      const oldestKey = authTokenCache.keys().next().value;
      if (oldestKey) authTokenCache.delete(oldestKey);
    }
    authTokenCache.set(idToken, { uid, email, authTime, expiresAt: cacheUntil });
  }

  return { uid, email, authTime };
}

// --- Multi-Layer Security Firewall, Suspicious Activity Shield & Gmail OTP 2FA ---
interface RateWindow {
  timestamps: number[];
  blockedUntil: number;
}

interface SecurityEventEntry {
  id: string;
  type:
    | 'scanner_probe'
    | 'traversal_block'
    | 'csrf_origin_block'
    | 'prototype_pollution_block'
    | 'auth_ban'
    | 'otp_lockout'
    | 'rate_limit_block';
  maskedIp: string;
  path: string;
  timestamp: number;
}

interface OtpChallengeRecord {
  cid: string;
  salt: string;
  codeHash: string;
  expiresAt: number;
  lastSentAt: number;
  failedAttempts: number;
  lockedUntil: number;
  requestHistory: number[];
}

const ipApiWindows = new Map<string, RateWindow>();
const userAuthWindows = new Map<string, RateWindow>();
const userAiMinuteWindows = new Map<string, RateWindow>();
const userAiHourlyWindows = new Map<string, RateWindow>();
const userStudioBurstWindows = new Map<string, RateWindow>();
const authFailWindows = new Map<string, RateWindow>();
const suspicionProbeWindows = new Map<string, RateWindow>();
const wsActiveByIp = new Map<string, number>();
const wsActiveByUid = new Map<string, number>();
const otpChallenges = new Map<string, OtpChallengeRecord>();
const verifiedAuthSessions = new Map<string, { expiresAt: number; deviceId: string }>();
const revokedDeviceIds = new Map<string, number>();
const consumedChallengeIds = new Map<string, number>();
const securityEvents: SecurityEventEntry[] = [];

setInterval(() => {
  const now = Date.now();
  const shortCutoff = now - 15 * 60_000;
  for (const store of [
    ipApiWindows,
    userAuthWindows,
    userAiMinuteWindows,
    userStudioBurstWindows,
    authFailWindows,
    suspicionProbeWindows,
  ]) {
    for (const [key, entry] of store.entries()) {
      entry.timestamps = entry.timestamps.filter((t) => t > shortCutoff);
      if (entry.timestamps.length === 0 && entry.blockedUntil < now) {
        store.delete(key);
      }
    }
  }
  const hourCutoff = now - 60 * 60_000;
  for (const [key, entry] of userAiHourlyWindows.entries()) {
    entry.timestamps = entry.timestamps.filter((t) => t > hourCutoff);
    if (entry.timestamps.length === 0 && entry.blockedUntil < now) {
      userAiHourlyWindows.delete(key);
    }
  }
  for (const [uid, rec] of otpChallenges.entries()) {
    if (rec.expiresAt < now && rec.lockedUntil < now && rec.requestHistory.every((t) => now - t > 60 * 60_000)) {
      otpChallenges.delete(uid);
    }
  }
  for (const [k, entry] of verifiedAuthSessions.entries()) {
    if (entry.expiresAt < now) {
      verifiedAuthSessions.delete(k);
    }
  }
  for (const [did, exp] of revokedDeviceIds.entries()) {
    if (exp < now) {
      revokedDeviceIds.delete(did);
    }
  }
  for (const [cid, exp] of consumedChallengeIds.entries()) {
    if (exp < now) {
      consumedChallengeIds.delete(cid);
    }
  }
}, 5 * 60_000).unref();

function getClientIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim().length > 0) {
    return xff.split(',')[0].trim();
  }
  if (Array.isArray(xff) && xff.length > 0) {
    return xff[0].split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function maskIpForLog(ip: string): string {
  if (!ip || ip === 'unknown') return 'unknown';
  if (ip.includes('.')) {
    const parts = ip.split('.');
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : 'ipv4-masked';
  }
  return `${ip.slice(0, 8)}:xxxx`;
}

function recordSecurityEvent(type: SecurityEventEntry['type'], ip: string, reqPath: string): void {
  securityEvents.unshift({
    id: crypto.randomUUID(),
    type,
    maskedIp: maskIpForLog(ip),
    path: String(reqPath || '/').slice(0, 120),
    timestamp: Date.now(),
  });
  if (securityEvents.length > 100) {
    securityEvents.length = 100;
  }
}

function consumeRateQuota(
  store: Map<string, RateWindow>,
  key: string,
  limit: number,
  windowMs: number,
  banMs = 0
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [], blockedUntil: 0 };
    store.set(key, entry);
  }
  if (entry.blockedUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.blockedUntil - now) / 1000) };
  }
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
  if (entry.timestamps.length >= limit) {
    if (banMs > 0) {
      entry.blockedUntil = now + banMs;
    }
    const oldest = entry.timestamps[0] ?? now;
    const waitMs = banMs > 0 ? banMs : Math.max(1000, windowMs - (now - oldest));
    return { allowed: false, retryAfterSec: Math.ceil(waitMs / 1000) };
  }
  entry.timestamps.push(now);
  return { allowed: true, retryAfterSec: 0 };
}

function recordAuthFailure(ip: string, reqPath = '/api'): boolean {
  const now = Date.now();
  let entry = authFailWindows.get(ip);
  if (!entry) {
    entry = { timestamps: [], blockedUntil: 0 };
    authFailWindows.set(ip, entry);
  }
  entry.timestamps = entry.timestamps.filter((t) => now - t < 5 * 60_000);
  entry.timestamps.push(now);
  if (entry.timestamps.length >= 15) {
    entry.blockedUntil = now + 5 * 60_000;
    recordSecurityEvent('auth_ban', ip, reqPath);
    return true;
  }
  return false;
}

function recordSuspiciousProbe(ip: string, reqPath: string): void {
  recordSecurityEvent('scanner_probe', ip, reqPath);
  const now = Date.now();
  let entry = suspicionProbeWindows.get(ip);
  if (!entry) {
    entry = { timestamps: [], blockedUntil: 0 };
    suspicionProbeWindows.set(ip, entry);
  }
  entry.timestamps = entry.timestamps.filter((t) => now - t < 10 * 60_000);
  entry.timestamps.push(now);
  if (entry.timestamps.length >= 3) {
    entry.blockedUntil = now + 15 * 60_000;
  }
}

function isIpTemporarilyBanned(ip: string): number {
  const now = Date.now();
  const authEntry = authFailWindows.get(ip);
  const probeEntry = suspicionProbeWindows.get(ip);
  const authRem = authEntry ? authEntry.blockedUntil - now : 0;
  const probeRem = probeEntry ? probeEntry.blockedUntil - now : 0;
  const maxRem = Math.max(authRem, probeRem);
  return maxRem > 0 ? Math.ceil(maxRem / 1000) : 0;
}

function countActiveBannedIps(): number {
  const now = Date.now();
  const ips = new Set<string>();
  for (const [ip, entry] of authFailWindows.entries()) {
    if (entry.blockedUntil > now) ips.add(ip);
  }
  for (const [ip, entry] of suspicionProbeWindows.entries()) {
    if (entry.blockedUntil > now) ips.add(ip);
  }
  return ips.size;
}

function isTrustedRequestOrigin(headers: IncomingMessage['headers']): boolean {
  const originRaw = typeof headers.origin === 'string' ? headers.origin : '';
  const refererRaw = typeof headers.referer === 'string' ? headers.referer : '';
  const sourceUrl = originRaw || refererRaw;
  if (!sourceUrl) {
    return true;
  }
  try {
    const parsedSource = new URL(sourceUrl);
    if (parsedSource.protocol !== 'https:' && parsedSource.protocol !== 'http:') {
      return false;
    }
    const forwardedHost = typeof headers['x-forwarded-host'] === 'string' ? headers['x-forwarded-host'] : '';
    const hostHeader = (forwardedHost || headers.host || '').split(',')[0].trim().toLowerCase();
    if (!hostHeader) return false;
    const sourceHost = parsedSource.host.toLowerCase();
    if (sourceHost === hostHeader) return true;
    const sourceHostname = parsedSource.hostname.toLowerCase();
    const expectedHostname = hostHeader.split(':')[0];
    if (
      process.env.NODE_ENV !== 'production' &&
      (sourceHostname === 'localhost' || sourceHostname === '127.0.0.1') &&
      (expectedHostname === 'localhost' || expectedHostname === '127.0.0.1')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function hasDangerousKeysOrDepth(value: unknown, depth = 0): boolean {
  if (depth > 12) return true;
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    if (value.length > 500) return true;
    for (const item of value) {
      if (hasDangerousKeysOrDepth(item, depth + 1)) return true;
    }
    return false;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length > 100) return true;
  for (const key of keys) {
    if (DANGEROUS_KEYS.has(key)) return true;
    if (hasDangerousKeysOrDepth(obj[key], depth + 1)) return true;
  }
  return false;
}

function isSuspiciousUrlPath(rawUrl: string): boolean {
  if (!rawUrl || rawUrl.includes('\0') || /%00/i.test(rawUrl)) return true;
  if (/(\.\.[\\/]|%2e%2e[\\/]|%2e%2e%2f|%2e%2e%5c)/i.test(rawUrl)) return true;
  try {
    const decoded = decodeURIComponent(rawUrl);
    if (decoded.includes('\0') || decoded.includes('../') || decoded.includes('..\\')) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

const SUSPICIOUS_PROBE_PATH_RE =
  /^\/(\.env|\.git|\.svn|\.hg|\.htaccess|\.DS_Store|wp-admin|wp-login|wp-content|phpmyadmin|pma|adminer|xmlrpc\.php|actuator|cgi-bin|server-status|config\.php)/i;
const SUSPICIOUS_QUERY_RE = /(\bunion\s+select\b|\bdrop\s+table\b|<script\b|javascript:|onerror\s*=|onload\s*=)/i;
const SCANNER_UA_RE = /(sqlmap|nikto|nmap|masscan|dirbuster|gobuster|wpscan|nuclei|acunetix|nessus|zgrab)/i;

function isSuspiciousProbeOrBot(req: IncomingMessage): boolean {
  const url = req.url || '/';
  const pathname = url.split('?')[0] || '/';
  let decodedUrl = url;
  try {
    decodedUrl = decodeURIComponent(url.replace(/\+/g, ' '));
  } catch {
    decodedUrl = url.replace(/\+/g, ' ');
  }
  const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';
  if (SUSPICIOUS_PROBE_PATH_RE.test(pathname)) return true;
  if (SUSPICIOUS_QUERY_RE.test(url) || SUSPICIOUS_QUERY_RE.test(decodedUrl)) return true;
  if (SCANNER_UA_RE.test(ua)) return true;
  return false;
}

// --- Gmail / Email OTP 2FA Helpers ---
function extractValidFromAddress(raw: string | undefined): string | null {
  const val = (raw || '').trim();
  if (!val || val.length > 160 || /[;\n\r{}]/.test(val)) return null;
  const angleMatch = val.match(/^([^<>]{1,80})<\s*([^\s<>@;]+@[^\s<>@;]+\.[^\s<>@;]+)\s*>$/);
  if (angleMatch) {
    return `${angleMatch[1].trim()} <${angleMatch[2].trim()}>`;
  }
  if (/^[^\s<>@;]+@[^\s<>@;]+\.[^\s<>@;]+$/.test(val)) {
    return `Nova AI <${val}>`;
  }
  return null;
}

function getValidResendKey(): string | null {
  const raw = (process.env.RESEND_API_KEY || '').trim();
  if (!raw || /\s/.test(raw) || !raw.startsWith('re_') || raw.length < 16) return null;
  return raw;
}

function getValidSmtpConfig(): { host: string; port: number; user: string; pass: string } | null {
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  if (!/^[^\s<>@;]+@[^\s<>@;]+\.[^\s<>@;]+$/.test(user)) return null;
  if (!pass || /[;{}<>()\n\r]/.test(pass) || pass.length > 128) return null;
  const rawHost = (process.env.SMTP_HOST || '').trim();
  const host = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(rawHost) ? rawHost : 'smtp.gmail.com';
  const parsedPort = Number((process.env.SMTP_PORT || '').trim());
  const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : 465;
  return { host, port, user, pass };
}

function isOtpDeliveryConfigured(): boolean {
  return Boolean(getValidResendKey() || getValidSmtpConfig());
}

function maskEmailAddress(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  const visible = local.length <= 2 ? local[0] || '*' : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

function parseCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    if (part.slice(0, eqIdx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eqIdx + 1).trim());
      } catch {
        return part.slice(eqIdx + 1).trim();
      }
    }
  }
  return undefined;
}

function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const xfp = req.headers['x-forwarded-proto'];
  const proto = (Array.isArray(xfp) ? xfp[0] : xfp || '').split(',')[0].trim().toLowerCase();
  return proto === 'https';
}

function setOtpSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = isHttpsRequest(req);
  const attrs = isHttps
    ? `Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${OTP_TRUSTED_DEVICE_MAX_AGE_SEC}`
    : `Path=/; HttpOnly; SameSite=Lax; Max-Age=${OTP_TRUSTED_DEVICE_MAX_AGE_SEC}`;
  res.append('Set-Cookie', `${OTP_COOKIE_NAME}=${encodeURIComponent(token)}; ${attrs}`);
}

function clearOtpSessionCookie(req: Request, res: Response): void {
  const isHttps = isHttpsRequest(req);
  const attrs = isHttps
    ? 'Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0'
    : 'Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  res.append('Set-Cookie', `${OTP_COOKIE_NAME}=; ${attrs}`);
}

function setOtpChallengeCookie(
  req: Request,
  res: Response,
  cid: string,
  uid: string,
  salt: string,
  codeHash: string,
  expiresAt: number
): void {
  const isHttps = isHttpsRequest(req);
  const token = signOtpChallengeCookie(OTP_SIGNING_SECRET, { cid, uid, salt, codeHash, exp: expiresAt });
  const attrs = isHttps
    ? 'Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=300'
    : 'Path=/; HttpOnly; SameSite=Lax; Max-Age=300';
  res.append('Set-Cookie', `${OTP_CHALLENGE_COOKIE_NAME}=${encodeURIComponent(token)}; ${attrs}`);
}

function clearOtpChallengeCookie(req: Request, res: Response): void {
  const isHttps = isHttpsRequest(req);
  const attrs = isHttps
    ? 'Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0'
    : 'Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  res.append('Set-Cookie', `${OTP_CHALLENGE_COOKIE_NAME}=; ${attrs}`);
}

function readVerifiedOtpChallengeCookie(
  cookieHeader: string | undefined,
  uid: string
): { cid: string; salt: string; codeHash: string; expiresAt: number } | null {
  const token = parseCookieValue(cookieHeader, OTP_CHALLENGE_COOKIE_NAME);
  const parsed = verifyOtpChallengeCookie(OTP_SIGNING_SECRET, token, uid);
  if (!parsed) return null;
  if (consumedChallengeIds.has(parsed.cid)) return null;
  return { cid: parsed.cid, salt: parsed.salt, codeHash: parsed.codeHash, expiresAt: parsed.exp };
}

function hashOtpCode(uid: string, salt: string, code: string): string {
  return hashOtpCodeWithSecret(OTP_SIGNING_SECRET, uid, salt, code);
}

function recordRevokedDeviceId(did: string, exp: number): void {
  if (!did) return;
  if (revokedDeviceIds.size >= 20000) {
    const oldestKey = revokedDeviceIds.keys().next().value;
    if (oldestKey) revokedDeviceIds.delete(oldestKey);
  }
  revokedDeviceIds.set(did, Math.max(Date.now() + 60_000, exp));
}

function recordConsumedChallengeId(cid: string, exp: number): void {
  if (!cid) return;
  if (consumedChallengeIds.size >= 20000) {
    const oldestKey = consumedChallengeIds.keys().next().value;
    if (oldestKey) consumedChallengeIds.delete(oldestKey);
  }
  consumedChallengeIds.set(cid, Math.max(Date.now() + 60_000, exp));
}

function markAuthSessionOtpVerified(
  uid: string,
  authTime: number,
  userAgent: string | undefined,
  expiresAt: number,
  deviceId: string
): void {
  if (authTime <= 0) return;
  const fp = computeDeviceFingerprint(OTP_SIGNING_SECRET, userAgent);
  const key = `${uid}:${authTime}:${fp}`;
  if (verifiedAuthSessions.size >= 5000) {
    const oldestKey = verifiedAuthSessions.keys().next().value;
    if (oldestKey) verifiedAuthSessions.delete(oldestKey);
  }
  verifiedAuthSessions.set(key, { expiresAt, deviceId });
}

interface OtpVerificationInspection {
  verified: boolean;
  trustedUntil: number;
  deviceId?: string;
  hasStaleCookie: boolean;
}

function inspectRequestOtpVerification(
  headers: IncomingMessage['headers'],
  uid: string,
  authTime: number,
  explicitToken?: string
): OtpVerificationInspection {
  const userAgent = typeof headers['user-agent'] === 'string' ? headers['user-agent'] : undefined;
  const now = Date.now();

  const cookieToken = parseCookieValue(headers.cookie, OTP_COOKIE_NAME);
  if (cookieToken) {
    const verifiedCookie = verifyTrustedOrSessionToken(
      OTP_SIGNING_SECRET,
      cookieToken,
      uid,
      userAgent,
      revokedDeviceIds,
      now
    );
    if (verifiedCookie) {
      return {
        verified: true,
        trustedUntil: verifiedCookie.exp,
        deviceId: verifiedCookie.did,
        hasStaleCookie: false,
      };
    }
  }

  const headerToken = typeof headers['x-nova-otp-token'] === 'string' ? headers['x-nova-otp-token'].trim() : '';
  if (headerToken) {
    const verifiedHeader = verifyTrustedOrSessionToken(
      OTP_SIGNING_SECRET,
      headerToken,
      uid,
      userAgent,
      revokedDeviceIds,
      now
    );
    if (verifiedHeader) {
      return {
        verified: true,
        trustedUntil: verifiedHeader.exp,
        deviceId: verifiedHeader.did,
        hasStaleCookie: Boolean(cookieToken),
      };
    }
  }

  if (explicitToken) {
    const verifiedExplicit = verifyTrustedOrSessionToken(
      OTP_SIGNING_SECRET,
      explicitToken,
      uid,
      userAgent,
      revokedDeviceIds,
      now
    );
    if (verifiedExplicit) {
      return {
        verified: true,
        trustedUntil: verifiedExplicit.exp,
        deviceId: verifiedExplicit.did,
        hasStaleCookie: Boolean(cookieToken),
      };
    }
  }

  if (authTime > 0) {
    const fp = computeDeviceFingerprint(OTP_SIGNING_SECRET, userAgent);
    const cached = verifiedAuthSessions.get(`${uid}:${authTime}:${fp}`);
    if (cached && cached.expiresAt > now && !revokedDeviceIds.has(cached.deviceId)) {
      return {
        verified: true,
        trustedUntil: cached.expiresAt,
        deviceId: cached.deviceId,
        hasStaleCookie: Boolean(cookieToken),
      };
    }
  }

  return {
    verified: false,
    trustedUntil: 0,
    hasStaleCookie: Boolean(cookieToken),
  };
}

function isRequestOtpVerified(
  headers: IncomingMessage['headers'],
  uid: string,
  authTime: number,
  explicitToken?: string
): boolean {
  return inspectRequestOtpVerification(headers, uid, authTime, explicitToken).verified;
}

async function sendOtpEmail(toEmail: string, code: string): Promise<void> {
  const subject = `رمز التحقق من Nova AI: ${code}`;
  const html = `
    <div dir="rtl" style="font-family: Arial, Tahoma, sans-serif; max-width: 520px; margin: 0 auto; background-color: #ffffff; color: #0f172a; padding: 28px; border-radius: 16px; border: 1px solid #e2e8f0;">
      <h2 style="margin: 0 0 12px; color: #4f46e5; font-size: 20px;">Nova AI — رمز التحقق الأمني</h2>
      <p style="margin: 0 0 18px; color: #334155; font-size: 15px; line-height: 1.7;">
        مرحبًا، لإكمال تسجيل الدخول إلى حسابك في Nova AI بأمان، أدخل رمز التحقق التالي:
      </p>
      <div style="background-color: #f1f5f9; border: 2px solid #4f46e5; border-radius: 12px; padding: 20px; text-align: center; font-family: 'Courier New', monospace; font-size: 34px; letter-spacing: 8px; font-weight: 800; color: #0f172a; direction: ltr;">
        ${code}
      </div>
      <p style="margin: 18px 0 0; font-size: 13px; color: #475569; line-height: 1.6;">
        الرمز هو: <strong dir="ltr" style="color: #0f172a;">${code}</strong> (صالح لمدة 5 دقائق فقط). لا تشارك هذا الرمز مع أي شخص.
      </p>
    </div>
  `;
  const text = `رمز التحقق لتسجيل الدخول في Nova AI هو: ${code}\nصالح لمدة 5 دقائق فقط. لا تشارك هذا الرمز مع أي شخص.`;

  const resendKey = getValidResendKey();
  const smtpCfg = getValidSmtpConfig();
  const validCustomFrom = extractValidFromAddress(process.env.SMTP_FROM);

  if (resendKey) {
    const primaryFrom = validCustomFrom || 'Nova AI <onboarding@resend.dev>';
    const sendViaResend = async (fromAddr: string) =>
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: fromAddr,
          to: [toEmail],
          subject,
          html,
          text,
        }),
        signal: AbortSignal.timeout(12000),
      });

    let res = await sendViaResend(primaryFrom);
    if (!res.ok && primaryFrom !== 'Nova AI <onboarding@resend.dev>') {
      res = await sendViaResend('Nova AI <onboarding@resend.dev>');
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`RESEND_FAILED:${res.status}:${errBody.slice(0, 200)}`);
    }
    return;
  }

  if (smtpCfg) {
    const fromAddress = validCustomFrom || `Nova AI <${smtpCfg.user}>`;
    const transporter = nodemailer.createTransport({
      host: smtpCfg.host,
      port: smtpCfg.port,
      secure: smtpCfg.port === 465,
      auth: {
        user: smtpCfg.user,
        pass: smtpCfg.pass,
      },
    });
    await transporter.sendMail({
      from: fromAddress,
      to: toEmail,
      subject,
      text,
      html,
    });
    return;
  }

  throw new Error('OTP_EMAIL_PROVIDER_NOT_CONFIGURED');
}

async function requireFirebaseAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const ip = getClientIp(req);
  const banSec = isIpTemporarilyBanned(ip);
  if (banSec > 0) {
    res.setHeader('Retry-After', String(banSec));
    res.status(429).json({
      error: `تم حظر الطلبات مؤقتًا للحماية الأمنية بعد محاولات فاشلة متكررة. حاول مجددًا بعد ${banSec} ثانية.`,
    });
    return;
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      recordAuthFailure(ip, req.originalUrl);
      res.status(401).json({ error: 'يجب تسجيل الدخول أولاً للوصول إلى خدمات Nova AI.' });
      return;
    }

    const idToken = authHeader.slice('Bearer '.length).trim();
    if (!idToken) {
      recordAuthFailure(ip, req.originalUrl);
      res.status(401).json({ error: 'رمز التحقق غير صالح.' });
      return;
    }

    const verified = await verifyFirebaseIdToken(idToken);
    if (!verified) {
      recordAuthFailure(ip, req.originalUrl);
      res.status(401).json({ error: 'انتهت صلاحية الجلسة أو تعذر التحقق من الهوية. يرجى إعادة تسجيل الدخول.' });
      return;
    }

    const authQuota = consumeRateQuota(userAuthWindows, verified.uid, 60, 60_000);
    if (!authQuota.allowed) {
      res.setHeader('Retry-After', String(authQuota.retryAfterSec));
      res.status(429).json({
        error: `تم تجاوز حد الطلبات السريع لحماية الخدمة. يرجى الانتظار ${authQuota.retryAfterSec} ثانية.`,
      });
      return;
    }

    req.uid = verified.uid;
    req.userEmail = verified.email;
    req.authTime = verified.authTime;
    next();
  } catch (err) {
    if (err instanceof Error && err.message === 'MISSING_FIREBASE_CONFIG') {
      res.status(500).json({ error: 'إعدادات المصادقة غير مكتملة على الخادم.' });
      return;
    }
    recordAuthFailure(ip, req.originalUrl);
    console.error('Auth verification error:', err);
    res.status(401).json({ error: 'فشل التحقق من جلسة المستخدم.' });
  }
}

function checkUserAiQuotas(uid: string, isHeavyStudio: boolean): { allowed: boolean; retryAfterSec: number; reason?: string } {
  const minuteQuota = consumeRateQuota(userAiMinuteWindows, uid, 15, 60_000);
  if (!minuteQuota.allowed) {
    return {
      allowed: false,
      retryAfterSec: minuteQuota.retryAfterSec,
      reason: `تم تجاوز الحد المسموح لطلبات الذكاء الاصطناعي في الدقيقة (15 طلب/دقيقة). يرجى الانتظار ${minuteQuota.retryAfterSec} ثانية.`,
    };
  }
  const hourlyQuota = consumeRateQuota(userAiHourlyWindows, uid, 120, 60 * 60_000);
  if (!hourlyQuota.allowed) {
    return {
      allowed: false,
      retryAfterSec: hourlyQuota.retryAfterSec,
      reason: 'وصلت إلى الحد الساعي الأقصى لاستخدام الذكاء الاصطناعي لحماية حصة الخدمة. يرجى المحاولة لاحقًا.',
    };
  }
  if (isHeavyStudio) {
    const studioQuota = consumeRateQuota(userStudioBurstWindows, uid, 15, 15 * 60_000);
    if (!studioQuota.allowed) {
      return {
        allowed: false,
        retryAfterSec: studioQuota.retryAfterSec,
        reason: `وصلت إلى الحد المؤقت لإنشاء العروض والاختبارات (15 عملية كل 15 دقيقة). يرجى الانتظار ${studioQuota.retryAfterSec} ثانية.`,
      };
    }
  }
  return { allowed: true, retryAfterSec: 0 };
}

function requireAiQuota(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.uid) {
    res.status(401).json({ error: 'يجب تسجيل الدخول أولاً.' });
    return;
  }
  const isHeavyStudio = req.path === '/generate-pptx' || req.path === '/generate-exam';
  const result = checkUserAiQuotas(req.uid, isHeavyStudio);
  if (!result.allowed) {
    recordSecurityEvent('rate_limit_block', getClientIp(req), req.originalUrl);
    res.setHeader('Retry-After', String(result.retryAfterSec));
    res.status(429).json({ error: result.reason });
    return;
  }
  next();
}

function requireOtpIfConfigured(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!isOtpDeliveryConfigured()) {
    next();
    return;
  }
  if (!req.uid || !isRequestOtpVerified(req.headers, req.uid, req.authTime ?? 0)) {
    res.status(403).json({
      requiresOtp: true,
      error: 'يجب إتمام التحقق برمز Gmail أولاً قبل استخدام خدمات Nova AI.',
    });
    return;
  }
  next();
}

export function createNovaApiApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Block path traversal, null-byte, scanner probes & banned IPs before any handler
  app.use((req, res, next) => {
    const ip = getClientIp(req);
    const banSec = isIpTemporarilyBanned(ip);
    if (banSec > 0) {
      res.setHeader('Retry-After', String(banSec));
      res.status(429).json({ error: 'تم حظر هذا العنوان مؤقتًا بسبب نشاط مشبوه.' });
      return;
    }
    if (isSuspiciousUrlPath(req.originalUrl)) {
      recordSecurityEvent('traversal_block', ip, req.originalUrl);
      res.status(400).json({ error: 'طلب مرفوض بواسطة جدار الحماية.' });
      return;
    }
    if (isSuspiciousProbeOrBot(req)) {
      recordSuspiciousProbe(ip, req.originalUrl);
      res.status(403).json({ error: 'تم حظر هذا النشاط المشبوه بواسطة جدار الحماية.' });
      return;
    }
    next();
  });

  // Enforce HTTPS in production and apply multi-layered transport, CSP & browser isolation headers
  const isProd = process.env.NODE_ENV === 'production';
  const cspScriptSrc = isProd
    ? "'self' https://apis.google.com https://accounts.google.com"
    : "'self' 'unsafe-inline' https://apis.google.com https://accounts.google.com";
  const cspHeader = [
    "default-src 'self'",
    `script-src ${cspScriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://*.googleusercontent.com https://lh3.googleusercontent.com",
    "media-src 'self' data: blob:",
    "connect-src 'self' wss: ws: https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://fonts.googleapis.com https://fonts.gstatic.com",
    "frame-src 'self' https://accounts.google.com https://*.firebaseapp.com",
    "frame-ancestors 'self' https://aistudio.google.com https://*.aistudio.google.com https://*.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');

  app.use((_req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()');
    res.setHeader('Content-Security-Policy', cspHeader);
    next();
  });

  app.use(express.json({ limit: '16mb' }));

  // API Firewall: rate limiting, same-origin CSRF enforcement, Content-Type & prototype pollution checks
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const ip = getClientIp(req);
    const banSec = isIpTemporarilyBanned(ip);
    if (banSec > 0) {
      res.setHeader('Retry-After', String(banSec));
      res.status(429).json({ error: 'تم تقييد الوصول مؤقتًا للحماية الأمنية.' });
      return;
    }

    const ipQuota = consumeRateQuota(ipApiWindows, ip, 90, 60_000);
    if (!ipQuota.allowed) {
      res.setHeader('Retry-After', String(ipQuota.retryAfterSec));
      res.status(429).json({ error: 'عدد الطلبات مرتفع جدًا من هذا العنوان. يرجى الانتظار قليلاً.' });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      if (!isTrustedRequestOrigin(req.headers)) {
        recordSecurityEvent('csrf_origin_block', ip, req.originalUrl);
        res.status(403).json({ error: 'تم رفض الطلب لعدم تطابق المصدر الأمني.' });
        return;
      }
      const contentType = req.headers['content-type'] || '';
      if (!contentType.toLowerCase().includes('application/json')) {
        res.status(415).json({ error: 'نوع المحتوى غير مدعوم. يجب إرسال البيانات بصيغة JSON.' });
        return;
      }
      if (hasDangerousKeysOrDepth(req.body)) {
        recordSecurityEvent('prototype_pollution_block', ip, req.originalUrl);
        res.status(400).json({ error: 'تم حظر البيانات لاحتوائها على حقول أو بنية غير آمنة.' });
        return;
      }
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'Nova AI',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      otpConfigured: isOtpDeliveryConfigured(),
      liveWsSupported: process.env.VERCEL !== '1',
    });
  });

  // --- Email OTP Verification Endpoints & Owner Security Monitor ---
  app.get('/api/auth/otp/status', requireFirebaseAuth, (req: AuthedRequest, res: Response) => {
    const configured = isOtpDeliveryConfigured();
    if (!configured) {
      res.json({
        otpRequired: false,
        configured: false,
        verified: true,
        emailMasked: req.userEmail ? maskEmailAddress(req.userEmail) : '',
        cooldownRemainingSec: 0,
      });
      return;
    }
    const uid = req.uid || '';
    const authTime = req.authTime ?? 0;
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
    const inspection = uid
      ? inspectRequestOtpVerification(req.headers, uid, authTime)
      : { verified: false, trustedUntil: 0, hasStaleCookie: false };

    if (!inspection.verified && inspection.hasStaleCookie) {
      clearOtpSessionCookie(req, res);
    }

    let otpToken: string | undefined;
    if (inspection.verified && uid) {
      const wsSession = issueShortSessionToken(
        OTP_SIGNING_SECRET,
        uid,
        userAgent,
        inspection.trustedUntil,
        inspection.deviceId
      );
      otpToken = wsSession.token;
    }

    const existingChallenge = uid ? otpChallenges.get(uid) : undefined;
    const cooldownRemainingSec = existingChallenge
      ? Math.max(0, Math.ceil((existingChallenge.lastSentAt + 60_000 - Date.now()) / 1000))
      : 0;
    res.json({
      otpRequired: !inspection.verified,
      configured: true,
      verified: inspection.verified,
      otpToken,
      trustedUntil: inspection.verified ? inspection.trustedUntil : 0,
      trustedDays: OTP_TRUSTED_DEVICE_DAYS,
      emailMasked: req.userEmail ? maskEmailAddress(req.userEmail) : '',
      cooldownRemainingSec,
    });
  });

  app.post('/api/auth/otp/logout', requireFirebaseAuth, (req: AuthedRequest, res: Response) => {
    if (req.uid) {
      otpChallenges.delete(req.uid);

      const cookieToken = parseCookieValue(req.headers.cookie, OTP_COOKIE_NAME);
      const headerToken =
        typeof req.headers['x-nova-otp-token'] === 'string' ? req.headers['x-nova-otp-token'].trim() : '';

      for (const candidate of [cookieToken, headerToken]) {
        const extracted = extractValidDeviceIdForLogout(OTP_SIGNING_SECRET, candidate, req.uid);
        if (extracted) {
          recordRevokedDeviceId(extracted.did, extracted.exp);
        }
      }

      const prefix = `${req.uid}:`;
      for (const key of verifiedAuthSessions.keys()) {
        if (key.startsWith(prefix)) {
          verifiedAuthSessions.delete(key);
        }
      }
    }
    clearOtpSessionCookie(req, res);
    clearOtpChallengeCookie(req, res);
    res.json({ ok: true });
  });

  app.post('/api/auth/otp/request', requireFirebaseAuth, async (req: AuthedRequest, res: Response) => {
    try {
      if (!isOtpDeliveryConfigured()) {
        res.json({ alreadyVerified: true, sent: false });
        return;
      }
      if (!req.uid || !req.userEmail) {
        res.status(401).json({ error: 'تعذر التحقق من البريد الإلكتروني.' });
        return;
      }

      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
      const existingTrust = inspectRequestOtpVerification(req.headers, req.uid, req.authTime ?? 0);
      if (existingTrust.verified) {
        const wsSession = issueShortSessionToken(
          OTP_SIGNING_SECRET,
          req.uid,
          userAgent,
          existingTrust.trustedUntil,
          existingTrust.deviceId
        );
        res.json({
          alreadyVerified: true,
          sent: false,
          otpToken: wsSession.token,
          trustedUntil: existingTrust.trustedUntil,
        });
        return;
      }

      const now = Date.now();
      const prev = otpChallenges.get(req.uid);
      if (prev && prev.lockedUntil > now) {
        const waitSec = Math.ceil((prev.lockedUntil - now) / 1000);
        res.status(429).json({
          cooldownSec: waitSec,
          error: `تم قفل طلبات الرمز مؤقتًا للحماية. انتظر ${waitSec} ثانية.`,
        });
        return;
      }
      if (prev && now - prev.lastSentAt < 60_000) {
        const cooldownSec = Math.ceil((prev.lastSentAt + 60_000 - now) / 1000);
        res.status(429).json({
          cooldownSec,
          error: `يرجى الانتظار ${cooldownSec} ثانية قبل طلب رمز جديد.`,
        });
        return;
      }

      const history = (prev?.requestHistory || []).filter((t) => now - t < 60 * 60_000);
      if (history.length >= 5) {
        res.status(429).json({
          cooldownSec: 300,
          error: 'تم تجاوز الحد الأقصى لطلب رموز التحقق في الساعة. حاول لاحقًا.',
        });
        return;
      }

      const cid = crypto.randomUUID();
      const code = String(crypto.randomInt(100000, 1000000));
      const salt = crypto.randomBytes(16).toString('hex');
      const codeHash = hashOtpCode(req.uid, salt, code);
      const updatedHistory = [...history, now];

      const expiresAt = now + OTP_CHALLENGE_TTL_MS;
      otpChallenges.set(req.uid, {
        cid,
        salt,
        codeHash,
        expiresAt,
        lastSentAt: now,
        failedAttempts: 0,
        lockedUntil: 0,
        requestHistory: updatedHistory,
      });

      try {
        await sendOtpEmail(req.userEmail, code);
      } catch (sendErr) {
        // Invalidate the unsent challenge code while retaining requestHistory cooldown to prevent spam
        const cur = otpChallenges.get(req.uid);
        if (cur) {
          cur.codeHash = '';
          cur.salt = '';
          cur.expiresAt = 0;
        }
        clearOtpChallengeCookie(req, res);
        throw sendErr;
      }

      setOtpChallengeCookie(req, res, cid, req.uid, salt, codeHash, expiresAt);
      res.json({
        sent: true,
        emailMasked: maskEmailAddress(req.userEmail),
        cooldownSec: 60,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      console.error('[Nova AI OTP Send Error]:', msg);
      if (msg.includes('RESEND_FAILED:403') || msg.includes('only send testing emails')) {
        res.status(502).json({
          error:
            'حساب Resend المجاني يسمح بالإرسال فقط إلى البريد المسجل به في Resend حتى توثيق النطاق (أو استخدم SMTP_USER و SMTP_PASS مع كلمة مرور تطبيق Gmail لإرسال الرمز لأي بريد).',
        });
        return;
      }
      res.status(502).json({ error: 'تعذر إرسال رسالة الرمز إلى Gmail حاليًا. تحقق من إعدادات البريد في الخادم.' });
    }
  });

  app.post('/api/auth/otp/verify', requireFirebaseAuth, (req: AuthedRequest, res: Response) => {
    const ip = getClientIp(req);
    const authTime = req.authTime ?? 0;
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
    if (!isOtpDeliveryConfigured()) {
      const trusted = req.uid
        ? issueTrustedDeviceToken(OTP_SIGNING_SECRET, req.uid, userAgent)
        : null;
      if (trusted) setOtpSessionCookie(req, res, trusted.token);
      res.json({
        verified: true,
        otpToken: trusted?.token || 'disabled',
        expiresAt: trusted?.expiresAt || 0,
        trustedUntil: trusted?.expiresAt || 0,
        trustedDays: OTP_TRUSTED_DEVICE_DAYS,
      });
      return;
    }

    if (!req.uid) {
      res.status(401).json({ error: 'جلسة غير صالحة.' });
      return;
    }

    const code = typeof req.body?.code === 'string' ? req.body.code.replace(/\D/g, '') : '';
    if (code.length !== 6) {
      res.status(400).json({ error: 'يجب إدخال رمز مكون من 6 أرقام.' });
      return;
    }

    const now = Date.now();
    let challenge = otpChallenges.get(req.uid);
    if (!challenge) {
      const cookieChallenge = readVerifiedOtpChallengeCookie(req.headers.cookie, req.uid);
      if (cookieChallenge) {
        challenge = {
          cid: cookieChallenge.cid,
          salt: cookieChallenge.salt,
          codeHash: cookieChallenge.codeHash,
          expiresAt: cookieChallenge.expiresAt,
          lastSentAt: now,
          failedAttempts: 0,
          lockedUntil: 0,
          requestHistory: [],
        };
        otpChallenges.set(req.uid, challenge);
      }
    }
    if (!challenge) {
      res.status(400).json({ error: 'لا يوجد رمز تحقق نشط. اضغط على إعادة إرسال الرمز.' });
      return;
    }
    if (challenge.lockedUntil > now) {
      const waitSec = Math.ceil((challenge.lockedUntil - now) / 1000);
      res.status(429).json({ error: `محاولات خاطئة متكررة. حاول مجددًا بعد ${waitSec} ثانية.` });
      return;
    }
    if (challenge.cid && consumedChallengeIds.has(challenge.cid)) {
      otpChallenges.delete(req.uid);
      clearOtpChallengeCookie(req, res);
      res.status(400).json({ error: 'تم استخدام هذا الرمز مسبقًا أو إبطاله. اطلب رمزًا جديدًا.' });
      return;
    }
    if (!challenge.codeHash || !challenge.salt || challenge.expiresAt < now) {
      otpChallenges.delete(req.uid);
      clearOtpChallengeCookie(req, res);
      res.status(400).json({ error: 'انتهت صلاحية الرمز. اطلب رمزًا جديدًا.' });
      return;
    }

    const candidateHash = hashOtpCode(req.uid, challenge.salt, code);
    if (!timingSafeEqualStr(candidateHash, challenge.codeHash)) {
      challenge.failedAttempts += 1;
      if (challenge.failedAttempts >= OTP_MAX_ATTEMPTS) {
        if (challenge.cid) {
          recordConsumedChallengeId(challenge.cid, challenge.expiresAt);
        }
        challenge.lockedUntil = now + OTP_LOCKOUT_MS;
        challenge.codeHash = '';
        challenge.salt = '';
        challenge.expiresAt = 0;
        clearOtpChallengeCookie(req, res);
        recordSecurityEvent('otp_lockout', ip, req.originalUrl);
        res.status(429).json({ error: 'تم إدخال الرمز بشكل خاطئ 5 مرات. تم إلغاء الرمز وقفل التحقق لمدة 10 دقائق.' });
        return;
      }
      res.status(401).json({
        error: `رمز التحقق غير صحيح (المتبقي ${OTP_MAX_ATTEMPTS - challenge.failedAttempts} محاولات).`,
      });
      return;
    }

    if (challenge.cid) {
      recordConsumedChallengeId(challenge.cid, challenge.expiresAt);
    }
    otpChallenges.delete(req.uid);
    clearOtpChallengeCookie(req, res);

    const trusted = issueTrustedDeviceToken(OTP_SIGNING_SECRET, req.uid, userAgent, now);
    const wsSession = issueShortSessionToken(
      OTP_SIGNING_SECRET,
      req.uid,
      userAgent,
      trusted.expiresAt,
      trusted.deviceId,
      now
    );
    markAuthSessionOtpVerified(req.uid, authTime, userAgent, trusted.expiresAt, trusted.deviceId);
    setOtpSessionCookie(req, res, trusted.token);
    res.json({
      verified: true,
      otpToken: wsSession.token,
      expiresAt: trusted.expiresAt,
      trustedUntil: trusted.expiresAt,
      trustedDays: OTP_TRUSTED_DEVICE_DAYS,
    });
  });

  app.get(
    '/api/owner/security-events',
    requireFirebaseAuth,
    requireOtpIfConfigured,
    (req: AuthedRequest, res: Response) => {
      if ((req.userEmail || '').toLowerCase() !== OWNER_ADMIN_EMAIL) {
        res.status(403).json({ error: 'هذه الصلاحية مخصصة لمالك الموقع فقط.' });
        return;
      }
      res.json({
        otpConfigured: isOtpDeliveryConfigured(),
        activeBannedIps: countActiveBannedIps(),
        totalBlockedEvents: securityEvents.length,
        recentEvents: securityEvents.slice(0, 25),
      });
    }
  );

  app.use('/api/nova', requireFirebaseAuth, requireOtpIfConfigured, requireAiQuota);

  // 1. Fast & Resilient Arabic Chat Endpoint (Supports NDJSON Streaming + JSON)
  app.post('/api/nova/chat', async (req: AuthedRequest, res: Response) => {
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
          attachment?: { data: string; mimeType: string; fileName?: string };
          textAttachment?: { name: string; content: string };
        }>;
        customInstruction?: string;
        thinkingDepth?: 'low' | 'high';
        stream?: boolean;
      };

      if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
        res.status(400).json({ error: 'عدد الرسائل أو صيغتها غير صالحة.' });
        return;
      }

      if (customInstruction !== undefined && typeof customInstruction !== 'string') {
        res.status(400).json({ error: 'تنسيق التعليمات الشخصية غير صالح.' });
        return;
      }

      const ALLOWED_ATTACHMENT_MIMES = new Set([
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf',
      ]);
      for (const m of messages) {
        if (!m || (m.role !== 'user' && m.role !== 'assistant')) {
          res.status(400).json({ error: 'دور المرسل في الرسالة غير صالح.' });
          return;
        }
        if (typeof m.content !== 'string' || m.content.length > 25000) {
          res.status(400).json({ error: 'محتوى الرسالة غير صالح أو يتجاوز الحد المسموح.' });
          return;
        }
        if (m.attachment) {
          if (
            typeof m.attachment.mimeType !== 'string' ||
            !ALLOWED_ATTACHMENT_MIMES.has(m.attachment.mimeType) ||
            typeof m.attachment.data !== 'string' ||
            m.attachment.data.length > 6_000_000 ||
            !/^[A-Za-z0-9+/=\s]+$/.test(m.attachment.data.slice(0, 200))
          ) {
            res.status(400).json({ error: 'الملف أو الصورة المرفقة غير صالحة أو تتجاوز الحد المسموح.' });
            return;
          }
        }
        if (m.textAttachment) {
          if (
            typeof m.textAttachment.name !== 'string' ||
            typeof m.textAttachment.content !== 'string' ||
            m.textAttachment.content.length > 100_000
          ) {
            res.status(400).json({ error: 'الملف النصي المرفق غير صالح أو يتجاوز الحد المسموح.' });
            return;
          }
        }
      }

      const ai = getAiClient();

      const cleanCustomInstruction = sanitizeTextInput(customInstruction, 1000);
      const baseInstruction = [
        'أنت Nova AI، مساعد ذكاء اصطناعي شخصي ذكي وسريع ودقيق.',
        'التزم بالرد دائمًا باللغة العربية الفصحى الواضحة والأنيقة على كل رسالة يرسلها المستخدم، وافهم طلبه بدقة ونفّذه مباشرة.',
        'تحرَّ الدقة العلمية والمنطقية التامة في جميع الإجابات؛ وإذا احتوت الرسالة على صورة أو لقطة كاميرا أو ملف مرفق فاقرأ كل التفاصيل والنصوص والأرقام والعناصر الظاهرة بدقة عالية قبل الإجابة دون تخمين خاطئ.',
        '',
        'قواعد الأدوات المدمجة داخل المحادثة (مهم جدًا):',
        '- تتوفر لديك أربع أدوات مدمجة لتنفيذ طلبات المستخدم مباشرة داخل المحادثة: create_presentation (صانع العروض التقديمية PowerPoint/PDF)، create_exam (صانع الاختبارات)، summarize_lesson (ملخص الدروس)، create_flashcards (بطاقات المراجعة).',
        '- استدعِ الأداة المناسبة فورًا فقط عندما يطلب المستخدم إحدى هذه المهام بوضوح وتتوفر المعلومات الأساسية المطلوبة (من رسالته أو سياق المحادثة أو الصورة أو الملف المرفق).',
        '- إذا كان الطلب غامضًا أو غير مفهوم أو تنقصه معلومة أساسية (مثل طلب «اعمل عرضًا» بدون موضوع، أو «أريد اختبارًا» بدون مادة ودرس أو نص، أو «لخّص لي» / «بطاقات مراجعة» بدون نص أو صورة أو ملف أو اسم درس محدد)، فلا تستدعِ أي أداة ولا تخمّن أبدًا! بدلاً من ذلك اسأل المستخدم سؤالاً عربيًا قصيرًا ومباشرًا للتأكد واستكمال المعلومة الناقصة.',
        '- للأسئلة والمحادثات العادية، الشرح، البرمجة، النصائح، أو تحليل الصور والملفات العادي: أجب مباشرة كنص عادي دون استدعاء أي أداة.',
        thinkingDepth === 'high'
          ? 'في وضع التحليل العميق والأسئلة الصعبة أو العلمية أو البرمجية المعقدة، قدّم حلاً دقيقًا ومفصلًا ومنظمًا بخطوات واضحة وأمثلة أو أكواد عملية عند الحاجة.'
          : 'أجب بسرعة وإيجاز مباشر: ادخل في صلب الإجابة فورًا دون مقدمات مكررة أو حشو، وقدّم نقاطًا واضحة أو أكوادًا عملية عند الحاجة.',
        cleanCustomInstruction ? `\nتعليمات المستخدم الشخصية المخصصة:\n${cleanCustomInstruction}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      // Normalize contents (supporting image, PDF, and text file attachments cleanly), trim oversized history for fast prefill, and merge consecutive same-role turns
      const recentMessages = messages.slice(-8);
      const rawContents = recentMessages
        .filter((m) => {
          const hasText = typeof m.content === 'string' && sanitizeTextInput(m.content, 25000).length > 0;
          const hasBinary = Boolean(m.attachment?.data && m.attachment?.mimeType);
          const hasTextFile = Boolean(m.textAttachment?.content && m.textAttachment?.name);
          return hasText || hasBinary || hasTextFile;
        })
        .map((msg, idx) => {
          const parts: ChatContentPart[] = [];
          const hasBinary = Boolean(msg.attachment?.data && msg.attachment?.mimeType);
          const isPdf = msg.attachment?.mimeType === 'application/pdf';
          if (hasBinary && msg.attachment) {
            parts.push({
              inlineData: {
                data: msg.attachment.data,
                mimeType: msg.attachment.mimeType,
              },
            });
          }
          const isLatestTurn = idx === recentMessages.length - 1;
          const rawText = sanitizeTextInput(msg.content, 25000);
          let combinedText = rawText;

          if (msg.textAttachment?.content) {
            const safeFileName = sanitizeTextInput(msg.textAttachment.name, 140, false) || 'ملف مرفق';
            const safeFileBody = sanitizeTextInput(msg.textAttachment.content, isLatestTurn ? 75000 : 2500);
            if (safeFileBody) {
              const basePrompt = rawText || `حلّل محتوى الملف المرفق (${safeFileName}) بالتفصيل واشرحه بدقة.`;
              combinedText = `${basePrompt}\n\n[محتوى الملف المرفق: ${safeFileName}]\n${safeFileBody}`;
            }
          }

          const cleanText =
            combinedText ||
            (hasBinary
              ? isPdf
                ? 'حلّل هذا الملف المرفق بالتفصيل واشرح ما ورد فيه بدقة.'
                : 'حلّل هذه الصورة بالتفصيل واشرح ما يظهر فيها بدقة.'
              : '');
          parts.push({ text: isLatestTurn ? cleanText : cleanText.slice(0, 3500) });
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
        res.status(400).json({ error: 'يرجى كتابة رسالة أو إرفاق ملف أو صورة قبل الإرسال.' });
        return;
      }

      const hasImageInRequest = contents.some((turn) => turn.parts.some((p) => Boolean(p.inlineData)));
      const lastContentTurn = contents[contents.length - 1];
      const hasImageInLatestTurn = Boolean(lastContentTurn?.parts.some((p) => Boolean(p.inlineData)));
      const latestUserText = lastContentTurn?.parts.map((p) => p.text || '').join(' ').trim() || '';

      // Non-streaming compatibility path
      if (!stream) {
        const attempts = buildChatAttempts(thinkingDepth, hasImageInRequest);
        let nonStreamResult: { text: string; finishReason?: string; modelUsed: string; functionCall?: ExtractedFunctionCall } | null = null;
        let lastNonStreamErr: unknown;
        for (const attempt of attempts) {
          if (attempt.delayMs > 0) await new Promise((r) => setTimeout(r, attempt.delayMs));
          try {
            const response = await ai.models.generateContent({
              model: attempt.model,
              contents,
              config: {
                systemInstruction: baseInstruction,
                thinkingConfig: { thinkingLevel: attempt.thinkingLevel },
                tools: [{ functionDeclarations: NOVA_CHAT_TOOLS }],
                abortSignal: AbortSignal.timeout(attempt.inactivityTimeoutMs + 15000),
              },
            });
            const fc = response.functionCalls?.[0];
            if (fc && typeof fc.name === 'string') {
              nonStreamResult = {
                text: extractGeminiText(response),
                modelUsed: attempt.model,
                functionCall: {
                  name: fc.name,
                  args: fc.args && typeof fc.args === 'object' ? (fc.args as Record<string, unknown>) : {},
                  id: fc.id,
                },
              };
              break;
            }
            const replyText = extractGeminiText(response);
            const finishReason = response.candidates?.[0]?.finishReason;
            if (replyText) {
              nonStreamResult = { text: replyText, finishReason, modelUsed: attempt.model };
              break;
            }
            lastNonStreamErr = new Error(`EMPTY_REPLY:${finishReason || 'UNKNOWN'}`);
          } catch (err) {
            lastNonStreamErr = err;
            if (!isRetryableError(err)) throw err;
          }
        }
        if (!nonStreamResult) throw lastNonStreamErr ?? new Error('EMPTY_REPLY:UNKNOWN');

        if (nonStreamResult.functionCall) {
          const normalized = normalizeChatToolCall(nonStreamResult.functionCall, {
            hasImageInLatestTurn,
            latestUserText,
          });
          if (normalized.valid) {
            res.json({
              toolIntent: {
                tool: normalized.tool,
                params: normalized.params,
                intro: nonStreamResult.text,
              },
              model: nonStreamResult.modelUsed,
            });
            return;
          }
          res.json({ reply: normalized.clarification, model: nonStreamResult.modelUsed });
          return;
        }

        res.json({ reply: nonStreamResult.text, model: nonStreamResult.modelUsed });
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
      const attempts = buildChatAttempts(thinkingDepth, hasImageInRequest);

      writeEvent({ type: 'status', phase: thinkingDepth === 'high' || complex ? 'thinking' : 'generating' });

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
        let accumulatedText = '';
        let detectedFunctionCall: ExtractedFunctionCall | undefined;
        let sentThinkingHint = false;
        let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
        const resetWatchdogTimer = () => {
          if (inactivityTimer) clearTimeout(inactivityTimer);
          const timeoutMs = accumulatedText.length > 0 ? attempt.inactivityTimeoutMs : attempt.firstTokenTimeoutMs;
          inactivityTimer = setTimeout(() => {
            attemptController.abort(new Error('TimeoutError: Stream inactivity timeout'));
          }, timeoutMs);
        };

        try {
          resetWatchdogTimer();
          const responseStream = await ai.models.generateContentStream({
            model: attempt.model,
            contents,
            config: {
              systemInstruction: baseInstruction,
              thinkingConfig: { thinkingLevel: attempt.thinkingLevel },
              tools: [{ functionDeclarations: NOVA_CHAT_TOOLS }],
              abortSignal: attemptController.signal,
            },
          });

          for await (const chunk of responseStream) {
            if (clientDisconnected) break;

            const { delta, hasThought, finishReason, functionCall } = extractStreamChunkInfo(chunk);
            if (finishReason) {
              lastFinishReason = finishReason;
            }
            if (hasThought && !accumulatedText && !sentThinkingHint) {
              sentThinkingHint = true;
              writeEvent({ type: 'status', phase: 'thinking' });
            }
            if (functionCall && !detectedFunctionCall) {
              detectedFunctionCall = functionCall;
            }
            if (delta && !detectedFunctionCall) {
              accumulatedText += delta;
              writeEvent({ type: 'delta', text: delta });
            }
            resetWatchdogTimer();
          }

          if (clientDisconnected) return;

          if (detectedFunctionCall) {
            const normalized = normalizeChatToolCall(detectedFunctionCall, {
              hasImageInLatestTurn,
              latestUserText,
            });
            cleanupHeartbeat();
            if (normalized.valid) {
              writeEvent({
                type: 'tool_intent',
                tool: normalized.tool,
                params: normalized.params,
                intro: accumulatedText.trim(),
                model: attempt.model,
              });
            } else {
              writeEvent({
                type: 'done',
                reply: normalized.clarification,
                model: attempt.model,
              });
            }
            res.end();
            return;
          }

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
          if (partial.length > 0 && !detectedFunctionCall) {
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
  app.post('/api/nova/contact-triage', async (req: AuthedRequest, res: Response) => {
    try {
      const { senderName, category = 'general', message } = req.body as {
        senderName?: string;
        category?: 'issue' | 'suggestion' | 'general';
        message?: string;
      };

      const cleanMessage = sanitizeTextInput(message, 3000);
      if (cleanMessage.length < 5) {
        res.status(400).json({ error: 'محتوى الرسالة قصير جدًا للتحليل.' });
        return;
      }
      const cleanSenderName = sanitizeTextInput(senderName, 120, false) || 'مستخدم';
      const safeCategory = category === 'issue' || category === 'suggestion' ? category : 'general';

      const ai = getAiClient();
      const categoryLabel =
        safeCategory === 'issue' ? 'مشكلة تقنية' : safeCategory === 'suggestion' ? 'اقتراح تطوير' : 'استفسار عام';

      const systemInstruction = [
        'أنت محلل الدعم الفني والرد الذكي في منصة Nova AI.',
        'قم بتحليل رسالة المستخدم المرسلة من صفحة "تواصل معنا" وأعد النتيجة بصيغة JSON مطابقة للمخطط.',
        'قواعد التصنيف:',
        '- اختر "simple" إذا كانت الرسالة سؤالاً عن طريقة استخدام Nova AI أو استفساراً بسيطاً أو اقتراحاً عادياً أو مشكلة خفيفة يمكن إرشاد المستخدم لحلها فوراً. في حقل reply قدّم إجابة عربية مهذبة، واضحة، وعملية تساعد المستخدم مباشرة.',
        '- اختر "urgent" إذا كانت الرسالة تتضمن مشكلة تقنية كبيرة أو عطلاً فعلياً أو خطأً في النظام أو فقدان بيانات أو مشكلة في الحساب/تسجيل الدخول أو شكوى جدية تتطلب تدخل مطور الموقع. في حقل reply قدّم رداً عربياً مهذباً يوضح للمستخدم أن رسالته صُنفت كرسالة عاجلة ووصلت مباشرة إلى مطور الموقع للمراجعة العاجلة.',
        'مزايا التطبيق الحالية لمساعدتك في الإجابة: يدعم Nova AI المحادثة العربية الذكية (بوضع استجابة سريعة أو تحليل عميق)، وإرفاق الصور في المحادثة لتحليلها، وتخصيص ألوان الواجهة (البنفسجي والأزرق والأخضر والأحمر) والوضع الداكن والفاتح وتغيير الحساب وقفل الشاشة السريع من صفحة الإعدادات، وصفحات من نحن والمساعدة والأسئلة الشائعة وتواصل معنا.',
      ].join('\n');

      const userPrompt = [
        `اسم المرسل: ${cleanSenderName}`,
        `التصنيف المختار: ${categoryLabel}`,
        `نص الرسالة:\n${cleanMessage}`,
      ].join('\n');

      const attempts: Array<{ model: string; thinkingLevel: ThinkingLevel; delayMs: number }> = [
        { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL, delayMs: 0 },
        { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW, delayMs: 0 },
        { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.LOW, delayMs: 150 },
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
              thinkingConfig: { thinkingLevel: attempt.thinkingLevel },
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
            summary: (summary || cleanMessage.slice(0, 120)).slice(0, 500),
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

  const ALLOWED_VOICE_NAMES = ['Zephyr', 'Kore', 'Puck', 'Charon', 'Fenrir'] as const;

  const prepareArabicSpeechText = (raw: string | undefined, maxLen: number): string => {
    return cleanTextForSpeech(sanitizeTextInput(raw, Math.max(maxLen + 500, 2500)), maxLen);
  };

  const generateNaturalArabicTts = async (
    ai: GoogleGenAI,
    cleanText: string,
    voiceName: string | undefined,
    timeoutMs = 20000
  ): Promise<{ audioBase64: string | null; lastError: unknown }> => {
    const chosenVoice =
      typeof voiceName === 'string' && (ALLOWED_VOICE_NAMES as readonly string[]).includes(voiceName)
        ? voiceName
        : 'Zephyr';

    let base64Audio: string | null = null;
    let lastError: unknown = null;

    // Prefer flagship gemini-3.8-flash-tts first for expressive, crystal-clear natural human Arabic speech
    for (const ttsModel of ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']) {
      try {
        const response = await ai.models.generateContent({
          model: ttsModel,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: cleanText,
                  speechMetadata: {
                    style:
                      'Articulate, warm, natural native Arabic human speaker with crystal-clear pronunciation, smooth connected phrasing, steady friendly rhythm, relaxed breathing pauses on punctuation, and zero robotic or choppy cadence',
                  },
                },
              ],
            },
          ],
          config: {
            abortSignal: AbortSignal.timeout(timeoutMs),
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: chosenVoice },
              },
            },
          },
        });

        const audioPart = response.candidates?.[0]?.content?.parts?.find((p) => Boolean(p.inlineData?.data));
        base64Audio = audioPart?.inlineData?.data || null;
        if (base64Audio) break;
      } catch (ttsErr) {
        lastError = ttsErr;
        console.warn(`[Nova AI TTS ${ttsModel} fallback]:`, ttsErr);
      }
    }

    return { audioBase64: base64Audio, lastError };
  };

  // Pipelined short-sentence synthesis so sentence N+1 generates while sentence N plays/streams
  const streamPipelinedSentencesTts = async (
    ai: GoogleGenAI,
    sentences: string[],
    voiceName: string | undefined,
    writeNdjson: (payload: Record<string, unknown>) => void,
    isAborted: () => boolean
  ): Promise<boolean> => {
    const total = sentences.length;
    if (total === 0) return false;

    const inflight = new Map<number, Promise<{ audioBase64: string | null; lastError: unknown }>>();
    const enqueue = (idx: number) => {
      if (idx < total && !inflight.has(idx) && !isAborted()) {
        inflight.set(idx, generateNaturalArabicTts(ai, sentences[idx], voiceName, 18000));
      }
    };

    // Prime the first two sentences in parallel immediately for low-latency pre-buffering
    enqueue(0);
    enqueue(1);

    let emittedAnyAudio = false;
    for (let i = 0; i < total; i++) {
      if (isAborted()) break;
      enqueue(i + 1);
      enqueue(i + 2);
      const result = await inflight.get(i);
      inflight.delete(i);
      if (isAborted()) break;

      if (result?.audioBase64) {
        emittedAnyAudio = true;
        writeNdjson({
          type: 'audio_chunk',
          index: i,
          sentenceCount: total,
          text: sentences[i],
          audioBase64: result.audioBase64,
          mimeType: 'audio/wav',
        });
      }
    }
    return emittedAnyAudio;
  };

  // 3. Text-to-Speech Endpoint for Listening to Nova AI Replies (Supports unary JSON & pipelined NDJSON stream)
  app.post('/api/nova/tts', async (req: AuthedRequest, res: Response) => {
    let isStreamingStarted = false;
    let clientDisconnected = false;

    try {
      const { text, voiceName = 'Zephyr', stream = false } = req.body as {
        text?: string;
        voiceName?: string;
        stream?: boolean;
      };

      const cleanText = prepareArabicSpeechText(text, 1800);
      if (!cleanText) {
        res.status(400).json({ error: 'النص فارغ ولا يمكن قراءته.' });
        return;
      }

      const ai = getAiClient();

      if (stream) {
        res.status(200);
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        isStreamingStarted = true;
        res.on('close', () => {
          if (!res.writableEnded) clientDisconnected = true;
        });

        const writeNdjson = (payload: Record<string, unknown>) => {
          if (!clientDisconnected && !res.writableEnded) {
            res.write(`${JSON.stringify(payload)}\n`);
          }
        };

        const sentences = splitArabicSpeechSentences(cleanText, 105, 28);
        const safeSentences = sentences.length > 0 ? sentences : [cleanText];
        writeNdjson({ type: 'meta', sentenceCount: safeSentences.length, cleanText });

        const ok = await streamPipelinedSentencesTts(
          ai,
          safeSentences,
          voiceName,
          writeNdjson,
          () => clientDisconnected || res.writableEnded
        );

        if (!clientDisconnected && !res.writableEnded) {
          if (!ok) {
            writeNdjson({ type: 'error', error: 'تعذر توليد الصوت حاليًا.' });
          } else {
            writeNdjson({ type: 'done', sentenceCount: safeSentences.length });
          }
          res.end();
        }
        return;
      }

      const { audioBase64, lastError } = await generateNaturalArabicTts(ai, cleanText, voiceName, 24000);

      if (!audioBase64) {
        if (lastError) throw lastError;
        res.status(502).json({ error: 'تعذر توليد الصوت حاليًا.' });
        return;
      }

      res.json({ audioBase64, mimeType: 'audio/wav' });
    } catch (err) {
      console.error('[Nova AI TTS Error]:', err);
      const mapped = mapGeminiError(err);
      if (isStreamingStarted) {
        if (!clientDisconnected && !res.writableEnded) {
          res.write(`${JSON.stringify({ type: 'error', error: mapped.message })}\n`);
          res.end();
        }
        return;
      }
      res.status(mapped.status).json({ error: mapped.message, requiresPaidKey: mapped.requiresPaidKey });
    }
  });

  // 4. Turn-Based Voice Conversation Endpoint (Hands-Free Auto-VAD Audio -> Transcript + Reply + Pipelined Human Audio)
  app.post('/api/nova/voice-turn', async (req: AuthedRequest, res: Response) => {
    let isStreamingStarted = false;
    let clientDisconnected = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    try {
      const {
        audioBase64,
        mimeType = 'audio/wav',
        history = [],
        customInstruction,
        voiceName = 'Zephyr',
        stream = false,
      } = req.body as {
        audioBase64?: string;
        mimeType?: string;
        history?: Array<{ role: 'user' | 'assistant'; content: string }>;
        customInstruction?: string;
        voiceName?: string;
        stream?: boolean;
      };

      const rawBaseMime =
        typeof mimeType === 'string' ? mimeType.split(';')[0].trim().toLowerCase() : 'audio/wav';
      const normalizedAudioMime = rawBaseMime === 'audio/x-m4a' ? 'audio/mp4' : rawBaseMime;
      const ALLOWED_AUDIO_MIMES = new Set([
        'audio/webm',
        'audio/mp4',
        'audio/ogg',
        'audio/wav',
        'audio/mpeg',
        'audio/aac',
      ]);

      if (
        !audioBase64 ||
        typeof audioBase64 !== 'string' ||
        audioBase64.length > 6_000_000 ||
        !ALLOWED_AUDIO_MIMES.has(normalizedAudioMime)
      ) {
        res.status(400).json({ error: 'الصيغة الصوتية غير صالحة أو يتجاوز التسجيل الحد المسموح.' });
        return;
      }

      const ai = getAiClient();
      const safeHistory = Array.isArray(history)
        ? history
            .filter((h) => h && typeof h.content === 'string')
            .slice(-6)
            .map((h) => `${h.role === 'assistant' ? 'نوفا' : 'المستخدم'}: ${sanitizeTextInput(h.content, 600)}`)
            .join('\n')
        : '';

      const cleanCustomInstruction = sanitizeTextInput(customInstruction, 1000);
      const systemInstruction = [
        'أنت «نوفا» في محادثة صوتية إنسانية دافئة وطبيعية باللغة العربية فقط.',
        'قواعد صارمة:',
        '- استمع بدقة إلى التسجيل الصوتي للمستخدم، واكتب النص العربي الدقيق لما قاله في حقل userTranscript.',
        '- إذا كان التسجيل مجرد صمت أو ضوضاء عابرة بلا أي كلام بشري واضح، اجعل noSpeechDetected يساوي true واجعل userTranscript وreplyText فارغين.',
        '- إذا تحدّث المستخدم (مثل «السلام عليكم» أو أي سؤال)، اجعل noSpeechDetected يساوي false وأجب عليه بلغة عربية طبيعية سلسة ودافئة وواضحة تمامًا كمتحدث بشري في حقل replyText.',
        '- عند رد التحية مثل «السلام عليكم»، أجب بدفء ووضوح مثل: «وعليكم السلام ورحمة الله وبركاته، أهلاً بك! كيف أقدر أساعدك اليوم؟».',
        '- قسّم replyText إلى جمل عربية قصيرة وواضحة ومرتبطة بانسيابية، مع استخدام الفواصل «،» والنقاط «.» لوقفات تنفس طبيعية، واكتب الأرقام البسيطة بالكلمات العربية، وتجنّب تمامًا النجوم أو الرموز أو التعداد النقطي.',
        cleanCustomInstruction ? `تعليمات المستخدم الشخصية:\n${cleanCustomInstruction}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const promptText = safeHistory
        ? `سياق الحوار السابق:\n${safeHistory}\n\nاستمع للصوت المرفق وأجب بصيغة JSON.`
        : 'استمع للصوت المرفق وأجب بصيغة JSON.';

      const writeNdjson = (payload: Record<string, unknown>) => {
        if (!clientDisconnected && !res.writableEnded) {
          res.write(`${JSON.stringify(payload)}\n`);
        }
      };

      if (stream) {
        res.status(200);
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        isStreamingStarted = true;
        res.on('close', () => {
          if (!res.writableEnded) {
            clientDisconnected = true;
            stopHeartbeat();
          }
        });
        heartbeatTimer = setInterval(() => {
          writeNdjson({ type: 'ping' });
        }, 4000);
      }

      const turnModels: Array<{ model: string; level: ThinkingLevel }> = [
        { model: 'gemini-3.1-flash-lite', level: ThinkingLevel.MINIMAL },
        { model: 'gemini-4-hydrogen', level: ThinkingLevel.LOW },
      ];

      let userTranscript = '';
      let replyText = '';
      let noSpeechDetected = false;
      let lastError: unknown;

      for (const item of turnModels) {
        if (clientDisconnected) break;
        try {
          const response = await ai.models.generateContent({
            model: item.model,
            contents: {
              parts: [
                { inlineData: { mimeType: normalizedAudioMime, data: audioBase64 } },
                { text: promptText },
              ],
            },
            config: {
              systemInstruction,
              thinkingConfig: { thinkingLevel: item.level },
              abortSignal: AbortSignal.timeout(25000),
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  userTranscript: { type: Type.STRING },
                  replyText: { type: Type.STRING },
                  noSpeechDetected: { type: Type.BOOLEAN },
                },
                required: ['userTranscript', 'replyText'],
              },
            },
          });

          const raw = extractGeminiText(response);
          if (!raw) continue;
          const parsed = JSON.parse(raw) as {
            userTranscript?: string;
            replyText?: string;
            noSpeechDetected?: boolean;
          };
          if (parsed.noSpeechDetected && !(parsed.userTranscript || '').trim()) {
            noSpeechDetected = true;
            userTranscript = '';
            replyText = '';
            break;
          }
          if (parsed.replyText?.trim()) {
            userTranscript = (parsed.userTranscript || '').trim();
            replyText = parsed.replyText.trim();
            break;
          }
        } catch (err) {
          lastError = err;
        }
      }

      if (noSpeechDetected) {
        stopHeartbeat();
        if (stream) {
          writeNdjson({
            type: 'transcript',
            userTranscript: '',
            replyText: '',
            noSpeechDetected: true,
            sentenceCount: 0,
          });
          writeNdjson({ type: 'done', sentenceCount: 0 });
          if (!res.writableEnded) res.end();
          return;
        }
        res.json({
          userTranscript: '',
          replyText: '',
          noSpeechDetected: true,
          audioBase64: null,
          mimeType: null,
        });
        return;
      }

      if (!replyText) {
        throw lastError ?? new Error('EMPTY_VOICE_REPLY');
      }

      if (stream) {
        const cleanSpeechText = prepareArabicSpeechText(replyText, 1200);
        const sentences = splitArabicSpeechSentences(cleanSpeechText, 100, 26);
        const safeSentences = sentences.length > 0 ? sentences : cleanSpeechText ? [cleanSpeechText] : [];

        writeNdjson({
          type: 'transcript',
          userTranscript,
          replyText,
          noSpeechDetected: false,
          sentenceCount: safeSentences.length,
        });

        if (safeSentences.length > 0) {
          await streamPipelinedSentencesTts(
            ai,
            safeSentences,
            voiceName,
            writeNdjson,
            () => clientDisconnected || res.writableEnded
          );
        }

        stopHeartbeat();
        if (!clientDisconnected && !res.writableEnded) {
          writeNdjson({ type: 'done', sentenceCount: safeSentences.length });
          res.end();
        }
        return;
      }

      const cleanSpeechText = prepareArabicSpeechText(replyText, 1000);
      const { audioBase64: audioReplyBase64 } = cleanSpeechText
        ? await generateNaturalArabicTts(ai, cleanSpeechText, voiceName, 22000)
        : { audioBase64: null };

      res.json({
        userTranscript,
        replyText,
        noSpeechDetected: false,
        audioBase64: audioReplyBase64,
        mimeType: audioReplyBase64 ? 'audio/wav' : null,
      });
    } catch (err) {
      stopHeartbeat();
      console.error('[Nova AI Voice Turn Error]:', err);
      const mapped = mapGeminiError(err);
      if (isStreamingStarted) {
        if (!clientDisconnected && !res.writableEnded) {
          res.write(`${JSON.stringify({ type: 'error', error: mapped.message, requiresPaidKey: mapped.requiresPaidKey })}\n`);
          res.end();
        }
        return;
      }
      res.status(mapped.status).json({ error: mapped.message, requiresPaidKey: mapped.requiresPaidKey });
    }
  });

  // 5. Structured PowerPoint (.pptx) Deck Generation Endpoint
  app.post('/api/nova/generate-pptx', async (req: AuthedRequest, res: Response) => {
    try {
      const {
        topic,
        details = '',
        slideCount = 8,
        audience = 'عام',
        language = 'ar',
        stream = false,
        batchIndex = 1,
        totalBatches = 1,
        existingSlideTitles = [],
        targetDeckTitle = '',
      } = req.body as {
        topic?: string;
        details?: string;
        slideCount?: number;
        audience?: string;
        language?: 'ar' | 'en';
        stream?: boolean;
        batchIndex?: number;
        totalBatches?: number;
        existingSlideTitles?: string[];
        targetDeckTitle?: string;
      };

      const cleanTopic = sanitizeTextInput(topic, 240, false);
      if (!cleanTopic || cleanTopic.length < 2) {
        res.status(400).json({ error: 'يرجى إدخال عنوان أو موضوع العرض التقديمي.' });
        return;
      }
      const safeDetails = sanitizeTextInput(details, 6000);
      const safeAudience = sanitizeTextInput(audience, 160, false) || 'عام';
      const safeLanguage = language === 'en' ? 'en' : 'ar';

      const targetSlides = Math.min(18, Math.max(2, Number(slideCount) || 8));
      const safeTotalBatches = Math.min(4, Math.max(1, Math.round(Number(totalBatches) || 1)));
      const safeBatchIndex = Math.min(safeTotalBatches, Math.max(1, Math.round(Number(batchIndex) || 1)));
      const isFirstBatch = safeBatchIndex === 1;
      const isLastBatch = safeBatchIndex === safeTotalBatches;
      const cleanExistingTitles = Array.isArray(existingSlideTitles)
        ? existingSlideTitles
            .map((t) => sanitizeTextInput(t, 120, false))
            .filter(Boolean)
            .slice(0, 20)
        : [];
      const cleanTargetDeckTitle = sanitizeTextInput(targetDeckTitle, 160, false);
      const ai = getAiClient();

      let isStreamingStarted = false;
      let clientDisconnected = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      const cleanupHeartbeat = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };
      const writeEvent = (payload: Record<string, unknown>) => {
        if (!isStreamingStarted || clientDisconnected || res.writableEnded) return;
        res.write(`${JSON.stringify(payload)}\n`);
      };

      if (stream) {
        res.status(200);
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        isStreamingStarted = true;
        res.on('close', () => {
          if (!res.writableEnded) {
            clientDisconnected = true;
            cleanupHeartbeat();
          }
        });
        writeEvent({
          type: 'status',
          message:
            safeTotalBatches > 1
              ? `جاري بناء الجزء ${safeBatchIndex} من ${safeTotalBatches} لتسريع إنشاء العرض...`
              : 'جاري تخطيط وبناء شرائح PowerPoint...',
        });
        heartbeatTimer = setInterval(() => {
          writeEvent({ type: 'ping' });
        }, 1500);
      }

      const layoutRules: string[] = [];
      if (isFirstBatch) {
        layoutRules.push('- الشريحة الأولى في هذه الدفعة يجب أن تكون بنوع layout="title" (شريحة الغلاف).');
      } else {
        layoutRules.push('- لا تنشئ شريحة غلاف layout="title" في هذه الدفعة؛ ابدأ مباشرة بشرائح المحتوى لاستكمال العرض.');
      }
      if (isLastBatch) {
        layoutRules.push('- الشريحة الأخيرة في هذه الدفعة يجب أن تكون بنوع layout="conclusion" (الخلاصة والتوصيات).');
      } else {
        layoutRules.push('- لا تنشئ شريحة ختامية layout="conclusion" بعد؛ سيتبعها جزء آخر يستكمل العرض.');
      }

      const systemInstruction = [
        'أنت خبير تصميم عروض PowerPoint التقديمية الاحترافية في Nova AI.',
        'أنشئ محتوى عرض تقديمي متكامل ومفصل ومنظم بدقة بالغة يلتزم بكل تفصيل طلبه المستخدم.',
        safeLanguage === 'en'
          ? 'Write all slide titles, bullets, metrics, and speaker notes in crisp, executive English.'
          : 'اكتب جميع عناوين الشرائح ونقاط المحتوى والإحصائيات وملاحظات المتحدث باللغة العربية الفصحى الدقيقة والواضحة.',
        `العدد المطلوب للشرائح في هذه الدفعة هو بالضبط ${targetSlides} شريحة:`,
        ...layoutRules,
        '- نوّع الشرائح الوسطى بين "bullets" و"two-column" (للمقارنات أو المحاور المزدوجة، واملأ rightColumnTitle و rightColumnBullets بوضوح) و"metrics" (للأرقام والمؤشرات أو المعالم الأساسية في حقل metrics).',
        '- اجعل كل شريحة متوازنة ومنسقة للعرض (3 إلى 5 نقاط مركزة وغنية بالمعلومة في كل شريحة، وتجنب الفقرات الطويلة المزدحمة لضمان السرعة والوضوح).',
      ].join('\n');

      const userPrompt = [
        `موضوع العرض الرئيسي: ${cleanTopic}`,
        cleanTargetDeckTitle ? `عنوان العرض المعتمد: ${cleanTargetDeckTitle}` : '',
        safeDetails.trim() ? `التفاصيل والمحاور الدقيقة التي يريدها المستخدم:\n${safeDetails.trim()}` : '',
        `الجمهور المستهدف: ${safeAudience.trim() || 'عام'}`,
        safeTotalBatches > 1
          ? `هذه الدفعة رقم ${safeBatchIndex} من أصل ${safeTotalBatches} دفعات. أنشئ ${targetSlides} شريحة لهذه الدفعة فقط.`
          : `عدد الشرائح المطلوب: ${targetSlides}`,
        cleanExistingTitles.length > 0
          ? `عناوين الشرائح التي تم إنشاؤها بالفعل في الدفعة السابقة (تجنّب تكرارها وتابع تسلسل العرض منطقيًا):\n- ${cleanExistingTitles.join('\n- ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const extractCompletedSlidesFromJsonStream = (
        rawText: string,
        alreadyEmittedCount: number
      ): {
        deckTitle?: string;
        deckSubtitle?: string;
        newSlides: Array<{ index: number; slide: Record<string, unknown> }>;
      } => {
        const newSlides: Array<{ index: number; slide: Record<string, unknown> }> = [];
        let deckTitle: string | undefined;
        let deckSubtitle: string | undefined;

        const titleMatch = rawText.match(/"deckTitle"\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (titleMatch) {
          try {
            deckTitle = JSON.parse(`"${titleMatch[1]}"`);
          } catch {
            // ignore
          }
        }
        const subMatch = rawText.match(/"deckSubtitle"\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (subMatch) {
          try {
            deckSubtitle = JSON.parse(`"${subMatch[1]}"`);
          } catch {
            // ignore
          }
        }

        const slidesKeyIdx = rawText.indexOf('"slides"');
        if (slidesKeyIdx === -1) return { deckTitle, deckSubtitle, newSlides };
        const arrayStartIdx = rawText.indexOf('[', slidesKeyIdx);
        if (arrayStartIdx === -1) return { deckTitle, deckSubtitle, newSlides };

        let inString = false;
        let escaped = false;
        let depth = 0;
        let currentObjStart = -1;
        let slideIdx = 0;

        for (let i = arrayStartIdx + 1; i < rawText.length; i++) {
          const ch = rawText[i];
          if (inString) {
            if (escaped) {
              escaped = false;
            } else if (ch === '\\') {
              escaped = true;
            } else if (ch === '"') {
              inString = false;
            }
            continue;
          }

          if (ch === '"') {
            inString = true;
            continue;
          }

          if (ch === '{') {
            if (depth === 0) currentObjStart = i;
            depth += 1;
          } else if (ch === '}') {
            if (depth > 0) {
              depth -= 1;
              if (depth === 0 && currentObjStart !== -1) {
                const objSlice = rawText.slice(currentObjStart, i + 1);
                if (slideIdx >= alreadyEmittedCount) {
                  try {
                    const parsedObj = JSON.parse(objSlice) as Record<string, unknown>;
                    if (typeof parsedObj.title === 'string' && Array.isArray(parsedObj.bullets)) {
                      newSlides.push({ index: slideIdx, slide: parsedObj });
                    }
                  } catch {
                    // ignore incomplete/invalid fragment
                  }
                }
                slideIdx += 1;
                currentObjStart = -1;
              }
            }
          } else if (ch === ']' && depth === 0) {
            break;
          }
        }

        return { deckTitle, deckSubtitle, newSlides };
      };

      const pptxSchema = {
        type: Type.OBJECT,
        properties: {
          deckTitle: { type: Type.STRING },
          deckSubtitle: { type: Type.STRING },
          slides: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                layout: {
                  type: Type.STRING,
                  enum: ['title', 'bullets', 'two-column', 'metrics', 'conclusion'],
                },
                title: { type: Type.STRING },
                subtitle: { type: Type.STRING },
                bullets: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                rightColumnTitle: { type: Type.STRING },
                rightColumnBullets: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                metrics: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      value: { type: Type.STRING },
                    },
                    required: ['label', 'value'],
                  },
                },
                speakerNotes: { type: Type.STRING },
              },
              required: ['layout', 'title', 'bullets', 'speakerNotes'],
            },
          },
        },
        required: ['deckTitle', 'deckSubtitle', 'slides'],
      };

      const attempts: Array<{ model: string; level: ThinkingLevel; timeoutMs: number }> = [
        { model: 'gemini-3.1-flash-lite', level: ThinkingLevel.MINIMAL, timeoutMs: 26000 },
        { model: 'gemini-4-hydrogen', level: ThinkingLevel.LOW, timeoutMs: 28000 },
      ];

      let lastError: unknown;
      try {
        for (let idx = 0; idx < attempts.length; idx++) {
          if (clientDisconnected) {
            cleanupHeartbeat();
            return;
          }
          const attempt = attempts[idx];
          if (idx > 0) {
            writeEvent({ type: 'status', message: 'جاري استكمال تنسيق الشرائح...' });
          }
          try {
            let rawText = '';

            if (isStreamingStarted) {
              let emittedSlideCount = 0;
              let metaSent = false;
              const responseStream = await ai.models.generateContentStream({
                model: attempt.model,
                contents: userPrompt,
                config: {
                  systemInstruction,
                  thinkingConfig: { thinkingLevel: attempt.level },
                  abortSignal: AbortSignal.timeout(attempt.timeoutMs),
                  responseMimeType: 'application/json',
                  responseSchema: pptxSchema,
                },
              });

              for await (const chunk of responseStream) {
                if (clientDisconnected) {
                  cleanupHeartbeat();
                  return;
                }
                const chunkText = extractGeminiText(chunk);
                if (!chunkText) continue;
                rawText += chunkText;

                const extracted = extractCompletedSlidesFromJsonStream(rawText, emittedSlideCount);
                if (!metaSent && extracted.deckTitle) {
                  metaSent = true;
                  writeEvent({
                    type: 'meta',
                    deckTitle: extracted.deckTitle,
                    deckSubtitle: extracted.deckSubtitle || '',
                  });
                }
                for (const item of extracted.newSlides) {
                  emittedSlideCount = item.index + 1;
                  writeEvent({
                    type: 'slide',
                    index: item.index,
                    slide: item.slide,
                  });
                  writeEvent({
                    type: 'status',
                    message: `تم بناء الشريحة ${emittedSlideCount} من ${targetSlides}...`,
                  });
                }
              }
            } else {
              const response = await ai.models.generateContent({
                model: attempt.model,
                contents: userPrompt,
                config: {
                  systemInstruction,
                  thinkingConfig: { thinkingLevel: attempt.level },
                  abortSignal: AbortSignal.timeout(attempt.timeoutMs),
                  responseMimeType: 'application/json',
                  responseSchema: pptxSchema,
                },
              });
              rawText = extractGeminiText(response);
            }

            if (!rawText) {
              lastError = new Error('EMPTY_PPTX_RESPONSE');
              continue;
            }

            const parsed = JSON.parse(rawText) as {
              deckTitle?: string;
              deckSubtitle?: string;
              slides?: Array<Record<string, unknown>>;
            };

            if (!Array.isArray(parsed.slides) || parsed.slides.length === 0) {
              lastError = new Error('EMPTY_PPTX_SLIDES');
              continue;
            }

            const resultPayload = {
              deckTitle: (parsed.deckTitle || cleanTargetDeckTitle || cleanTopic).trim(),
              deckSubtitle: (parsed.deckSubtitle || '').trim(),
              slides: parsed.slides,
              model: attempt.model,
            };

            cleanupHeartbeat();
            if (isStreamingStarted) {
              writeEvent({ type: 'done', data: resultPayload });
              res.end();
            } else {
              res.json(resultPayload);
            }
            return;
          } catch (err) {
            lastError = err;
            if (!isRetryableError(err) && !(err instanceof SyntaxError)) {
              throw err;
            }
          }
        }

        throw lastError ?? new Error('EMPTY_PPTX_RESPONSE');
      } catch (err) {
        cleanupHeartbeat();
        console.error('[Nova AI PPTX Error]:', err);
        const mapped = mapGeminiError(err);
        if (isStreamingStarted) {
          writeEvent({ type: 'error', error: mapped.message, requiresPaidKey: mapped.requiresPaidKey });
          res.end();
        } else {
          res.status(mapped.status).json({ error: mapped.message, requiresPaidKey: mapped.requiresPaidKey });
        }
      }
    } catch (err) {
      console.error('[Nova AI PPTX Error]:', err);
      const mapped = mapGeminiError(err);
      if (!res.headersSent) {
        res.status(mapped.status).json({ error: mapped.message, requiresPaidKey: mapped.requiresPaidKey });
      }
    }
  });

  // 6. Curriculum & Electronic Library Exam Generator Endpoint (Always 4 fixed options per question)
  app.post('/api/nova/generate-exam', async (req: AuthedRequest, res: Response) => {
    try {
      const {
        curriculum = 'المناهج العُمانية (المكتبة الإلكترونية)',
        subjectGrade,
        lessonOrPages,
        lessonContent = '',
        questionCount = 5,
        difficulty = 'mixed',
        sourceUrl = '',
        stream = false,
        image,
      } = req.body as {
        curriculum?: string;
        subjectGrade?: string;
        lessonOrPages?: string;
        lessonContent?: string;
        questionCount?: number;
        difficulty?: 'mixed' | 'easy' | 'medium' | 'hard';
        sourceUrl?: string;
        stream?: boolean;
        image?: { data?: string; mimeType?: string };
      };

      const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
      const hasValidImage = Boolean(
        image &&
          typeof image.mimeType === 'string' &&
          ALLOWED_IMAGE_MIMES.has(image.mimeType) &&
          typeof image.data === 'string' &&
          image.data.length > 0 &&
          image.data.length <= 6_000_000 &&
          /^[A-Za-z0-9+/=\s]+$/.test(image.data.slice(0, 200))
      );

      if (image && !hasValidImage) {
        res.status(400).json({ error: 'صيغة صورة صفحة الدرس غير صالحة أو تتجاوز الحد المسموح.' });
        return;
      }

      const cleanCurriculum =
        sanitizeTextInput(curriculum, 160, false) || 'المناهج العُمانية (المكتبة الإلكترونية)';
      const cleanSubjectGrade = sanitizeTextInput(subjectGrade, 180, false);
      const cleanLessonOrPages = sanitizeTextInput(lessonOrPages, 800);
      const cleanLessonContent = sanitizeTextInput(lessonContent, 8000);

      if (cleanSubjectGrade.length < 2) {
        res.status(400).json({ error: 'يرجى تحديد المادة والصف الدراسي (مثال: رياضيات - الصف التاسع).' });
        return;
      }
      if (cleanLessonOrPages.length < 2) {
        res.status(400).json({ error: 'يرجى تحديد اسم الدرس أو أرقام الصفحات المطلوب الاختبار منها.' });
        return;
      }

      const targetCount = Math.min(25, Math.max(3, Math.round(Number(questionCount) || 5)));
      const difficultyMap: Record<string, string> = {
        mixed: 'متنوع (يتدرج من الفهم المباشر إلى التطبيق والتحليل)',
        easy: 'أساسي ومباشر لقياس الفهم الأساسي للدرس',
        medium: 'متوسط يجمع بين الفهم والتطبيق',
        hard: 'متقدم وتحدي لقياس المهارات العليا وحل المشكلات',
      };
      const safeDifficultyKey =
        difficulty === 'easy' || difficulty === 'medium' || difficulty === 'hard' ? difficulty : 'mixed';
      const difficultyLabel = difficultyMap[safeDifficultyKey];

      let safeSourceUrl = '';
      if (typeof sourceUrl === 'string' && sourceUrl.trim().length > 0) {
        const validated = isSafeExternalUrl(sourceUrl);
        if (!validated) {
          res.status(400).json({ error: 'رابط الكتاب أو المكتبة الإلكترونية غير صالح.' });
          return;
        }
        safeSourceUrl = validated.slice(0, 500);
      }

      const ai = getAiClient();

      let isStreamingStarted = false;
      let clientDisconnected = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      const cleanupHeartbeat = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };
      const writeEvent = (payload: Record<string, unknown>) => {
        if (!isStreamingStarted || clientDisconnected || res.writableEnded) return;
        res.write(`${JSON.stringify(payload)}\n`);
      };

      if (stream) {
        res.status(200);
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        isStreamingStarted = true;
        res.on('close', () => {
          if (!res.writableEnded) {
            clientDisconnected = true;
            cleanupHeartbeat();
          }
        });
        writeEvent({
          type: 'status',
          message: hasValidImage
            ? 'جاري قراءة صفحة الدرس من الصورة المرفقة وبناء الاختبار...'
            : 'جاري التحقق من محتوى الدرس في المكتبة الإلكترونية والكتاب المدرسي...',
        });
        heartbeatTimer = setInterval(() => {
          writeEvent({ type: 'ping' });
        }, 1500);
      }

      try {
        const bookSources: Array<{ title: string; url: string }> = [];
        const seenSourceUrls = new Set<string>();
        let groundedLessonNotes = '';
        let directUrlText = '';
        let directUrlWasUnreadable = false;
        const hasVerifiedUserText = cleanLessonContent.length >= 40 || hasValidImage;

        if (!hasVerifiedUserText) {
          if (safeSourceUrl) {
            try {
              const pageRes = await fetch(safeSourceUrl, {
                redirect: 'follow',
                headers: { 'User-Agent': 'NovaAI-CurriculumVerifier/1.0' },
                signal: AbortSignal.timeout(6500),
              });
              const cType = (pageRes.headers.get('content-type') || '').toLowerCase();
              if (pageRes.ok && (cType.includes('text/html') || cType.includes('text/plain'))) {
                const rawHtml = (await pageRes.text()).slice(0, 120000);
                const stripped = rawHtml
                  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
                  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                  .replace(/<[^>]+>/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .slice(0, 5000);
                if (stripped.length >= 120) {
                  directUrlText = stripped;
                } else {
                  directUrlWasUnreadable = true;
                }
              } else {
                directUrlWasUnreadable = true;
              }
            } catch {
              directUrlWasUnreadable = true;
            }
          }

          try {
            const searchTools: Array<Record<string, unknown>> = [{ googleSearch: {} }];
            if (safeSourceUrl) {
              searchTools.push({ urlContext: {} });
            }

            const searchPrompt = [
              'تحقق أولاً هل يتوفر محتوى حقيقي وموثوق لهذا الدرس والصفحات المطلوبة في المكتبة الإلكترونية أو المصادر التعليمية المعتمدة أو الرابط المرفق:',
              `- المنهج / المكتبة: ${cleanCurriculum}`,
              `- المادة والصف: ${cleanSubjectGrade}`,
              `- الدرس أو أرقام الصفحات المطلوبة: ${cleanLessonOrPages}`,
              safeSourceUrl ? `- رابط الكتاب أو الصفحة المحددة من المستخدم: ${safeSourceUrl}` : '',
              '',
              'تعليمات صارمة جدًا:',
              '1. إذا لم تجد نصًا حقيقيًا وموثوقًا يخص هذا الدرس أو الصفحات المحددة في نتائج البحث أو الرابط المرفق (أو كان ملفًا/بوابة لا يمكن قراءتها)، فاكتب في السطر الأول حرفيًا: LIBRARY_STATUS: NOT_FOUND ولا تخترع أو تخمن محتوى غير موجود.',
              '2. فقط إذا وجدت محتوى فعليًا ومؤكدًا للدرس من المكتبة أو الكتاب المدرسي، اكتب في السطر الأول حرفيًا: LIBRARY_STATUS: FOUND ثم استخرج ملخصًا تعليميًا دقيقًا يتضمن عنوان الوحدة والدرس والمفاهيم والقوانين والأمثلة ونقاط التقويم الموجودة في المصدر.',
            ]
              .filter(Boolean)
              .join('\n');

            const groundingRes = await ai.models.generateContent({
              model: 'gemini-4-hydrogen',
              contents: searchPrompt,
              config: {
                tools: searchTools as never,
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                abortSignal: AbortSignal.timeout(12000),
              },
            });

            groundedLessonNotes = extractGeminiText(groundingRes).slice(0, 6500);

            const metadata = groundingRes.candidates?.[0]?.groundingMetadata as
              | { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> }
              | undefined;
            if (Array.isArray(metadata?.groundingChunks)) {
              for (const chunk of metadata.groundingChunks) {
                const rawUri = chunk.web?.uri?.trim();
                if (!rawUri) continue;
                const safeUri = isSafeExternalUrl(rawUri);
                if (!safeUri || seenSourceUrls.has(safeUri)) continue;
                seenSourceUrls.add(safeUri);
                bookSources.push({
                  title: sanitizeTextInput(chunk.web?.title || 'مصدر من المكتبة الإلكترونية', 140, false),
                  url: safeUri,
                });
                if (bookSources.length >= 6) break;
              }
            }
          } catch (groundingErr) {
            console.warn('[Nova AI Exam Grounding fallback]:', groundingErr);
          }

          if (clientDisconnected) {
            cleanupHeartbeat();
            return;
          }

          const explicitNotFound = /^LIBRARY_STATUS:\s*NOT_FOUND/i.test(groundedLessonNotes);
          const cleanedGroundedBody = groundedLessonNotes
            .replace(/^LIBRARY_STATUS:\s*(FOUND|NOT_FOUND)\s*/i, '')
            .trim();
          const modelReportsFailure =
            /^(تعذر|لم أتمكن|لا يمكن|غير متاح|لا يتوفر محتوى)/i.test(cleanedGroundedBody) &&
            bookSources.length === 0 &&
            directUrlText.length < 120;

          const hasReadableSource =
            directUrlText.length >= 120 ||
            (!explicitNotFound &&
              !modelReportsFailure &&
              bookSources.length > 0 &&
              cleanedGroundedBody.length >= 120);

          if (!hasReadableSource) {
            cleanupHeartbeat();
            const unableMsg = safeSourceUrl && directUrlWasUnreadable
              ? 'لم يتمكن النظام من قراءة محتوى الدرس من الرابط المرفق أو من المكتبة الإلكترونية (قد يكون الرابط ملف PDF محميًا أو يتطلب تسجيل دخول)، ولذلك لم نختلق أسئلة غير موثقة. يمكنك لصق نص الدرس في الحقل المخصص أدناه لإنشاء الاختبار بدقة.'
              : 'لم يتمكن النظام من العثور على محتوى هذا الدرس أو الصفحات المحددة وقراءته فعليًا من المكتبة الإلكترونية، ولذلك تم إيقاف التوليد بدل اختلاق أسئلة غير دقيقة. يمكنك لصق نص الدرس أو إضافة رابط مباشر لصفحة الدرس والمحاولة مجددًا.';
            if (isStreamingStarted) {
              writeEvent({ type: 'error', error: unableMsg, code: 'LIBRARY_CONTENT_UNAVAILABLE' });
              res.end();
            } else {
              res.status(422).json({ error: unableMsg, code: 'LIBRARY_CONTENT_UNAVAILABLE' });
            }
            return;
          }

          groundedLessonNotes = [directUrlText, cleanedGroundedBody].filter(Boolean).join('\n\n').slice(0, 6500);
        } else {
          groundedLessonNotes = cleanLessonContent;
        }

        if (safeSourceUrl && !seenSourceUrls.has(safeSourceUrl)) {
          bookSources.unshift({ title: 'الرابط المرجعي المحدد للكتاب', url: safeSourceUrl });
        }

        writeEvent({ type: 'status', message: `جاري صياغة ${targetCount} سؤالًا بأربعة خيارات ثابتة...` });

        // Step 2: Generate Strict Structured Multiple-Choice Exam (Exact targetCount & 4 fixed options per question)
        const examSystemInstruction = [
          'أنت خبير تربوي ومصمم اختبارات مدرسية معتمدة على المناهج الدراسية والمكتبة الإلكترونية في Nova AI.',
          'مهمتك إعداد اختبار اختيار من متعدد دقيق وعلمي ومستند حصريًا إلى محتوى الدرس المسترجع أو النص أو الصورة المرفقة أدناه.',
          'قواعد صارمة لا يجوز مخالفتها:',
          `1. أنشئ بالضبط ${targetCount} سؤالًا (questions.length = ${targetCount}) دون زيادة أو نقصان.`,
          '2. لكل سؤال أربعة خيارات ثابتة بالضبط (options.length = 4) مع فهرس الإجابة الصحيحة correctIndex بين 0 و 3.',
          '3. لا تكتب رموز الخيارات (مثل أ- أو 1. أو A)) داخل نص الخيار لأن الواجهة تعرض الرموز (أ، ب، ج، د) تلقائيًا.',
          '4. اجعل الخيارات الأربعة متقاربة في الطول ومنطقية وواضحة دون بديهية زائدة أو تلميح واضح للإجابة.',
          '5. اكتب الصيغ الرياضية والعلمية بعربية سليمة ورموز واضحة قابلة للقراءة المباشرة (مثل س²، √، ×، ÷، °) دون رموز LaTeX معقدة مثل $ أو \\frac.',
          '6. لكل سؤال أضف شرحًا موجزًا للإجابة الصحيحة (explanation) ومرجع الدرس/الصفحة في الكتاب (lessonRef).',
        ].join('\n');

        const examUserPrompt = [
          `المنهج / المكتبة الإلكترونية: ${cleanCurriculum}`,
          `المادة والصف: ${cleanSubjectGrade}`,
          `الدرس / أرقام الصفحات المطلوبة: ${cleanLessonOrPages}`,
          `مستوى الصعوبة المطلوب: ${difficultyLabel}`,
          `عدد الأسئلة المطلوب بالضبط: ${targetCount} سؤالًا`,
          groundedLessonNotes
            ? `\nمحتوى الدرس الموثق الذي يجب الاعتماد عليه في صياغة الأسئلة:\n${groundedLessonNotes}`
            : '\nاعتمد بدقة على المحتوى الظاهر في صورة صفحة الدرس المرفقة لصياغة الأسئلة.',
        ].join('\n');

        const examParts: ChatContentPart[] = [];
        if (hasValidImage && image?.data && image?.mimeType) {
          examParts.push({ inlineData: { data: image.data, mimeType: image.mimeType } });
        }
        examParts.push({ text: examUserPrompt });

        const attempts: Array<{ model: string; level: ThinkingLevel; timeoutMs: number }> = hasValidImage
          ? [
              { model: 'gemini-4-hydrogen', level: ThinkingLevel.LOW, timeoutMs: 26000 },
              { model: 'gemini-3.1-flash-lite', level: ThinkingLevel.MEDIUM, timeoutMs: 26000 },
            ]
          : [
              { model: 'gemini-3.1-flash-lite', level: ThinkingLevel.LOW, timeoutMs: 24000 },
              { model: 'gemini-4-hydrogen', level: ThinkingLevel.LOW, timeoutMs: 26000 },
            ];

        let lastError: unknown;
        for (let idx = 0; idx < attempts.length; idx++) {
          if (clientDisconnected) {
            cleanupHeartbeat();
            return;
          }
          const attempt = attempts[idx];
          if (idx > 0) {
            writeEvent({ type: 'status', message: 'جاري مراجعة وتنسيق أسئلة الاختبار...' });
          }
          try {
            const response = await ai.models.generateContent({
              model: attempt.model,
              contents: [{ role: 'user', parts: examParts }],
              config: {
                systemInstruction: examSystemInstruction,
                thinkingConfig: { thinkingLevel: attempt.level },
                abortSignal: AbortSignal.timeout(attempt.timeoutMs),
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    examTitle: { type: Type.STRING },
                    curriculum: { type: Type.STRING },
                    subjectGrade: { type: Type.STRING },
                    lessonSummary: { type: Type.STRING },
                    questions: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          question: { type: Type.STRING },
                          options: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                          },
                          correctIndex: { type: Type.INTEGER },
                          explanation: { type: Type.STRING },
                          lessonRef: { type: Type.STRING },
                        },
                        required: ['question', 'options', 'correctIndex', 'explanation', 'lessonRef'],
                      },
                    },
                  },
                  required: ['examTitle', 'curriculum', 'subjectGrade', 'lessonSummary', 'questions'],
                },
              },
            });

            const rawText = extractGeminiText(response);
            if (!rawText) {
              lastError = new Error('EMPTY_EXAM_RESPONSE');
              continue;
            }

            const parsed = JSON.parse(rawText) as {
              examTitle?: string;
              curriculum?: string;
              subjectGrade?: string;
              lessonSummary?: string;
              questions?: Array<{
                question?: string;
                options?: unknown[];
                correctIndex?: number;
                explanation?: string;
                lessonRef?: string;
              }>;
            };

            const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
            if (rawQuestions.length < targetCount && attempt !== attempts[attempts.length - 1]) {
              lastError = new Error('INSUFFICIENT_EXAM_QUESTIONS');
              continue;
            }
            if (rawQuestions.length === 0) {
              lastError = new Error('EMPTY_EXAM_QUESTIONS');
              continue;
            }

            const normalizedQuestions = rawQuestions.slice(0, targetCount).map((q, qIdx) => {
              const cleanPrompt =
                typeof q.question === 'string' && q.question.trim()
                  ? q.question.trim()
                  : `السؤال رقم ${qIdx + 1} حول ${cleanLessonOrPages}`;

              const rawOpts = Array.isArray(q.options)
                ? q.options
                    .map((o) =>
                      String(o ?? '')
                        .replace(/^\s*(?:[أبجدهـABCD]|[1-4])\s*[-.)،:]\s*/i, '')
                        .trim()
                    )
                    .filter(Boolean)
                : [];

              while (rawOpts.length < 4) {
                rawOpts.push(`خيار إضافي ${rawOpts.length + 1}`);
              }
              const fixedOptions = rawOpts.slice(0, 4);
              const rawCorrect = Number(q.correctIndex);
              const safeCorrectIndex =
                Number.isInteger(rawCorrect) && rawCorrect >= 0 && rawCorrect <= 3 ? rawCorrect : 0;

              return {
                question: cleanPrompt,
                options: fixedOptions,
                correctIndex: safeCorrectIndex,
                explanation:
                  typeof q.explanation === 'string' && q.explanation.trim()
                    ? q.explanation.trim()
                    : 'راجع المفاهيم والأمثلة الواردة في الدرس المحدد للتحقق من خطوات الحل.',
                lessonRef:
                  typeof q.lessonRef === 'string' && q.lessonRef.trim()
                    ? q.lessonRef.trim()
                    : cleanLessonOrPages,
              };
            });

            const resultPayload = {
              examTitle: (parsed.examTitle || `اختبار ${cleanSubjectGrade} — ${cleanLessonOrPages}`).trim(),
              curriculum: (parsed.curriculum || cleanCurriculum).trim(),
              subjectGrade: (parsed.subjectGrade || cleanSubjectGrade).trim(),
              lessonSummary: (
                parsed.lessonSummary ||
                `يغطي هذا الاختبار المفاهيم الأساسية والتطبيقات الواردة في (${cleanLessonOrPages}) لمادة ${cleanSubjectGrade}.`
              ).trim(),
              questions: normalizedQuestions,
              bookSources,
              model: attempt.model,
            };

            cleanupHeartbeat();
            if (isStreamingStarted) {
              writeEvent({ type: 'done', data: resultPayload });
              res.end();
            } else {
              res.json(resultPayload);
            }
            return;
          } catch (err) {
            lastError = err;
            if (!isRetryableError(err) && !(err instanceof SyntaxError)) {
              throw err;
            }
          }
        }

        throw lastError ?? new Error('EMPTY_EXAM_RESPONSE');
      } catch (err) {
        cleanupHeartbeat();
        console.error('[Nova AI Exam Error]:', err);
        const mapped = mapGeminiError(err);
        if (isStreamingStarted) {
          writeEvent({ type: 'error', error: mapped.message, requiresPaidKey: mapped.requiresPaidKey });
          res.end();
        } else {
          res.status(mapped.status).json({ error: mapped.message, requiresPaidKey: mapped.requiresPaidKey });
        }
      }
    } catch (err) {
      console.error('[Nova AI Exam Error]:', err);
      const mapped = mapGeminiError(err);
      if (!res.headersSent) {
        res.status(mapped.status).json({ error: mapped.message, requiresPaidKey: mapped.requiresPaidKey });
      }
    }
  });

  // 7. Lesson Summarization Endpoint (Text or Lesson Image -> Clear Arabic Bullet Points)
  app.post('/api/nova/summarize-lesson', async (req: AuthedRequest, res: Response) => {
    try {
      const { lessonText = '', subject = '', topic = '', image } = req.body as {
        lessonText?: string;
        subject?: string;
        topic?: string;
        image?: { data?: string; mimeType?: string };
      };

      const cleanText = sanitizeTextInput(lessonText, 20000);
      const cleanSubject = sanitizeTextInput(subject, 120, false);
      const cleanTopic = sanitizeTextInput(topic, 240, false);
      const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
      const hasValidImage = Boolean(
        image &&
          typeof image.mimeType === 'string' &&
          ALLOWED_IMAGE_MIMES.has(image.mimeType) &&
          typeof image.data === 'string' &&
          image.data.length > 0 &&
          image.data.length <= 6_000_000 &&
          /^[A-Za-z0-9+/=\s]+$/.test(image.data.slice(0, 200))
      );

      if (image && !hasValidImage) {
        res.status(400).json({ error: 'صيغة صورة الدرس غير صالحة أو تتجاوز الحد المسموح.' });
        return;
      }

      if (!hasValidImage && cleanText.length < 15 && cleanTopic.length < 3) {
        res.status(400).json({ error: 'يرجى كتابة نص الدرس (15 حرفًا على الأقل) أو تحديد اسم الدرس أو إرفاق صورة للدرس.' });
        return;
      }

      const isTopicOnlyMode = !hasValidImage && cleanText.length < 15 && cleanTopic.length >= 3;
      const ai = getAiClient();
      const parts: ChatContentPart[] = [];
      if (hasValidImage && image?.data && image?.mimeType) {
        parts.push({ inlineData: { data: image.data, mimeType: image.mimeType } });
      }
      parts.push({
        text: [
          cleanSubject ? `المادة / الموضوع: ${cleanSubject}` : '',
          cleanText
            ? `نص الدرس المطلوب تلخيصه:\n${cleanText}`
            : cleanTopic
              ? `اسم الدرس المطلوب تلخيصه:\n${cleanTopic}`
              : 'اقرأ محتوى الدرس الظاهر في الصورة بدقة عالية ثم لخّصه في نقاط عربية واضحة ومنظمة.',
        ]
          .filter(Boolean)
          .join('\n\n'),
      });

      const systemInstruction = [
        'أنت خبير تربوي ومساعد تلخيص دراسي في منصة Nova AI.',
        'لخّص الدرس المرفق باللغة العربية الفصحى الواضحة.',
        'قواعد مهمة:',
        isTopicOnlyMode
          ? '1. قدّم ملخصًا علميًا دقيقًا ومرتبًا يغطي المفاهيم والقوانين الأساسية في الدرس المطلوب بأسلوب دراسي واضح وموثوق.'
          : '1. التزم فقط بالمعلومات الواردة في الدرس أو الصورة دون اختلاق حقائق من خارجها.',
        '2. قدّم title مختصرًا ومعبرًا، وoverview موجزة في جملتين، و5 إلى 10 نقاط رئيسية مرتبة وواضحة في bulletPoints.',
        '3. استخرج أهم المصطلحات أو القوانين أو التواريخ في keyTerms (من 2 إلى 6 عناصر).',
      ].join('\n');

      const attempts: Array<{ model: string; level: ThinkingLevel; timeoutMs: number }> = [
        { model: hasValidImage || isTopicOnlyMode ? 'gemini-4-hydrogen' : 'gemini-3.1-flash-lite', level: hasValidImage || isTopicOnlyMode ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL, timeoutMs: 25000 },
        { model: 'gemini-4-hydrogen', level: ThinkingLevel.LOW, timeoutMs: 28000 },
      ];

      let lastError: unknown;
      for (const attempt of attempts) {
        try {
          const response = await ai.models.generateContent({
            model: attempt.model,
            contents: [{ role: 'user', parts }],
            config: {
              systemInstruction,
              thinkingConfig: { thinkingLevel: attempt.level },
              abortSignal: AbortSignal.timeout(attempt.timeoutMs),
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  subject: { type: Type.STRING },
                  overview: { type: Type.STRING },
                  bulletPoints: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  keyTerms: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        term: { type: Type.STRING },
                        definition: { type: Type.STRING },
                      },
                      required: ['term', 'definition'],
                    },
                  },
                },
                required: ['title', 'subject', 'overview', 'bulletPoints', 'keyTerms'],
              },
            },
          });

          const rawText = extractGeminiText(response);
          if (!rawText) {
            lastError = new Error('EMPTY_SUMMARY_REPLY');
            continue;
          }
          const parsed = JSON.parse(rawText) as {
            title?: string;
            subject?: string;
            overview?: string;
            bulletPoints?: unknown[];
            keyTerms?: Array<{ term?: string; definition?: string }>;
          };

          const bullets = Array.isArray(parsed.bulletPoints)
            ? parsed.bulletPoints.map((b) => String(b ?? '').trim()).filter(Boolean).slice(0, 12)
            : [];
          if (bullets.length === 0) {
            lastError = new Error('EMPTY_SUMMARY_BULLETS');
            continue;
          }

          const keyTerms = Array.isArray(parsed.keyTerms)
            ? parsed.keyTerms
                .map((kt) => ({
                  term: String(kt?.term ?? '').trim(),
                  definition: String(kt?.definition ?? '').trim(),
                }))
                .filter((kt) => kt.term && kt.definition)
                .slice(0, 8)
            : [];

          res.json({
            title: (parsed.title || cleanSubject || 'ملخص الدرس').trim().slice(0, 150),
            subject: (parsed.subject || cleanSubject || 'مادة دراسية').trim().slice(0, 120),
            overview: (parsed.overview || '').trim().slice(0, 1000),
            bulletPoints: bullets,
            keyTerms,
            model: attempt.model,
          });
          return;
        } catch (err) {
          lastError = err;
          if (!isRetryableError(err) && !(err instanceof SyntaxError)) {
            throw err;
          }
        }
      }

      throw lastError ?? new Error('EMPTY_SUMMARY_REPLY');
    } catch (err) {
      console.error('[Nova AI Summarize Lesson Error]:', err);
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message, requiresPaidKey: mapped.requiresPaidKey });
    }
  });

  // 8. Study Flashcards Generator Endpoint (Lesson Content/Image -> Interactive Q&A Cards)
  app.post('/api/nova/generate-flashcards', async (req: AuthedRequest, res: Response) => {
    try {
      const { lessonText = '', subject = '', topic = '', count = 8, image } = req.body as {
        lessonText?: string;
        subject?: string;
        topic?: string;
        count?: number;
        image?: { data?: string; mimeType?: string };
      };

      const cleanText = sanitizeTextInput(lessonText, 20000);
      const cleanSubject = sanitizeTextInput(subject, 120, false);
      const cleanTopic = sanitizeTextInput(topic, 240, false);
      const targetCards = Math.min(15, Math.max(4, Math.round(Number(count) || 8)));
      const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
      const hasValidImage = Boolean(
        image &&
          typeof image.mimeType === 'string' &&
          ALLOWED_IMAGE_MIMES.has(image.mimeType) &&
          typeof image.data === 'string' &&
          image.data.length > 0 &&
          image.data.length <= 6_000_000 &&
          /^[A-Za-z0-9+/=\s]+$/.test(image.data.slice(0, 200))
      );

      if (image && !hasValidImage) {
        res.status(400).json({ error: 'صيغة صورة الدرس غير صالحة أو تتجاوز الحد المسموح.' });
        return;
      }

      if (!hasValidImage && cleanText.length < 15 && cleanTopic.length < 3) {
        res.status(400).json({ error: 'يرجى إدخال نص الدرس (15 حرفًا على الأقل) أو تحديد اسم الدرس أو إرفاق صورة للدرس لتوليد البطاقات.' });
        return;
      }

      const isTopicOnlyMode = !hasValidImage && cleanText.length < 15 && cleanTopic.length >= 3;
      const ai = getAiClient();
      const parts: ChatContentPart[] = [];
      if (hasValidImage && image?.data && image?.mimeType) {
        parts.push({ inlineData: { data: image.data, mimeType: image.mimeType } });
      }
      parts.push({
        text: [
          cleanSubject ? `المادة / العنوان: ${cleanSubject}` : '',
          cleanText
            ? `أنشئ ${targetCards} بطاقة مراجعة (سؤال وجواب) للمذاكرة السريعة من محتوى الدرس التالي فقط:\n${cleanText}`
            : cleanTopic
              ? `أنشئ ${targetCards} بطاقة مراجعة (سؤال وجواب) للمذاكرة السريعة تغطي أهم نقاط ومفاهيم الدرس التالي:\n${cleanTopic}`
              : 'استخرج المحتوى الظاهر في الصورة وأنشئ بطاقات مراجعة دقيقة تغطي أهم النقاط.',
        ]
          .filter(Boolean)
          .join('\n\n'),
      });

      const systemInstruction = [
        'أنت مصمم بطاقات استذكار سريعة (Flashcards) في منصة Nova AI.',
        isTopicOnlyMode
          ? `أنشئ بالضبط ${targetCards} بطاقة سؤال وجواب علمية ودقيقة تغطي أهم مفاهيم وتفاصيل الدرس المطلوب.`
          : `أنشئ بالضبط ${targetCards} بطاقة سؤال وجواب مستخرجة مباشرة من محتوى الدرس المرفق.`,
        'اجعل السؤال في بطاقة الواجهة (question) قصيرًا وواضحًا، والإجابة (answer) مركزة ودقيقة باللغة العربية، وأضف تلميحًا مختصرًا (hint) يساعد الطالب على التذكر.',
      ].join('\n');

      const attempts: Array<{ model: string; level: ThinkingLevel; timeoutMs: number }> = [
        { model: hasValidImage || isTopicOnlyMode ? 'gemini-4-hydrogen' : 'gemini-3.1-flash-lite', level: hasValidImage || isTopicOnlyMode ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL, timeoutMs: 25000 },
        { model: 'gemini-4-hydrogen', level: ThinkingLevel.LOW, timeoutMs: 28000 },
      ];

      let lastError: unknown;
      for (const attempt of attempts) {
        try {
          const response = await ai.models.generateContent({
            model: attempt.model,
            contents: [{ role: 'user', parts }],
            config: {
              systemInstruction,
              thinkingConfig: { thinkingLevel: attempt.level },
              abortSignal: AbortSignal.timeout(attempt.timeoutMs),
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  deckTitle: { type: Type.STRING },
                  cards: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        question: { type: Type.STRING },
                        answer: { type: Type.STRING },
                        hint: { type: Type.STRING },
                      },
                      required: ['question', 'answer', 'hint'],
                    },
                  },
                },
                required: ['deckTitle', 'cards'],
              },
            },
          });

          const rawText = extractGeminiText(response);
          if (!rawText) {
            lastError = new Error('EMPTY_FLASHCARDS_REPLY');
            continue;
          }

          const parsed = JSON.parse(rawText) as {
            deckTitle?: string;
            cards?: Array<{ question?: string; answer?: string; hint?: string }>;
          };

          const cards = Array.isArray(parsed.cards)
            ? parsed.cards
                .map((c) => ({
                  question: String(c?.question ?? '').trim(),
                  answer: String(c?.answer ?? '').trim(),
                  hint: String(c?.hint ?? '').trim(),
                }))
                .filter((c) => c.question && c.answer)
                .slice(0, targetCards)
            : [];

          if (cards.length === 0) {
            lastError = new Error('EMPTY_FLASHCARDS_ARRAY');
            continue;
          }

          res.json({
            deckTitle: (parsed.deckTitle || cleanSubject || 'بطاقات مراجعة الدرس').trim().slice(0, 150),
            cards,
            model: attempt.model,
          });
          return;
        } catch (err) {
          lastError = err;
          if (!isRetryableError(err) && !(err instanceof SyntaxError)) {
            throw err;
          }
        }
      }

      throw lastError ?? new Error('EMPTY_FLASHCARDS_REPLY');
    } catch (err) {
      console.error('[Nova AI Flashcards Error]:', err);
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message, requiresPaidKey: mapped.requiresPaidKey });
    }
  });

  // 9. Guided Homework Helper Endpoint (Step-by-Step Pedagogical Guidance WITHOUT Direct Final Answer)
  app.post('/api/nova/homework-help', async (req: AuthedRequest, res: Response) => {
    try {
      const { question = '', subject = '', studentAttempt = '', image } = req.body as {
        question?: string;
        subject?: string;
        studentAttempt?: string;
        image?: { data?: string; mimeType?: string };
      };

      const cleanQuestion = sanitizeTextInput(question, 5000);
      const cleanSubject = sanitizeTextInput(subject, 120, false);
      const cleanAttempt = sanitizeTextInput(studentAttempt, 2500);

      const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
      const hasValidImage = Boolean(
        image &&
          typeof image.mimeType === 'string' &&
          ALLOWED_IMAGE_MIMES.has(image.mimeType) &&
          typeof image.data === 'string' &&
          image.data.length > 0 &&
          image.data.length <= 6_000_000 &&
          /^[A-Za-z0-9+/=\s]+$/.test(image.data.slice(0, 200))
      );

      if (image && !hasValidImage) {
        res.status(400).json({ error: 'صيغة صورة الواجب غير صالحة أو تتجاوز الحد المسموح.' });
        return;
      }

      if (!hasValidImage && cleanQuestion.length < 4) {
        res.status(400).json({ error: 'يرجى كتابة سؤال الواجب أو إرفاق صورته أولاً.' });
        return;
      }

      const ai = getAiClient();
      const parts: ChatContentPart[] = [];
      if (hasValidImage && image?.data && image?.mimeType) {
        parts.push({ inlineData: { data: image.data, mimeType: image.mimeType } });
      }
      parts.push({
        text: [
          cleanSubject ? `المادة: ${cleanSubject}` : '',
          cleanQuestion ? `سؤال الواجب:\n${cleanQuestion}` : 'اقرأ سؤال الواجب الظاهر في الصورة بدقة واشرح طريقة حله خطوة بخطوة.',
          cleanAttempt ? `محاولة الطالب أو إجابته المبدئية:\n${cleanAttempt}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      });

      const systemInstruction = [
        'أنت معلّم ومساعد واجبات تربوي صبور في منصة Nova AI.',
        'مهمتك مساعدة الطالب على فهم طريقة حل سؤال الواجب خطوة بخطوة باللغة العربية الفصحى الواضحة.',
        'القاعدة الذهبية الصارمة (ممنوع مخالفتها):',
        '- لا تُعطِ الإجابة النهائية الجاهزة أو الناتج الرقمي النهائي أو الكلمة/الاختيار النهائي الصحيح مباشرة!',
        '- بدلًا من ذلك: اشرح القاعدة أو القانون أو المفهوم المستخدم، ثم فكّك الحل إلى خطوات مرقّمة واضحة توصل الطالب إلى عتبة الخطوة الأخيرة، واترك له استنتاج الناتج النهائي بنفسه.',
        '- إذا كتب الطالب محاولة حل في studentAttempt، قيّم خطواته بلطف: اذكر ما أصاب فيه وحدد أين يحتاج للتصحيح دون كشف الحل النهائي مباشرة.',
        '- استخدم رموزًا رياضية وعلمية واضحة (س، ص، ÷، ×، ²، √) دون تعقيد.',
      ].join('\n');

      const attempts: Array<{ model: string; level: ThinkingLevel; timeoutMs: number }> = [
        { model: 'gemini-4-hydrogen', level: ThinkingLevel.LOW, timeoutMs: 26000 },
        { model: 'gemini-3.1-flash-lite', level: ThinkingLevel.MEDIUM, timeoutMs: 26000 },
      ];

      let lastError: unknown;
      for (const attempt of attempts) {
        try {
          const response = await ai.models.generateContent({
            model: attempt.model,
            contents: [{ role: 'user', parts }],
            config: {
              systemInstruction,
              thinkingConfig: { thinkingLevel: attempt.level },
              abortSignal: AbortSignal.timeout(attempt.timeoutMs),
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  concept: { type: Type.STRING },
                  steps: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  hint: { type: Type.STRING },
                  nextCheckQuestion: { type: Type.STRING },
                },
                required: ['title', 'concept', 'steps', 'hint', 'nextCheckQuestion'],
              },
            },
          });

          const rawText = extractGeminiText(response);
          if (!rawText) {
            lastError = new Error('EMPTY_HOMEWORK_REPLY');
            continue;
          }

          const parsed = JSON.parse(rawText) as {
            title?: string;
            concept?: string;
            steps?: unknown[];
            hint?: string;
            nextCheckQuestion?: string;
          };

          const steps = Array.isArray(parsed.steps)
            ? parsed.steps.map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, 10)
            : [];
          if (steps.length === 0) {
            lastError = new Error('EMPTY_HOMEWORK_STEPS');
            continue;
          }

          res.json({
            title: (parsed.title || cleanSubject || 'شرح خطوات الواجب').trim().slice(0, 150),
            concept: (parsed.concept || '').trim().slice(0, 800),
            steps,
            hint: (parsed.hint || '').trim().slice(0, 800),
            nextCheckQuestion: (parsed.nextCheckQuestion || '').trim().slice(0, 600),
            model: attempt.model,
          });
          return;
        } catch (err) {
          lastError = err;
          if (!isRetryableError(err) && !(err instanceof SyntaxError)) {
            throw err;
          }
        }
      }

      throw lastError ?? new Error('EMPTY_HOMEWORK_REPLY');
    } catch (err) {
      console.error('[Nova AI Homework Helper Error]:', err);
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message, requiresPaidKey: mapped.requiresPaidKey });
    }
  });

  // Never let any unmatched /api/* request fall through to Vite/HTML
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'مسار الخدمة المطلوب غير موجود على الخادم.' });
  });

  // Global JSON parse / payload / unexpected error sanitizer for API & serverless runtime
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const errObj = err as { type?: string; status?: number };
    if (errObj?.type === 'entity.too.large' || errObj?.status === 413) {
      res.status(413).json({ error: 'حجم البيانات المرسلة أكبر من الحد المسموح.' });
      return;
    }
    if (err instanceof SyntaxError || errObj?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'تنسيق البيانات المرسلة غير صالح.' });
      return;
    }
    console.error('[Nova AI Unexpected Server Error]:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'حدث خطأ غير متوقع في الخادم.' });
    }
  });

  return app;
}

async function startServer() {
  const app = createNovaApiApp();
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const isHmrDisabled = process.env.DISABLE_HMR === 'true';
    const devAllowedHosts = ['.run.app', '.googleusercontent.com', 'localhost', '127.0.0.1'];
    if (process.env.APP_URL) {
      try {
        devAllowedHosts.push(new URL(process.env.APP_URL).hostname);
      } catch {
        // ignore invalid APP_URL
      }
    }
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: devAllowedHosts,
        hmr: isHmrDisabled ? false : true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          const base = path.basename(filePath);
          if (
            base === 'index.html' ||
            base === 'sw.js' ||
            base === 'registerSW.js' ||
            base === 'manifest.webmanifest'
          ) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Global JSON parse / payload / unexpected error sanitizer (never leak stack traces)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const errObj = err as { type?: string; status?: number };
    if (errObj?.type === 'entity.too.large' || errObj?.status === 413) {
      res.status(413).json({ error: 'حجم البيانات المرسلة أكبر من الحد المسموح.' });
      return;
    }
    if (err instanceof SyntaxError || errObj?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'تنسيق البيانات المرسلة غير صالح.' });
      return;
    }
    console.error('[Nova AI Unexpected Server Error]:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'حدث خطأ غير متوقع في الخادم.' });
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  httpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
    try {
      const reqUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      if (reqUrl.pathname !== '/api/nova/live') {
        return;
      }
      const clientIp = getClientIp(request);
      if (!isTrustedRequestOrigin(request.headers) || isIpTemporarilyBanned(clientIp) > 0) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const ipSocketCount = wsActiveByIp.get(clientIp) ?? 0;
      if (ipSocketCount >= 10) {
        socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', async (clientWs: WebSocket, request: IncomingMessage) => {
    const clientIp = getClientIp(request);
    wsActiveByIp.set(clientIp, (wsActiveByIp.get(clientIp) ?? 0) + 1);

    let liveSession: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
    let activeUid: string | null = null;
    let isClosed = false;
    let authDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
    let wsHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let isWsAlive = true;
    let frameWindowStart = Date.now();
    let frameWindowCount = 0;

    clientWs.on('pong', () => {
      isWsAlive = true;
    });

    const closeAll = () => {
      if (isClosed) return;
      isClosed = true;
      if (authDeadlineTimer) {
        clearTimeout(authDeadlineTimer);
        authDeadlineTimer = null;
      }
      if (wsHeartbeatTimer) {
        clearInterval(wsHeartbeatTimer);
        wsHeartbeatTimer = null;
      }
      const curIpCount = wsActiveByIp.get(clientIp) ?? 0;
      if (curIpCount <= 1) wsActiveByIp.delete(clientIp);
      else wsActiveByIp.set(clientIp, curIpCount - 1);

      if (activeUid) {
        const curUidCount = wsActiveByUid.get(activeUid) ?? 0;
        if (curUidCount <= 1) wsActiveByUid.delete(activeUid);
        else wsActiveByUid.set(activeUid, curUidCount - 1);
        activeUid = null;
      }
      try {
        liveSession?.close();
      } catch {
        // ignore close errors
      }
      try {
        if (clientWs.readyState === clientWs.OPEN || clientWs.readyState === clientWs.CONNECTING) {
          clientWs.close();
        }
      } catch {
        // ignore
      }
    };

    const initializeLiveBridge = async (
      idToken: string,
      otpToken: string,
      voiceParam: string,
      customInstruction: string,
      recentHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
    ) => {
      try {
        const verified = await verifyFirebaseIdToken(idToken);
        if (!verified) {
          recordAuthFailure(clientIp, '/api/nova/live');
          if (clientWs.readyState === clientWs.OPEN) {
            clientWs.send(JSON.stringify({ error: 'انتهت صلاحية جلسة التحقق. يرجى إعادة المحاولة.' }));
          }
          closeAll();
          return;
        }
        const { uid, authTime } = verified;

        if (isOtpDeliveryConfigured()) {
          if (!isRequestOtpVerified(request.headers, uid, authTime, otpToken)) {
            if (clientWs.readyState === clientWs.OPEN) {
              clientWs.send(JSON.stringify({ error: 'يجب إتمام التحقق برمز Gmail قبل فتح المحادثة الصوتية.' }));
            }
            closeAll();
            return;
          }
        }

        const quotaCheck = checkUserAiQuotas(uid, false);
        if (!quotaCheck.allowed) {
          recordSecurityEvent('rate_limit_block', clientIp, '/api/nova/live');
          if (clientWs.readyState === clientWs.OPEN) {
            clientWs.send(JSON.stringify({ error: quotaCheck.reason || 'تم تجاوز حد الطلبات مؤقتًا.' }));
          }
          closeAll();
          return;
        }

        const uidSockets = wsActiveByUid.get(uid) ?? 0;
        if (uidSockets >= 3) {
          if (clientWs.readyState === clientWs.OPEN) {
            clientWs.send(JSON.stringify({ error: 'لديك الحد الأقصى من جلسات الصوت المباشر النشطة حاليًا.' }));
          }
          closeAll();
          return;
        }
        activeUid = uid;
        wsActiveByUid.set(uid, uidSockets + 1);

        const ai = getAiClient();
        const allowedVoices = ['Zephyr', 'Kore', 'Puck', 'Charon', 'Fenrir'];
        const chosenVoice = typeof voiceParam === 'string' && allowedVoices.includes(voiceParam) ? voiceParam : 'Zephyr';
        const cleanInstruction = sanitizeTextInput(customInstruction, 600);
        const safeHistoryContext = Array.isArray(recentHistory)
          ? recentHistory
              .filter((h) => h && typeof h.content === 'string')
              .slice(-6)
              .map((h) => `${h.role === 'assistant' ? 'نوفا' : 'المستخدم'}: ${sanitizeTextInput(h.content, 300)}`)
              .join('\n')
          : '';

        const systemInstruction = [
          'أنت «نوفا» في محادثة صوتية مباشرة بالوقت الفعلي.',
          'تحدّث باللغة العربية الفصيحة الواضحة والسليمة بصوت بشري دافئ وهادئ وواثق، وبنبرة طبيعية متصلة تمامًا كمتحدث عربي حقيقي دون أي سرعة مفرطة أو تقطيع.',
          'اجعل ردودك في صورة جمل عربية قصيرة واضحة ومرتبة مع وقفٍ لطيف بين الجمل لتصل بصفاء ووضوح تام دون تشويش.',
          'عند سماع تحية مثل «السلام عليكم» رحّب بالمستخدم فورًا بدفء ووضوح مثل: «وعليكم السلام ورحمة الله وبركاته، أهلاً بك! كيف أساعدك اليوم؟».',
          'لا تتحول إلى اللغة الإنجليزية ولا تخلط كلمات أجنبية غير ضرورية ما لم يطلب المستخدم ذلك صراحةً، ولا تنطق رموزًا أو نجوم تنسيق.',
          safeHistoryContext ? `\nسياق الحوار الجاري (للمتابعة بسلاسة إذا أُعيد الاتصال):\n${safeHistoryContext}` : '',
          cleanInstruction ? `\nتعليمات المستخدم الشخصية:\n${cleanInstruction}` : '',
        ]
          .filter(Boolean)
          .join('\n');

        let readySent = false;
        const sendReadySignal = () => {
          if (!readySent && !isClosed && clientWs.readyState === clientWs.OPEN) {
            readySent = true;
            clientWs.send(JSON.stringify({ ready: true }));
          }
        };

        wsHeartbeatTimer = setInterval(() => {
          if (isClosed || clientWs.readyState !== clientWs.OPEN) return;
          if (!isWsAlive) {
            closeAll();
            return;
          }
          isWsAlive = false;
          try {
            clientWs.ping();
          } catch {
            closeAll();
          }
        }, 15000);

        liveSession = await ai.live.connect({
          model: 'gemini-3.8-live',
          config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: chosenVoice },
              },
            },
            systemInstruction,
          },
          callbacks: {
            onopen: () => {
              sendReadySignal();
            },
            onmessage: (message: LiveServerMessage) => {
              if (isClosed || clientWs.readyState !== clientWs.OPEN) return;
              const content = message.serverContent;
              if (content?.inputTranscription?.text) {
                clientWs.send(JSON.stringify({ inputTranscript: content.inputTranscription.text }));
              }
              if (content?.outputTranscription?.text) {
                clientWs.send(JSON.stringify({ outputTranscript: content.outputTranscription.text }));
              }
              let sentAudioPart = false;
              for (const part of content?.modelTurn?.parts ?? []) {
                if (part.inlineData?.data) {
                  sentAudioPart = true;
                  clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
                }
              }
              const topLevelAudio = (message as { data?: string }).data;
              if (!sentAudioPart && typeof topLevelAudio === 'string' && topLevelAudio.length > 0) {
                clientWs.send(JSON.stringify({ audio: topLevelAudio }));
              }
              if (content?.interrupted) {
                clientWs.send(JSON.stringify({ interrupted: true }));
              }
              if (content?.turnComplete) {
                clientWs.send(JSON.stringify({ turnComplete: true }));
              }
            },
            onerror: (err) => {
              console.error('[Nova AI Live WS error]:', err);
              if (!isClosed && clientWs.readyState === clientWs.OPEN) {
                clientWs.send(JSON.stringify({ error: 'حدث انقطاع مؤقت في جلسة الصوت المباشر.' }));
              }
              closeAll();
            },
            onclose: (ev) => {
              const reason = (ev as { reason?: string })?.reason;
              if (reason && !isClosed && clientWs.readyState === clientWs.OPEN) {
                clientWs.send(JSON.stringify({ error: 'انقطع الاتصال بالصوت المباشر مؤقتًا.' }));
              }
              closeAll();
            },
          },
        });
        sendReadySignal();
      } catch (err) {
        console.error('[Nova AI Live Setup Error]:', err);
        const mapped = mapGeminiError(err);
        if (clientWs.readyState === clientWs.OPEN) {
          clientWs.send(JSON.stringify({ error: mapped.message }));
        }
        closeAll();
      }
    };

    authDeadlineTimer = setTimeout(() => {
      if (!activeUid && !isClosed) {
        closeAll();
      }
    }, 12000);

    clientWs.on('message', (rawData) => {
      if (isClosed) return;
      isWsAlive = true;
      const now = Date.now();
      if (now - frameWindowStart > 1000) {
        frameWindowStart = now;
        frameWindowCount = 0;
      }
      frameWindowCount += 1;
      if (frameWindowCount > 90) {
        closeAll();
        return;
      }

      try {
        const parsed = JSON.parse(rawData.toString()) as {
          type?: string;
          token?: string;
          otpToken?: string;
          voice?: string;
          instruction?: string;
          history?: Array<{ role: 'user' | 'assistant'; content: string }>;
          audio?: string;
          video?: string;
          text?: string;
        };

        if (parsed.type === 'ping') {
          if (clientWs.readyState === clientWs.OPEN) {
            clientWs.send(JSON.stringify({ pong: true }));
          }
          return;
        }

        if (!activeUid) {
          if (parsed.type === 'auth' && typeof parsed.token === 'string') {
            if (authDeadlineTimer) {
              clearTimeout(authDeadlineTimer);
              authDeadlineTimer = null;
            }
            initializeLiveBridge(
              parsed.token.trim(),
              typeof parsed.otpToken === 'string' ? parsed.otpToken.trim() : '',
              typeof parsed.voice === 'string' ? parsed.voice.trim() : 'Zephyr',
              typeof parsed.instruction === 'string' ? parsed.instruction.trim() : '',
              Array.isArray(parsed.history) ? parsed.history : []
            );
          } else {
            closeAll();
          }
          return;
        }

        if (!liveSession) return;
        if (parsed.audio && typeof parsed.audio === 'string' && parsed.audio.length <= 128 * 1024) {
          liveSession.sendRealtimeInput({
            audio: { data: parsed.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (parsed.video && typeof parsed.video === 'string' && parsed.video.length <= 200 * 1024) {
          liveSession.sendRealtimeInput({
            video: { data: parsed.video, mimeType: 'image/jpeg' },
          });
        } else if (parsed.text && typeof parsed.text === 'string') {
          const cleanWsText = sanitizeTextInput(parsed.text, 4000);
          if (cleanWsText) {
            liveSession.sendRealtimeInput({ text: cleanWsText });
          }
        }
      } catch {
        // ignore malformed client frame
      }
    });

    clientWs.on('close', closeAll);
    clientWs.on('error', closeAll);
  });

  const port = Number(process.env.PORT) || 3000;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Nova AI server listening on http://0.0.0.0:${port}`);
  });
}

if (process.env.VERCEL !== '1') {
  startServer();
}
