import {
  classifyTest,
  clip,
  type Comparator,
  type FailedTest,
  type SubmissionResult,
} from "@/lib/judge";
import type { BatchOutcome } from "./sandbox";

export interface JudgeTest {
  input: string;
  expected: string;
  sample: boolean;
}

/** Runs the program on each input (in one container) — see `runBatch`. */
export type BatchRunner = (inputs: string[]) => Promise<BatchOutcome>;

type JudgeResult = Omit<SubmissionResult, "submissionId">;

/**
 * Judges one submission: sample tests first, then hidden tests, stopping at
 * the first failure.
 *
 * Samples and hidden tests run in SEPARATE containers. A failed sample shows
 * the program's output to the user, so that container must never hold hidden
 * inputs (a hostile program could read them and print them).
 */
export async function judge(
  tests: JudgeTest[],
  opts: { comparator: Comparator; timeLimitMs: number },
  runBatch: BatchRunner
): Promise<JudgeResult> {
  const total = tests.length;
  if (total === 0) {
    return { status: "error", verdict: null, passed: 0, total: 0, timeMs: null, error: "This problem has no tests yet." };
  }

  const batches = [tests.filter((t) => t.sample), tests.filter((t) => !t.sample)].filter(
    (b) => b.length > 0
  );

  let passed = 0;
  let maxTimeMs = 0;
  let offset = 0;

  for (const batch of batches) {
    const out = await runBatch(batch.map((t) => t.input));

    if (out.infraError) {
      return { status: "error", verdict: null, passed, total, timeMs: null, error: out.infraError };
    }
    if (out.compileError !== undefined) {
      return {
        status: "done",
        verdict: "CE",
        passed: 0,
        total,
        timeMs: null,
        compileOutput: clip(out.compileError, 8000),
      };
    }

    for (let i = 0; i < batch.length; i++) {
      const test = batch[i];
      const number = offset + i + 1;
      const rec = out.records[i];

      if (!rec) {
        // The batch stopped before this test reported back.
        const interfered = out.aborted === "protocol";
        return {
          status: "done",
          verdict: interfered ? "RE" : "TLE",
          passed,
          total,
          timeMs: passed ? maxTimeMs : null,
          failedTest: failure(test, number, interfered ? "The program interfered with the judge" : undefined),
        };
      }

      const { verdict, reason } = classifyTest(rec, test.expected, opts.comparator, opts.timeLimitMs);
      if (verdict !== "AC") {
        return {
          status: "done",
          verdict,
          passed,
          total,
          timeMs: passed ? maxTimeMs : null,
          failedTest: failure(test, number, reason, rec),
        };
      }
      passed++;
      maxTimeMs = Math.max(maxTimeMs, rec.timeMs);
    }
    offset += batch.length;
  }

  return { status: "done", verdict: "AC", passed, total, timeMs: maxTimeMs };
}

/** Details for the failing test — inputs/outputs only ever for samples. */
function failure(
  test: JudgeTest,
  number: number,
  reason?: string,
  rec?: { stdout: string; stderr: string }
): FailedTest {
  const base: FailedTest = { number, sample: test.sample, ...(reason ? { reason } : {}) };
  if (!test.sample) return base;
  return {
    ...base,
    input: clip(test.input),
    expected: clip(test.expected),
    ...(rec ? { actual: clip(rec.stdout), stderr: clip(rec.stderr) } : {}),
  };
}
