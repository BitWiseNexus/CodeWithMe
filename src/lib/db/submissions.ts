import "server-only";
import { FieldValue, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { submissionsCol, toIso } from "@/lib/db/collections";
import { isValidDocId } from "@/lib/db/ids";
import type { RunnableLanguage } from "@/lib/exec";
import type { SubmissionResult } from "@/lib/judge";
import type { SubmissionSummary } from "@/lib/types";

/** Records a new submission as `queued`; returns its id. */
export async function createSubmission(input: {
  userId: string;
  problemId: string;
  language: RunnableLanguage;
  code: string;
}): Promise<string> {
  const ref = await submissionsCol().add({
    user_id: input.userId,
    problem_id: input.problemId,
    language: input.language,
    code: input.code,
    status: "queued",
    verdict: null,
    passed: 0,
    total: 0,
    time_ms: null,
    failed_test: null,
    compile_output: null,
    error: null,
    created_at: FieldValue.serverTimestamp(),
    finished_at: null,
  });
  return ref.id;
}

/** Marks a submission as failed before it ever reached the worker. */
export async function markSubmissionFailed(id: string, error: string): Promise<void> {
  await submissionsCol().doc(id).update({
    status: "error",
    error,
    finished_at: FieldValue.serverTimestamp(),
  });
}

export interface SubmissionView {
  status: SubmissionSummary["status"];
  /** Present once judging has finished. */
  result: SubmissionResult | null;
  language: string;
  code: string;
}

/** A submission's status/result, or null if it doesn't exist or isn't the user's. */
export async function getSubmissionForUser(
  id: unknown,
  userId: string
): Promise<SubmissionView | null> {
  if (!isValidDocId(id)) return null;
  const doc = await submissionsCol().doc(id).get();
  const d = doc.data();
  if (!d || d.user_id !== userId) return null;

  const finished = d.status === "done" || d.status === "error";
  return {
    status: d.status,
    language: d.language,
    code: d.code,
    result: finished
      ? {
          submissionId: doc.id,
          status: d.status,
          verdict: d.verdict ?? null,
          passed: d.passed ?? 0,
          total: d.total ?? 0,
          timeMs: d.time_ms ?? null,
          failedTest: d.failed_test ?? undefined,
          compileOutput: d.compile_output ?? undefined,
          error: d.error ?? undefined,
        }
      : null,
  };
}

const toSummary = (doc: QueryDocumentSnapshot): SubmissionSummary => {
  const d = doc.data();
  return {
    id: doc.id,
    language: d.language,
    status: d.status,
    verdict: d.verdict ?? null,
    passed: d.passed ?? 0,
    total: d.total ?? 0,
    time_ms: d.time_ms ?? null,
    created_at: toIso(d.created_at),
  };
};

/** The user's latest submissions for a problem, newest first. */
export async function listSubmissions(
  userId: string,
  problemId: string,
  limit = 10
): Promise<SubmissionSummary[]> {
  const base = submissionsCol()
    .where("user_id", "==", userId)
    .where("problem_id", "==", problemId);
  try {
    // Needs the composite index in firestore.indexes.json.
    const snap = await base.orderBy("created_at", "desc").limit(limit).get();
    return snap.docs.map(toSummary);
  } catch {
    // Index not deployed yet: equality-only queries need no index, so fetch a
    // bounded set and sort here instead.
    const snap = await base.limit(100).get();
    return snap.docs
      .map(toSummary)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
}
