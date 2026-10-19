/**
 * Seeds Firestore with the starter problems: statement, input/output format,
 * starter code that reads the input, and sample + hidden tests.
 *
 * Safe to re-run: it SYNCS each problem — fields are overwritten, tests are
 * replaced, and `created_at` (list order) is kept.
 *
 *   npm run seed
 */
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "../server/firebaseAdmin";
import { PROBLEMS, type SeedProblem } from "./problems";

const db = getAdminDb();

// ---------------------------------------------------------------------------

async function syncProblem(p: SeedProblem, order: number) {
  const ref = db.collection("problems").doc(p.slug);
  const [existing, oldTests] = await Promise.all([ref.get(), ref.collection("test_cases").get()]);

  const batch = db.batch();
  const { samples, hidden, ...fields } = p;
  batch.set(ref, {
    ...fields,
    // Keep the original timestamp so the list order doesn't change on re-seed.
    created_at: existing.data()?.created_at ?? Timestamp.fromMillis(Date.now() + order),
  });

  const tests = [
    ...samples.map((t, i) => ({ id: `sample-${String(i + 1).padStart(2, "0")}`, t, sample: true })),
    ...hidden.map((t, i) => ({ id: `hidden-${String(i + 1).padStart(2, "0")}`, t, sample: false })),
  ];
  const keep = new Set(tests.map((t) => t.id));
  for (const doc of oldTests.docs) if (!keep.has(doc.id)) batch.delete(doc.ref);
  tests.forEach(({ id, t, sample }, ordinal) => {
    batch.set(ref.collection("test_cases").doc(id), {
      input: t.input,
      expected_output: t.expected,
      is_sample: sample,
      ordinal,
    });
  });

  await batch.commit();
  console.log(
    `[seed] ${existing.exists ? "updated" : "created"} ${p.slug}: ${samples.length} samples, ${hidden.length} hidden tests`
  );
}

async function main() {
  for (const [i, p] of PROBLEMS.entries()) await syncProblem(p, i);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[seed] failed:", e);
    process.exit(1);
  }
);
