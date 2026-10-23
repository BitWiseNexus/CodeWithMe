"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { deleteProblem, saveProblem } from "@/lib/db/problems";
import { validateProblemInput } from "@/lib/problem-input";

export type SaveProblemResult = { ok: true; slug: string } | { ok: false; errors: string[] };

/**
 * Creates or updates a problem. Admin-only — checked here, not just on the
 * page, because Server Actions can be called directly.
 */
export async function saveProblemAction(
  raw: unknown,
  mode: "create" | "update"
): Promise<SaveProblemResult> {
  await requireAdmin();

  const checked = validateProblemInput(raw);
  if (!checked.ok) return checked;
  if (mode !== "create" && mode !== "update") return { ok: false, errors: ["Invalid mode."] };

  try {
    await saveProblem(checked.value, mode);
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : "Could not save the problem."] };
  }
  return { ok: true, slug: checked.value.slug };
}

/** Deletes a problem and its tests (submissions stay). Admin-only. */
export async function deleteProblemAction(slug: string): Promise<void> {
  await requireAdmin();
  await deleteProblem(String(slug));
  redirect("/admin/problems");
}
