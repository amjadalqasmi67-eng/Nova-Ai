import type { PptxDeck, PptxVisualTheme } from './pptxBuilder';

export interface ChatExamQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  lessonRef: string;
}

export interface ChatBookSource {
  title: string;
  url: string;
}

export interface ChatGeneratedExam {
  examTitle: string;
  curriculum: string;
  subjectGrade: string;
  lessonSummary: string;
  questions: ChatExamQuestion[];
  bookSources: ChatBookSource[];
}

export interface ChatLessonSummary {
  title: string;
  subject: string;
  overview: string;
  bulletPoints: string[];
  keyTerms: Array<{ term: string; definition: string }>;
}

export interface ChatFlashcardItem {
  question: string;
  answer: string;
  hint: string;
}

export interface ChatFlashcardsResult {
  deckTitle: string;
  cards: ChatFlashcardItem[];
}

export type ChatToolPayload =
  | {
      tool: 'presentation';
      deck: PptxDeck;
      visualTheme?: PptxVisualTheme;
      language?: 'ar' | 'en';
    }
  | {
      tool: 'exam';
      exam: ChatGeneratedExam;
    }
  | {
      tool: 'summary';
      summary: ChatLessonSummary;
    }
  | {
      tool: 'flashcards';
      flashcards: ChatFlashcardsResult;
      subject?: string;
    };

const PAYLOAD_START = '<<<NOVA_TOOL_PAYLOAD>>>';
const PAYLOAD_END = '<<<END_NOVA_TOOL_PAYLOAD>>>';
const MAX_ENCODED_CHARS = 12500;

function trimPresentationForStorage(
  payload: Extract<ChatToolPayload, { tool: 'presentation' }>,
  intro: string
): string {
  const clone: Extract<ChatToolPayload, { tool: 'presentation' }> = {
    tool: 'presentation',
    visualTheme: payload.visualTheme || 'cosmos',
    language: payload.language || payload.deck.language || 'ar',
    deck: {
      deckTitle: payload.deck.deckTitle,
      deckSubtitle: payload.deck.deckSubtitle,
      language: payload.deck.language || payload.language || 'ar',
      slides: payload.deck.slides.map((s) => ({
        title: s.title,
        subtitle: s.subtitle,
        layout: s.layout,
        bullets: s.bullets.slice(0, 6),
        rightColumnBullets: s.rightColumnBullets?.slice(0, 5),
        metrics: s.metrics?.slice(0, 4),
        speakerNotes: (s.speakerNotes || '').slice(0, 180),
      })),
    },
  };

  let json = JSON.stringify(clone);
  let combined = `${intro.trim()}\n\n${PAYLOAD_START}\n${json}\n${PAYLOAD_END}`;
  if (combined.length <= MAX_ENCODED_CHARS) return combined;

  // Strip speakerNotes text first to save space cleanly without losing any slide bullets
  clone.deck.slides = clone.deck.slides.map((s) => ({
    title: s.title,
    subtitle: s.subtitle,
    layout: s.layout,
    bullets: s.bullets.slice(0, 5),
    rightColumnBullets: s.rightColumnBullets?.slice(0, 4),
    metrics: s.metrics?.slice(0, 3),
    speakerNotes: '',
  }));
  json = JSON.stringify(clone);
  combined = `${intro.trim()}\n\n${PAYLOAD_START}\n${json}\n${PAYLOAD_END}`;
  if (combined.length <= MAX_ENCODED_CHARS) return combined;

  // Compact bullet text lengths cleanly as last resort
  clone.deck.slides = clone.deck.slides.map((s) => ({
    ...s,
    subtitle: s.subtitle ? s.subtitle.slice(0, 80) : undefined,
    bullets: s.bullets.slice(0, 4).map((b) => b.slice(0, 140)),
    speakerNotes: '',
  }));
  json = JSON.stringify(clone);
  return `${intro.trim()}\n\n${PAYLOAD_START}\n${json}\n${PAYLOAD_END}`.slice(0, 19500);
}

export function encodeChatToolMessage(introText: string, payload: ChatToolPayload): string {
  const cleanIntro = introText.trim().slice(0, 600);

  if (payload.tool === 'presentation') {
    return trimPresentationForStorage(payload, cleanIntro);
  }

  let workingPayload: ChatToolPayload = payload;
  let json = JSON.stringify(workingPayload);
  let combined = `${cleanIntro}\n\n${PAYLOAD_START}\n${json}\n${PAYLOAD_END}`;

  if (combined.length > MAX_ENCODED_CHARS && payload.tool === 'exam') {
    workingPayload = {
      tool: 'exam',
      exam: {
        ...payload.exam,
        lessonSummary: payload.exam.lessonSummary.slice(0, 300),
        bookSources: payload.exam.bookSources.slice(0, 3),
        questions: payload.exam.questions.slice(0, 20).map((q) => ({
          ...q,
          explanation: q.explanation.slice(0, 160),
          lessonRef: q.lessonRef.slice(0, 80),
        })),
      },
    };
    json = JSON.stringify(workingPayload);
    combined = `${cleanIntro}\n\n${PAYLOAD_START}\n${json}\n${PAYLOAD_END}`;
  }

  if (combined.length > MAX_ENCODED_CHARS && payload.tool === 'summary') {
    workingPayload = {
      tool: 'summary',
      summary: {
        ...payload.summary,
        overview: payload.summary.overview.slice(0, 400),
        bulletPoints: payload.summary.bulletPoints.slice(0, 10).map((b) => b.slice(0, 280)),
        keyTerms: payload.summary.keyTerms.slice(0, 6),
      },
    };
    json = JSON.stringify(workingPayload);
    combined = `${cleanIntro}\n\n${PAYLOAD_START}\n${json}\n${PAYLOAD_END}`;
  }

  if (combined.length > MAX_ENCODED_CHARS && payload.tool === 'flashcards') {
    workingPayload = {
      tool: 'flashcards',
      subject: payload.subject,
      flashcards: {
        deckTitle: payload.flashcards.deckTitle,
        cards: payload.flashcards.cards.slice(0, 15).map((c) => ({
          question: c.question.slice(0, 180),
          answer: c.answer.slice(0, 240),
          hint: c.hint.slice(0, 120),
        })),
      },
    };
    json = JSON.stringify(workingPayload);
    combined = `${cleanIntro}\n\n${PAYLOAD_START}\n${json}\n${PAYLOAD_END}`;
  }

  return combined.slice(0, 19500);
}

export function parseChatToolMessage(rawContent: string): {
  text: string;
  payload: ChatToolPayload | null;
} {
  if (!rawContent) return { text: '', payload: null };

  const startIdx = rawContent.indexOf(PAYLOAD_START);
  if (startIdx === -1) {
    return { text: rawContent, payload: null };
  }

  const endIdx = rawContent.indexOf(PAYLOAD_END, startIdx + PAYLOAD_START.length);
  const textBefore = rawContent.slice(0, startIdx).trim();

  if (endIdx === -1) {
    return { text: textBefore || rawContent, payload: null };
  }

  const jsonRaw = rawContent.slice(startIdx + PAYLOAD_START.length, endIdx).trim();
  const textAfter = rawContent.slice(endIdx + PAYLOAD_END.length).trim();
  const text = [textBefore, textAfter].filter(Boolean).join('\n\n');

  try {
    const parsed = JSON.parse(jsonRaw) as ChatToolPayload;
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed.tool === 'presentation' ||
        parsed.tool === 'exam' ||
        parsed.tool === 'summary' ||
        parsed.tool === 'flashcards')
    ) {
      return { text, payload: parsed };
    }
  } catch {
    // Fallback gracefully to visible intro text if JSON is malformed
  }

  return { text: text || rawContent, payload: null };
}

export function formatToolMessageReadableText(rawContent: string): string {
  const { text, payload } = parseChatToolMessage(rawContent);
  if (!payload) return rawContent;

  const sections: string[] = [];
  if (text) sections.push(text);

  if (payload.tool === 'presentation') {
    sections.push(`## ${payload.deck.deckTitle}`);
    if (payload.deck.deckSubtitle) sections.push(payload.deck.deckSubtitle);
    payload.deck.slides.forEach((s, idx) => {
      sections.push(`### شريحة ${idx + 1}: ${s.title}`);
      if (s.bullets.length > 0) {
        sections.push(s.bullets.map((b) => `- ${b}`).join('\n'));
      }
    });
  } else if (payload.tool === 'exam') {
    sections.push(`## ${payload.exam.examTitle}`);
    sections.push(`${payload.exam.subjectGrade} · ${payload.exam.questions.length} أسئلة`);
    if (payload.exam.lessonSummary) sections.push(payload.exam.lessonSummary);
    payload.exam.questions.forEach((q, idx) => {
      sections.push(
        `${idx + 1}. **${q.question}**\n${q.options
          .slice(0, 4)
          .map((opt, oi) => `   - (${['أ', 'ب', 'ج', 'د'][oi]}) ${opt}`)
          .join('\n')}`
      );
    });
    sections.push('راجع الإجابات قبل استخدامها، فقد يخطئ الذكاء الاصطناعي.');
  } else if (payload.tool === 'summary') {
    sections.push(`## ${payload.summary.title}`);
    if (payload.summary.overview) sections.push(payload.summary.overview);
    if (payload.summary.bulletPoints.length > 0) {
      sections.push('### النقاط الرئيسية:\n' + payload.summary.bulletPoints.map((b) => `- ${b}`).join('\n'));
    }
    if (payload.summary.keyTerms.length > 0) {
      sections.push(
        '### أهم المصطلحات:\n' +
          payload.summary.keyTerms.map((k) => `- **${k.term}:** ${k.definition}`).join('\n')
      );
    }
  } else if (payload.tool === 'flashcards') {
    sections.push(`## ${payload.flashcards.deckTitle}`);
    payload.flashcards.cards.forEach((c, idx) => {
      sections.push(`**بطاقة ${idx + 1}:** ${c.question}\nالإجابة: ${c.answer}`);
    });
  }

  return sections.filter(Boolean).join('\n\n').trim();
}
