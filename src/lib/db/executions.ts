import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { executionsCol } from "@/lib/db/collections";
import { isValidDocId } from "@/lib/db/ids";
import type { ExecResult, ExecStatus, RunnableLanguage } from "@/lib/exec";

/**
 * Executions are only needed shortly after a run. `expire_at` lets a Firestore
 * TTL policy on `executions.expire_at` delete them automatically (see README).
 */
const EXECUTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Records a new run as `queued`; returns its id. */
export async function createExecution(input: {
  userId: string;
  problemId: string | null;
  language: RunnableLanguage;
  code: string;
  stdin: string;
}): Promise<string> {
  const ref = await executionsCol().add({
    user_id: input.userId,
    problem_id: input.problemId,
    language: input.language,
    code: input.code,
    stdin: input.stdin,
    status: "queued",
    stdout: "",
    stderr: "",
    exit_code: null,
    error: null,
    truncated: false,
    created_at: FieldValue.serverTimestamp(),
    finished_at: null,
    expire_at: Timestamp.fromMillis(Date.now() + EXECUTION_TTL_MS),
  });
  return ref.id;
}

/** Marks a run as failed before it ever reached the worker. */
export async function markExecutionFailed(id: string, error: string): Promise<void> {
  await executionsCol().doc(id).update({
    status: "error",
    error,
    finished_at: FieldValue.serverTimestamp(),
  });
}

export interface ExecutionView {
  status: ExecStatus;
  /** Present once the run has finished (`done` or `error`). */
  result: ExecResult | null;
}

/** A run's status/result, or null if it doesn't exist or isn't the user's. */
export async function getExecutionForUser(
  id: unknown,
  userId: string
): Promise<ExecutionView | null> {
  if (!isValidDocId(id)) return null;
  const doc = await executionsCol().doc(id).get();
  const d = doc.data();
  if (!d || d.user_id !== userId) return null;

  const status = d.status as ExecStatus;
  if (status !== "done" && status !== "error") return { status, result: null };

  return {
    status,
    result: {
      executionId: doc.id,
      status,
      stdout: d.stdout ?? "",
      stderr: d.stderr ?? "",
      exitCode: d.exit_code ?? null,
      error: d.error ?? undefined,
      truncated: d.truncated === true,
    },
  };
}
