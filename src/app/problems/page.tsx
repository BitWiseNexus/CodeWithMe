import Link from "next/link";
import { Header } from "@/components/Header";
import { CreateRoomButton } from "@/components/CreateRoomButton";
import { requireUser } from "@/lib/auth";
import { listProblems } from "@/lib/db/problems";
import { getProgressMap } from "@/lib/db/progress";
import type { Difficulty, Problem, ProgressStatus } from "@/lib/types";

const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  easy: "text-green-600 dark:text-green-400",
  medium: "text-amber-600 dark:text-amber-400",
  hard: "text-red-600 dark:text-red-400",
};

export default async function ProblemsPage() {
  const user = await requireUser();
  let problems: Problem[] | null = null;
  let progress: Record<string, ProgressStatus> = {};
  let error: Error | null = null;
  try {
    [problems, progress] = await Promise.all([listProblems(), getProgressMap(user.id)]);
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Problems</h1>
          <CreateRoomButton />
        </div>

        {error && (
          <p className="rounded-md bg-red-500/10 p-3 text-sm text-red-500">
            Could not load problems: {error.message}. Is Firestore set up
            (see README)?
          </p>
        )}

        {problems && problems.length === 0 && (
          <p className="text-sm text-black/60 dark:text-white/60">
            No problems yet. Run <code>npm run seed</code> to seed some.
          </p>
        )}

        <ul className="divide-y divide-black/10 dark:divide-white/10 rounded-md border border-black/10 dark:border-white/10">
          {problems?.map((p) => (
            <li key={p.id}>
              <Link
                href={`/problems/${p.slug}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span className="flex items-center gap-2 font-medium">
                  <span
                    className="w-4 text-center"
                    title={progress[p.id] === "solved" ? "Solved" : progress[p.id] === "attempted" ? "Attempted" : undefined}
                  >
                    {progress[p.id] === "solved" ? (
                      <span className="text-green-600 dark:text-green-400">✓</span>
                    ) : progress[p.id] === "attempted" ? (
                      <span className="text-amber-600 dark:text-amber-400">•</span>
                    ) : null}
                  </span>
                  {p.title}
                </span>
                <span
                  className={`text-xs font-semibold uppercase ${DIFFICULTY_COLOR[p.difficulty]}`}
                >
                  {p.difficulty}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
