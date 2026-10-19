import "server-only";
import { progressCol } from "@/lib/db/collections";
import type { ProgressStatus } from "@/lib/types";

/** Every problem the user has attempted or solved, keyed by problem id. */
export async function getProgressMap(userId: string): Promise<Record<string, ProgressStatus>> {
  const snap = await progressCol(userId).get();
  const map: Record<string, ProgressStatus> = {};
  for (const doc of snap.docs) map[doc.id] = doc.data().status;
  return map;
}

export async function getProblemProgress(
  userId: string,
  problemId: string
): Promise<ProgressStatus | null> {
  const doc = await progressCol(userId).doc(problemId).get();
  return (doc.data()?.status as ProgressStatus | undefined) ?? null;
}
