"use server";

import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Language } from "@/lib/types";

const VALID_LANGUAGES: Language[] = ["python", "cpp", "javascript"];

export type SaveResult = { ok: true; savedAt: string } | { ok: false; error: string };

/**
 * Upserts the user's code for a given problem + language into Postgres.
 * One snapshot per (user, problem, language) thanks to the unique constraint.
 */
export async function saveCode(input: {
  problemId: string;
  language: Language;
  code: string;
}): Promise<SaveResult> {
  if (!VALID_LANGUAGES.includes(input.language)) {
    return { ok: false, error: "Unsupported language." };
  }

  const user = await requireUser();
  const supabase = await createClient();

  const savedAt = new Date().toISOString();
  const { error } = await supabase.from("submissions").upsert(
    {
      user_id: user.id,
      problem_id: input.problemId,
      language: input.language,
      code: input.code,
      updated_at: savedAt,
    },
    { onConflict: "user_id,problem_id,language" }
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, savedAt };
}
