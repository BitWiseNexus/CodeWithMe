import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";
import { draftsCol } from "@/lib/db/collections";
import { LANGUAGES, type Language } from "@/lib/types";

/** Deterministic id → one draft per (user, problem, language). */
const draftRef = (userId: string, problemId: string, language: Language) =>
  draftsCol().doc(`${userId}_${problemId}_${language}`);

/** The user's saved code for a problem, keyed by language. */
export async function getDrafts(
  userId: string,
  problemId: string
): Promise<Partial<Record<Language, string>>> {
  const docs = await db.getAll(
    ...LANGUAGES.map((l) => draftRef(userId, problemId, l.value))
  );

  const drafts: Partial<Record<Language, string>> = {};
  for (const doc of docs) {
    const data = doc.data();
    if (data) drafts[data.language as Language] = data.code;
  }
  return drafts;
}

/** Creates or overwrites the draft; returns the save time. */
export async function saveDraft(
  userId: string,
  problemId: string,
  language: Language,
  code: string
): Promise<Date> {
  const savedAt = new Date();
  await draftRef(userId, problemId, language).set({
    user_id: userId,
    problem_id: problemId,
    language,
    code,
    updated_at: Timestamp.fromDate(savedAt),
  });
  return savedAt;
}
