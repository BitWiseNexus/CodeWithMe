import "server-only";
import type { DocumentSnapshot, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";
import type { Language, Problem, TestCase } from "@/lib/types";

/*
 * Firestore layout (replaces the old Postgres tables):
 *
 *   problems/{slug}                          Problem (doc id = slug, so unique)
 *   problems/{slug}/test_cases/{id}          TestCase
 *   submissions/{uid}_{problemId}_{language} Submission — one per triple
 *   executions/{autoId}                      one per "Run", filled by the worker
 *
 * Clients never talk to Firestore directly (see firestore.rules); all access
 * goes through the Admin SDK on the server, scoped to the signed-in user.
 */
export const problemsCol = () => db.collection("problems");
export const testCasesCol = (problemId: string) =>
  problemsCol().doc(problemId).collection("test_cases");
export const submissionsCol = () => db.collection("submissions");
export const executionsCol = () => db.collection("executions");

export const submissionRef = (userId: string, problemId: string, language: Language) =>
  submissionsCol().doc(`${userId}_${problemId}_${language}`);

/** Guards user-supplied ids before using them as Firestore document ids. */
export const isValidDocId = (id: unknown): id is string =>
  typeof id === "string" &&
  id.length > 0 &&
  id.length <= 256 &&
  !id.includes("/") &&
  id !== "." &&
  id !== ".." &&
  !/^__.*__$/.test(id);

const toIso =(t: Timestamp | undefined) => t?.toDate().toISOString() ?? "";

export function toProblem(doc: DocumentSnapshot): Problem {
  const d = doc.data()!;
  return {
    id: doc.id,
    slug: d.slug,
    title: d.title,
    description: d.description ?? "",
    difficulty: d.difficulty,
    created_at: toIso(d.created_at),
  };
}

export function toTestCase(doc: DocumentSnapshot, problemId: string): TestCase {
  const d = doc.data()!;
  return {
    id: doc.id,
    problem_id: problemId,
    input: d.input ?? "",
    expected_output: d.expected_output ?? "",
    is_sample: d.is_sample === true,
    ordinal: d.ordinal ?? 0,
  };
}
