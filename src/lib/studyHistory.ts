import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { sanitizeUserText } from './sanitize';

export type StudyHistoryType = 'summary' | 'flashcards' | 'homework' | 'exam';

export interface SaveStudyHistoryPayload {
  userId: string;
  type: StudyHistoryType;
  title: string;
  subject?: string;
  inputPreview?: string;
  content: string;
  itemCount?: number;
}

export async function saveStudyHistoryEntry(payload: SaveStudyHistoryPayload): Promise<string | null> {
  if (!payload.userId) return null;
  const recordId = crypto.randomUUID();
  const title = sanitizeUserText(payload.title, 160, false) || 'نشاط دراسي';
  const subject = sanitizeUserText(payload.subject || '', 160, false);
  const inputPreview = sanitizeUserText(payload.inputPreview || '', 500);
  const content = sanitizeUserText(payload.content, 15000);
  if (!content) return null;

  const docData: Record<string, unknown> = {
    userId: payload.userId,
    type: payload.type,
    title,
    content,
    createdAt: serverTimestamp(),
  };

  if (subject) docData.subject = subject;
  if (inputPreview) docData.inputPreview = inputPreview;
  if (typeof payload.itemCount === 'number' && Number.isFinite(payload.itemCount)) {
    docData.itemCount = Math.min(100, Math.max(0, Math.round(payload.itemCount)));
  }

  try {
    await setDoc(doc(db, `users/${payload.userId}/studyHistory/${recordId}`), docData);
    return recordId;
  } catch (err) {
    console.warn('Could not persist studyHistory entry:', err);
    return null;
  }
}
