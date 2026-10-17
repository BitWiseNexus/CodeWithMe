"use server";

import { Timestamp } from "firebase-admin/firestore";
import { requireUser } from "@/lib/auth";
import { isValidDocId, problemsCol, submissionRef } from "@/lib/firebase/data";
import type { Language } from "@/lib/types";

const VALID_LANGUAGES: Language[] = ["python", "cpp", "javascript"];
const MAX_CODE = 50_000;

export type SaveResult = { ok: true; savedAt: string } | { ok: false; error: string };

/**
 * Upserts the user's code for a given problem + language into Firestore.
 * One snapshot per (user, problem, language) thanks to the deterministic doc id.
 */
export async function saveCode(input: {
  problemId: string;
  language: Language;
  code: string;
}): Promise<SaveResult> {
  if (!VALID_LANGUAGES.includes(input.language)) {
    return { ok: false, error: "Unsupported language." };
  }

  if (typeof input.code !== "string" || input.code.length > MAX_CODE) {
    return { ok: false, error: "Code is too large." };
  }

  const user = await requireUser();

  try {
    // Replaces the old foreign-key check: only save against real problems.
    if (!isValidDocId(input.problemId) || !(await problemsCol().doc(input.problemId).get()).exists) {
      return { ok: false, error: "Unknown problem." };
    }

    const savedAt = new Date();
    await submissionRef(user.id, input.problemId, input.language).set({
      user_id: user.id,
      problem_id: input.problemId,
      language: input.language,
      code: input.code,
      updated_at: Timestamp.fromDate(savedAt),
    });

    return { ok: true, savedAt: savedAt.toISOString() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save." };
  }
}
