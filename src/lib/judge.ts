// Shared by the Next.js app and the worker (server/ imports this via `@/`),
// so keep it free of "server-only" and Node APIs.

/** Accepted · Wrong Answer · Time/Memory Limit · Runtime Error · Compile Error */
export type Verdict = "AC" | "WA" | "TLE" | "MLE" | "RE" | "CE";

export const VERDICT_LABEL: Record<Verdict, string> = {
  AC: "Accepted",
  WA: "Wrong Answer",
  TLE: "Time Limit Exceeded",
  MLE: "Memory Limit Exceeded",
  RE: "Runtime Error",
  CE: "Compilation Error",
};

/**
 * How a program's output is compared with the expected output:
 * - `exact`  — line by line; trailing spaces and trailing blank lines ignored
 * - `tokens` — whitespace-insensitive (the default)
 * - `float:<eps>` — like `tokens`, numbers equal within `eps` (absolute or relative)
 */
export type Comparator = "exact" | "tokens" | `float:${string}`;

export const DEFAULT_COMPARATOR: Comparator = "tokens";
export const DEFAULT_TIME_LIMIT_MS = 2000;
/**
 * Output that reaches this size fails the test (Runtime Error). Python/JS
 * sandboxes also cap written files at exactly this size, so hitting the cap
 * is how an overflow shows up there.
 */
export const MAX_JUDGE_OUTPUT_BYTES = 1024 * 1024;
/** Submissions only show this much of a failed sample's input/output. */
export const MAX_SHOWN_CHARS = 2000;

const toLines = (s: string) => {
  const lines = s.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
};

const toTokens = (s: string) => s.split(/\s+/).filter(Boolean);

export function outputsMatch(actual: string, expected: string, comparator: Comparator): boolean {
  if (comparator === "exact") {
    const a = toLines(actual);
    const e = toLines(expected);
    return a.length === e.length && a.every((line, i) => line === e[i]);
  }

  const a = toTokens(actual);
  const e = toTokens(expected);
  if (a.length !== e.length) return false;

  if (comparator.startsWith("float:")) {
    const eps = Number(comparator.slice("float:".length));
    return a.every((tok, i) => {
      if (tok === e[i]) return true;
      const x = Number(tok);
      const y = Number(e[i]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(eps)) return false;
      return Math.abs(x - y) <= eps * Math.max(1, Math.abs(y));
    });
  }

  return a.every((tok, i) => tok === e[i]);
}

/** What the sandbox runner reports for one test. */
export interface TestRunRecord {
  exitCode: number;
  timeMs: number;
  /** Full size of the program's stdout (it may have been cut at MAX_JUDGE_OUTPUT_BYTES). */
  outputBytes: number;
  stdout: string;
  stderr: string;
}

const OUT_OF_MEMORY = /std::bad_alloc|MemoryError|heap out of memory/i;

/** Verdict for a single test, plus a short reason for non-AC results. */
export function classifyTest(
  rec: TestRunRecord,
  expected: string,
  comparator: Comparator,
  timeLimitMs: number
): { verdict: Verdict; reason?: string } {
  // 137 = SIGKILL: either our `timeout` (time) or the kernel's OOM killer.
  if (rec.exitCode === 137) {
    return rec.timeMs >= timeLimitMs - 50
      ? { verdict: "TLE" }
      : { verdict: "MLE" };
  }
  if (rec.exitCode === 153 || rec.outputBytes >= MAX_JUDGE_OUTPUT_BYTES) {
    // 153 = SIGXFSZ: the output file hit the size limit. (Python ignores
    // SIGXFSZ and exits 1 with "File too large" — the size check catches it.)
    return { verdict: "RE", reason: "Output limit exceeded" };
  }
  if (rec.exitCode !== 0) {
    if (OUT_OF_MEMORY.test(rec.stderr)) return { verdict: "MLE" };
    return { verdict: "RE", reason: `Exit code ${rec.exitCode}` };
  }
  return outputsMatch(rec.stdout, expected, comparator) ? { verdict: "AC" } : { verdict: "WA" };
}

/** Details of the first failing test. Inputs/outputs only for sample tests. */
export interface FailedTest {
  /** 1-based, counting samples first, then hidden tests. */
  number: number;
  sample: boolean;
  reason?: string;
  input?: string;
  expected?: string;
  actual?: string;
  stderr?: string;
}

/** Final result of judging one submission (sent to the browser). */
export interface SubmissionResult {
  submissionId: string;
  /** `error` = the judge itself failed (not the user's fault). */
  status: "done" | "error";
  verdict: Verdict | null;
  passed: number;
  total: number;
  /** Slowest passed test, in ms. */
  timeMs: number | null;
  failedTest?: FailedTest;
  compileOutput?: string;
  error?: string;
}

export const clip = (s: string, max = MAX_SHOWN_CHARS) =>
  s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} more characters)` : s;
