/**
 * Seeds Firestore with starter problems + sample test cases (replaces the old
 * supabase/schema.sql seed). Idempotent: existing problems are left untouched.
 *
 *   npm run seed
 */
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "../server/firebaseAdmin";

const db = getAdminDb();

interface SeedProblem {
  slug: string;
  title: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  testCases: { input: string; expected_output: string; is_sample: boolean }[];
}

const PROBLEMS: SeedProblem[] = [
  {
    slug: "two-sum",
    title: "Two Sum",
    description:
      "Given an array of integers `nums` and an integer `target`, return the indices of the two numbers that add up to `target`.\n\nYou may assume that each input has exactly one solution, and you may not use the same element twice.\n\n**Example**\n\n```\nInput:  nums = [2, 7, 11, 15], target = 9\nOutput: [0, 1]\n```",
    difficulty: "easy",
    testCases: [{ input: "4\n2 7 11 15\n9", expected_output: "0 1", is_sample: true }],
  },
  {
    slug: "reverse-string",
    title: "Reverse String",
    description:
      "Write a function that reverses a string. The input string is given as a single line.\n\n**Example**\n\n```\nInput:  hello\nOutput: olleh\n```",
    difficulty: "easy",
    testCases: [{ input: "hello", expected_output: "olleh", is_sample: true }],
  },
  {
    slug: "fizzbuzz",
    title: "FizzBuzz",
    description:
      'Print numbers from 1 to `n`. For multiples of 3 print "Fizz", for multiples of 5 print "Buzz", and for multiples of both print "FizzBuzz".',
    difficulty: "easy",
    testCases: [],
  },
];

async function main() {
  const base = Date.now();

  for (const [i, p] of PROBLEMS.entries()) {
    const ref = db.collection("problems").doc(p.slug);
    if ((await ref.get()).exists) {
      console.log(`[seed] skip ${p.slug} (exists)`);
      continue;
    }

    const batch = db.batch();
    batch.create(ref, {
      slug: p.slug,
      title: p.title,
      description: p.description,
      difficulty: p.difficulty,
      // Stagger timestamps so the list keeps this order.
      created_at: Timestamp.fromMillis(base + i),
    });
    p.testCases.forEach((t, ordinal) => {
      batch.create(ref.collection("test_cases").doc(`case-${ordinal}`), { ...t, ordinal });
    });
    await batch.commit();
    console.log(`[seed] created ${p.slug}`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[seed] failed:", e);
    process.exit(1);
  }
);
