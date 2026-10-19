/**
 * The starter problems: statement, input/output format, starter code that
 * reads the input, and sample + hidden tests (expected outputs come from the
 * reference solutions below, not hand-typed). Written to Firestore by seed.ts.
 */
import type { Comparator } from "../src/lib/judge";
import type { Difficulty, Language } from "../src/lib/types";

export interface SeedTest {
  input: string;
  expected: string;
}

export interface SeedProblem {
  slug: string;
  title: string;
  difficulty: Difficulty;
  description: string;
  input_format: string;
  output_format: string;
  constraints: string;
  time_limit_ms: number;
  comparator: Comparator;
  starter_code: Record<Language, string>;
  samples: SeedTest[];
  hidden: SeedTest[];
}

/** Small deterministic PRNG so every seed run produces the same tests. */
function prng(seed: number) {
  let s = seed >>> 0;
  return (max: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % max;
  };
}

// ---------------------------------------------------------------------------
// Two Sum
// ---------------------------------------------------------------------------

/** Reference solution: indices i < j with nums[i] + nums[j] = target. */
function twoSum(nums: number[], target: number): [number, number] {
  const seen = new Map<number, number>();
  for (let j = 0; j < nums.length; j++) {
    const i = seen.get(target - nums[j]);
    if (i !== undefined) return [i, j];
    if (!seen.has(nums[j])) seen.set(nums[j], j);
  }
  throw new Error("no solution");
}

const twoSumTest = (nums: number[], target: number): SeedTest => ({
  input: `${nums.length}\n${nums.join(" ")}\n${target}\n`,
  expected: twoSum(nums, target).join(" "),
});

/**
 * Large case with exactly one answer: every value is a multiple of 4 except
 * `1` and `target - 1`, and target ≡ 2 (mod 4) — no other pair can reach it.
 * With `atEnd` the pair sits in the last two slots, so an O(n²) double loop
 * has to scan everything (and exceeds the time limit).
 */
function bigTwoSum(n: number, seed: number, atEnd = false): SeedTest {
  const rand = prng(seed);
  const target = 4 * (1000 + rand(100_000)) + 2;
  const used = new Set<number>([1, target - 1]);
  const nums: number[] = [];
  while (nums.length < n - 2) {
    const v = 4 * (rand(500_000) - 250_000);
    if (!used.has(v)) {
      used.add(v);
      nums.push(v);
    }
  }
  if (atEnd) {
    nums.push(1, target - 1);
  } else {
    nums.splice(rand(nums.length + 1), 0, 1);
    nums.splice(rand(nums.length + 1), 0, target - 1);
  }
  return twoSumTest(nums, target);
}

const TWO_SUM: SeedProblem = {
  slug: "two-sum",
  title: "Two Sum",
  difficulty: "easy",
  description: `Given an array of integers \`nums\` and an integer \`target\`, find the **indices** of the two numbers that add up to \`target\`.

Each input has **exactly one** solution, and you may not use the same element twice.

### Example

\`\`\`
nums = [2, 7, 11, 15], target = 9
\`\`\`

\`nums[0] + nums[1] = 2 + 7 = 9\`, so the answer is \`0 1\`.`,
  input_format: `- Line 1: \`n\`, the number of elements.
- Line 2: \`n\` space-separated integers \`nums[0] … nums[n-1]\`.
- Line 3: the integer \`target\`.`,
  output_format: "The two indices `i j` (0-based, `i < j`) separated by a space.",
  constraints: `- \`2 ≤ n ≤ 10⁴\`
- \`-10⁹ ≤ nums[i], target ≤ 10⁹\` (use 64-bit integers in C++)
- Exactly one valid answer exists.`,
  time_limit_ms: 2000,
  comparator: "tokens",
  starter_code: {
    python: `def two_sum(nums, target):
    # Return the two indices [i, j] (i < j) whose values add up to target.
    return []


n = int(input())
nums = list(map(int, input().split()))
target = int(input())
print(*two_sum(nums, target))
`,
    javascript: `function twoSum(nums, target) {
  // Return the two indices [i, j] (i < j) whose values add up to target.
  return [];
}

const lines = require("fs").readFileSync(0, "utf8").split("\\n");
const nums = lines[1].trim().split(/\\s+/).map(Number);
const target = Number(lines[2]);
console.log(twoSum(nums, target).join(" "));
`,
    cpp: `#include <bits/stdc++.h>
using namespace std;

// Return the two indices {i, j} (i < j) whose values add up to target.
vector<int> twoSum(const vector<long long>& nums, long long target) {
    return {};
}

int main() {
    int n;
    cin >> n;
    vector<long long> nums(n);
    for (auto& x : nums) cin >> x;
    long long target;
    cin >> target;
    vector<int> ans = twoSum(nums, target);
    for (size_t i = 0; i < ans.size(); i++) cout << ans[i] << (i + 1 < ans.size() ? " " : "\\n");
}
`,
  },
  samples: [twoSumTest([2, 7, 11, 15], 9), twoSumTest([3, 2, 4], 6)],
  hidden: [
    twoSumTest([3, 3], 6),
    twoSumTest([-3, 4, 3, 90], 0),
    twoSumTest([0, 4, 3, 0], 0),
    twoSumTest([-1, -2, -3, -4, -5], -8),
    twoSumTest([1_000_000_000, 5, -1_000_000_000, 7], 0),
    twoSumTest([5, 75, 25], 100),
    bigTwoSum(1000, 11),
    bigTwoSum(10_000, 42, true),
  ],
};

// ---------------------------------------------------------------------------
// Reverse String
// ---------------------------------------------------------------------------

const reverse = (s: string) => [...s].reverse().join("");
const reverseTest = (s: string): SeedTest => ({ input: `${s}\n`, expected: reverse(s) });

function randomWord(length: number, seed: number) {
  const rand = prng(seed);
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length }, () => chars[rand(chars.length)]).join("");
}

const REVERSE_STRING: SeedProblem = {
  slug: "reverse-string",
  title: "Reverse String",
  difficulty: "easy",
  description: `Given a string \`s\`, print it **reversed**.

### Example

\`hello\` becomes \`olleh\`.`,
  input_format: "A single line containing `s`.",
  output_format: "`s` reversed, on one line.",
  constraints: `- \`1 ≤ length of s ≤ 10⁵\`
- \`s\` contains printable ASCII characters and does not start or end with a space.`,
  time_limit_ms: 2000,
  comparator: "exact",
  starter_code: {
    python: `def reverse_string(s):
    # Return s reversed.
    return s


s = input()
print(reverse_string(s))
`,
    javascript: `function reverseString(s) {
  // Return s reversed.
  return s;
}

const s = require("fs").readFileSync(0, "utf8").split("\\n")[0].replace(/\\r$/, "");
console.log(reverseString(s));
`,
    cpp: `#include <bits/stdc++.h>
using namespace std;

// Return s reversed.
string reverseString(string s) {
    return s;
}

int main() {
    string s;
    getline(cin, s);
    cout << reverseString(s) << "\\n";
}
`,
  },
  samples: [reverseTest("hello"), reverseTest("CodeWithMe")],
  hidden: [
    reverseTest("a"),
    reverseTest("ab"),
    reverseTest("racecar"),
    reverseTest("Hello, World!"),
    reverseTest("12345 67890"),
    reverseTest("A man, a plan, a canal: Panama"),
    reverseTest(randomWord(1000, 7)),
    reverseTest(randomWord(100_000, 99)),
  ],
};

// ---------------------------------------------------------------------------
// FizzBuzz
// ---------------------------------------------------------------------------

const fizzBuzz = (n: number) =>
  Array.from({ length: n }, (_, k) => {
    const i = k + 1;
    return i % 15 === 0 ? "FizzBuzz" : i % 3 === 0 ? "Fizz" : i % 5 === 0 ? "Buzz" : String(i);
  });
const fizzTest = (n: number): SeedTest => ({ input: `${n}\n`, expected: fizzBuzz(n).join("\n") });

const FIZZBUZZ: SeedProblem = {
  slug: "fizzbuzz",
  title: "FizzBuzz",
  difficulty: "easy",
  description: `Print the numbers from \`1\` to \`n\`, one per line — but:

- for multiples of 3 print \`Fizz\`,
- for multiples of 5 print \`Buzz\`,
- for multiples of both 3 and 5 print \`FizzBuzz\`.`,
  input_format: "A single integer `n`.",
  output_format: "`n` lines: line `i` is `Fizz`, `Buzz`, `FizzBuzz` or the number `i`.",
  constraints: "- `1 ≤ n ≤ 10⁴`",
  time_limit_ms: 2000,
  comparator: "exact",
  starter_code: {
    python: `def fizz_buzz(n):
    # Return a list of n strings for 1..n.
    return []


n = int(input())
print("\\n".join(fizz_buzz(n)))
`,
    javascript: `function fizzBuzz(n) {
  // Return an array of n strings for 1..n.
  return [];
}

const n = Number(require("fs").readFileSync(0, "utf8").trim());
console.log(fizzBuzz(n).join("\\n"));
`,
    cpp: `#include <bits/stdc++.h>
using namespace std;

// Return n strings for 1..n.
vector<string> fizzBuzz(int n) {
    return {};
}

int main() {
    int n;
    cin >> n;
    for (const string& line : fizzBuzz(n)) cout << line << "\\n";
}
`,
  },
  samples: [fizzTest(5), fizzTest(15)],
  hidden: [fizzTest(1), fizzTest(2), fizzTest(3), fizzTest(16), fizzTest(30), fizzTest(100), fizzTest(10_000)],
};

export const PROBLEMS = [TWO_SUM, REVERSE_STRING, FIZZBUZZ];
