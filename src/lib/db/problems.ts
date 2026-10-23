import "server-only";
import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";
import { problemsCol, testCasesCol, toIso } from "@/lib/db/collections";
import { isValidDocId } from "@/lib/db/ids";
import { DEFAULT_COMPARATOR, DEFAULT_TIME_LIMIT_MS } from "@/lib/judge";
import type { ProblemInput, ProblemTestInput } from "@/lib/problem-input";
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
    input_format: d.input_format ?? "",
    output_format: d.output_format ?? "",
    constraints: d.constraints ?? "",
    time_limit_ms: d.time_limit_ms ?? DEFAULT_TIME_LIMIT_MS,
    comparator: d.comparator ?? DEFAULT_COMPARATOR,
    starter_code: d.starter_code ?? {},
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

// ---------------------------------------------------------------------------
// Admin: editing problems (callers must check requireAdmin first)
// ---------------------------------------------------------------------------

/** A problem with ALL its tests (hidden ones too) — for the admin editor only. */
export async function getProblemForEditing(
  slug: string
): Promise<{ problem: Problem; tests: ProblemTestInput[] } | null> {
  const problem = await getProblem(slug);
  if (!problem) return null;
  const snap = await testCasesCol(problem.id).get();
  const tests = snap.docs
    .map((d) => toTestCase(d, problem.id))
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((t) => ({ input: t.input, expected: t.expected_output, sample: t.is_sample }));
  return { problem, tests };
}

/**
 * Creates or overwrites a problem and replaces all its tests, atomically.
 * `mode: "create"` fails if the slug is taken.
 */
export async function saveProblem(input: ProblemInput, mode: "create" | "update"): Promise<void> {
  const ref = problemsCol().doc(input.slug);
  const [existing, oldTests] = await Promise.all([ref.get(), ref.collection("test_cases").get()]);
  if (mode === "create" && existing.exists) throw new Error(`A problem with slug "${input.slug}" already exists.`);
  if (mode === "update" && !existing.exists) throw new Error("That problem no longer exists.");

  const { tests, ...fields } = input;
  const batch = db.batch();
  batch.set(ref, {
    ...fields,
    created_at: existing.data()?.created_at ?? FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
  // Samples first, then hidden — the order the judge and the page use.
  const ordered = [...tests.filter((t) => t.sample), ...tests.filter((t) => !t.sample)];
  let samples = 0;
  let hidden = 0;
  const ids = ordered.map((t) =>
    t.sample ? `sample-${String(++samples).padStart(2, "0")}` : `hidden-${String(++hidden).padStart(2, "0")}`
  );
  // Overwrite reused ids, delete the rest (one write per document per batch).
  const keep = new Set(ids);
  for (const doc of oldTests.docs) if (!keep.has(doc.id)) batch.delete(doc.ref);
  ordered.forEach((t, ordinal) => {
    batch.set(ref.collection("test_cases").doc(ids[ordinal]), {
      input: t.input,
      expected_output: t.expected,
      is_sample: t.sample,
      ordinal,
    });
  });
  await batch.commit();
}

/** Deletes a problem and its tests. Submissions and drafts are kept. */
export async function deleteProblem(slug: string): Promise<void> {
  if (!isValidDocId(slug)) return;
  const ref = problemsCol().doc(slug);
  const tests = await ref.collection("test_cases").get();
  const batch = db.batch();
  for (const doc of tests.docs) batch.delete(doc.ref);
  batch.delete(ref);
  await batch.commit();
}
