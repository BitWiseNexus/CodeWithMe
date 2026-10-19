"use server";

import { requireUser } from "@/lib/auth";
import { saveDraft } from "@/lib/db/drafts";
import { problemExists } from "@/lib/db/problems";
import { MAX_CODE_CHARS } from "@/lib/exec";
import { isLanguage, type Language } from "@/lib/types";

export type SaveResult = { ok: true; savedAt: string } | { ok: false; error: string };

/**
 * Saves the user's draft for a given problem + language.
 * One draft per (user, problem, language) thanks to the deterministic doc id.
 */
export async function saveCode(input: {
  problemId: string;
  language: Language;
  code: string;
}): Promise<SaveResult> {
  if (!isLanguage(input.language)) {
    return { ok: false, error: "Unsupported language." };
  }

  if (typeof input.code !== "string" || input.code.length > MAX_CODE_CHARS) {
    return { ok: false, error: "Code is too large." };
  }

  const user = await requireUser();

  try {
    // Only save against real problems.
    if (!(await problemExists(input.problemId))) {
      return { ok: false, error: "Unknown problem." };
    }

    const savedAt = await saveDraft(user.id, input.problemId, input.language, input.code);
    return { ok: true, savedAt: savedAt.toISOString() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save." };
  }
}
