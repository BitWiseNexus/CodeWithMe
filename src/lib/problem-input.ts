import type { Comparator } from "@/lib/judge";
import { MAX_CODE_CHARS } from "@/lib/exec";
import { LANGUAGES, type Difficulty, type Language } from "@/lib/types";

// Shared by the admin editor (instant feedback) and the save action (the real
// check — never trust the browser). Pure: no Node or server-only imports.

export interface ProblemTestInput {
  input: string;
  expected: string;
  sample: boolean;
}

/** What the admin editor submits. */
export interface ProblemInput {
  slug: string;
  title: string;
  difficulty: Difficulty;
  description: string;
  input_format: string;
  output_format: string;
  constraints: string;
  time_limit_ms: number;
  comparator: Comparator;
  starter_code: Partial<Record<Language, string>>;
  tests: ProblemTestInput[];
}

export const LIMITS = {
  slug: 60,
  title: 120,
  description: 20_000,
  section: 5_000,
  timeLimitMs: { min: 500, max: 10_000 },
  tests: 50,
  /** Per test: input + expected output (UTF-8 bytes) — under Firestore's 1 MiB doc limit. */
  testBytes: 900_000,
  /** All tests together — keeps the save request under the Server Action body limit. */
  totalTestBytes: 3_000_000,
} as const;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COMPARATOR = /^(exact|tokens|float:(\d+(\.\d+)?|\d*\.\d+)(e-?\d+)?)$/i;
const bytes = (s: string) => new TextEncoder().encode(s).length;

export type ValidationResult =
  | { ok: true; value: ProblemInput }
  | { ok: false; errors: string[] };

/** Checks and normalises an untrusted problem payload. */
export function validateProblemInput(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : "");

  const slug = str("slug").trim();
  if (!SLUG.test(slug) || slug.length > LIMITS.slug) {
    errors.push(`Slug must be lowercase letters, digits and single dashes (max ${LIMITS.slug}).`);
  }

  const title = str("title").trim();
  if (!title || title.length > LIMITS.title) errors.push(`Title is required (max ${LIMITS.title}).`);

  const difficulty = r.difficulty as Difficulty;
  if (!["easy", "medium", "hard"].includes(difficulty)) errors.push("Pick a difficulty.");

  const description = str("description");
  if (!description.trim() || description.length > LIMITS.description) {
    errors.push(`Description is required (max ${LIMITS.description} characters).`);
  }

  const sections = {
    input_format: str("input_format"),
    output_format: str("output_format"),
    constraints: str("constraints"),
  };
  for (const [k, v] of Object.entries(sections)) {
    if (v.length > LIMITS.section) errors.push(`${k} is too long (max ${LIMITS.section}).`);
  }

  const timeLimit = Number(r.time_limit_ms);
  if (!Number.isInteger(timeLimit) || timeLimit < LIMITS.timeLimitMs.min || timeLimit > LIMITS.timeLimitMs.max) {
    errors.push(`Time limit must be ${LIMITS.timeLimitMs.min}–${LIMITS.timeLimitMs.max} ms.`);
  }

  const comparator = str("comparator").trim();
  if (!COMPARATOR.test(comparator)) errors.push('Comparator must be "tokens", "exact" or "float:<eps>".');

  const starter: Partial<Record<Language, string>> = {};
  const rawStarter = (r.starter_code ?? {}) as Record<string, unknown>;
  for (const { value: lang, label } of LANGUAGES) {
    const code = rawStarter[lang];
    if (typeof code === "string" && code.trim()) {
      if (code.length > MAX_CODE_CHARS) errors.push(`${label} starter code is too long.`);
      else starter[lang] = code;
    }
  }

  const tests: ProblemTestInput[] = [];
  const rawTests = Array.isArray(r.tests) ? r.tests : [];
  if (rawTests.length === 0) errors.push("Add at least one test.");
  if (rawTests.length > LIMITS.tests) errors.push(`At most ${LIMITS.tests} tests.`);
  let total = 0;
  rawTests.slice(0, LIMITS.tests).forEach((t, i) => {
    const test = (t ?? {}) as Record<string, unknown>;
    const input = typeof test.input === "string" ? test.input : "";
    const expected = typeof test.expected === "string" ? test.expected : "";
    const size = bytes(input) + bytes(expected);
    total += size;
    if (!expected.trim()) errors.push(`Test ${i + 1}: expected output is empty.`);
    if (size > LIMITS.testBytes) errors.push(`Test ${i + 1} is too large (max ~${LIMITS.testBytes / 1000} KB).`);
    tests.push({ input, expected, sample: test.sample === true });
  });
  if (total > LIMITS.totalTestBytes) errors.push(`Tests are too large in total (max ~${LIMITS.totalTestBytes / 1_000_000} MB).`);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      slug,
      title,
      difficulty,
      description,
      ...sections,
      time_limit_ms: timeLimit,
      comparator: comparator.toLowerCase() as Comparator,
      starter_code: starter,
      tests,
    },
  };
}
