export type Language = "python" | "cpp" | "javascript";

export const LANGUAGES: { value: Language; label: string }[] = [
  { value: "python", label: "Python" },
  { value: "cpp", label: "C++" },
  { value: "javascript", label: "JavaScript" },
];

export type Difficulty = "easy" | "medium" | "hard";

export interface Problem {
  id: string;
  slug: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  created_at: string;
}

export interface TestCase {
  id: string;
  problem_id: string;
  input: string;
  expected_output: string;
  is_sample: boolean;
  ordinal: number;
}

export interface Submission {
  id: string;
  user_id: string;
  problem_id: string;
  language: Language;
  code: string;
  updated_at: string;
}

/** Starter code shown when a user first opens a problem in a language. */
export const STARTER_CODE: Record<Language, string> = {
  python: `def solve():\n    # Write your solution here\n    pass\n\n\nif __name__ == "__main__":\n    solve()\n`,
  cpp: `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    // Write your solution here\n    return 0;\n}\n`,
  javascript: `function solve() {\n  // Write your solution here\n}\n\nsolve();\n`,
};
