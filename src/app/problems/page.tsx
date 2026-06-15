import Link from "next/link";
import { Header } from "@/components/Header";
import { CreateRoomButton } from "@/components/CreateRoomButton";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Difficulty, Problem } from "@/lib/types";

const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  easy: "text-green-600 dark:text-green-400",
  medium: "text-amber-600 dark:text-amber-400",
  hard: "text-red-600 dark:text-red-400",
};

export default async function ProblemsPage() {
  await requireUser();
  const supabase = await createClient();
  const { data: problems, error } = await supabase
    .from("problems")
    .select("id, slug, title, difficulty, created_at, description")
    .order("created_at", { ascending: true });

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
            Could not load problems: {error.message}. Did you run{" "}
            <code>supabase/schema.sql</code>?
          </p>
        )}

        {problems && problems.length === 0 && (
          <p className="text-sm text-black/60 dark:text-white/60">
            No problems yet. Run <code>supabase/schema.sql</code> to seed some.
          </p>
        )}

        <ul className="divide-y divide-black/10 dark:divide-white/10 rounded-md border border-black/10 dark:border-white/10">
          {(problems as Problem[] | null)?.map((p) => (
            <li key={p.id}>
              <Link
                href={`/problems/${p.slug}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span className="font-medium">{p.title}</span>
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
