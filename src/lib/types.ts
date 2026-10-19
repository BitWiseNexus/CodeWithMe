import type { Comparator, Verdict } from "@/lib/judge";

export type Language = "python" | "cpp" | "javascript";

export const LANGUAGES: { value: Language; label: string }[] = [
  { value: "python", label: "Python" },
  { value: "cpp", label: "C++" },
  { value: "javascript", label: "JavaScript" },
];

export const isLanguage = (value: unknown): value is Language =>
  LANGUAGES.some((l) => l.value === value);

export type Difficulty = "easy" | "medium" | "hard";

export interface Problem {
  id: string;
  slug: string;
  title: string;
  /** Markdown. */
  description: string;
  difficulty: Difficulty;
  created_at: string;
  /** The stdin/stdout contract (Markdown). Empty when not set. */
  input_format: string;
  output_format: string;
  constraints: string;
  /** Per-test wall-clock limit. */
  time_limit_ms: number;
  comparator: Comparator;
  /** Per-problem starter code that already reads the input. */
  starter_code: Partial<Record<Language, string>>;
}

export interface TestCase {
  id: string;
  problem_id: string;
  input: string;
  expected_output: string;
  is_sample: boolean;
  ordinal: number;
}

/** Code a user saved (Ctrl/Cmd+S) for a problem + language. Not judged. */
export interface Draft {
  user_id: string;
  problem_id: string;
  language: Language;
  code: string;
  updated_at: string;
}

/** One row of a user's submission history. */
export interface SubmissionSummary {
  id: string;
  language: Language;
  status: "queued" | "running" | "done" | "error";
  verdict: Verdict | null;
  passed: number;
  total: number;
  time_ms: number | null;
  created_at: string;
}

/** A user's standing on one problem (drives the ✓ on the problem list). */
export type ProgressStatus = "attempted" | "solved";

/** Fallback starter code when a problem doesn't define its own. */
export const STARTER_CODE: Record<Language, string> = {
  python: `def solve():\n    # Write your solution here\n    pass\n\n\nif __name__ == "__main__":\n    solve()\n`,
  cpp: `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    // Write your solution here\n    return 0;\n}\n`,
  javascript: `function solve() {\n  // Write your solution here\n}\n\nsolve();\n`,
};
