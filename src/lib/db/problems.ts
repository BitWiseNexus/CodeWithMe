import "server-only";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import { problemsCol, testCasesCol, toIso } from "@/lib/db/collections";
import { isValidDocId } from "@/lib/db/ids";
import type { Problem, TestCase } from "@/lib/types";

function toProblem(doc: DocumentSnapshot): Problem {
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

function toTestCase(doc: DocumentSnapshot, problemId: string): TestCase {
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

/** All problems, oldest first. */
export async function listProblems(): Promise<Problem[]> {
  const snap = await problemsCol().orderBy("created_at", "asc").get();
  return snap.docs.map(toProblem);
}

/** One problem by slug (= doc id), or null if it doesn't exist. */
export async function getProblem(slug: string): Promise<Problem | null> {
  if (!isValidDocId(slug)) return null;
  const doc = await problemsCol().doc(slug).get();
  return doc.exists ? toProblem(doc) : null;
}

export async function problemExists(id: unknown): Promise<boolean> {
  if (!isValidDocId(id)) return false;
  return (await problemsCol().doc(id).get()).exists;
}

/**
 * Sample test cases only — hidden ones never leave the server. Sorted in
 * memory to avoid needing a composite index for a handful of docs.
 */
export async function listSampleTests(problemId: string): Promise<TestCase[]> {
  const snap = await testCasesCol(problemId).where("is_sample", "==", true).get();
  return snap.docs
    .map((d) => toTestCase(d, problemId))
    .sort((a, b) => a.ordinal - b.ordinal);
}
