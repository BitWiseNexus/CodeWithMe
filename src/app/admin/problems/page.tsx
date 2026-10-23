import Link from "next/link";
import { Header } from "@/components/Header";
import { requireAdmin } from "@/lib/auth";
import { listProblems } from "@/lib/db/problems";

export default async function AdminProblemsPage() {
  await requireAdmin();
  const problems = await listProblems();

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Manage problems</h1>
          <Link
            href="/admin/problems/new"
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            New problem
          </Link>
        </div>
        <p className="mb-4 text-sm text-black/60 dark:text-white/60">
          Note: <code>npm run seed</code> overwrites the problems defined in{" "}
          <code>scripts/problems.ts</code> (two-sum, reverse-string, fizzbuzz).
        </p>
        <ul className="divide-y divide-black/10 rounded-md border border-black/10 dark:divide-white/10 dark:border-white/10">
          {problems.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="font-medium">{p.title}</p>
                <p className="text-xs text-black/50 dark:text-white/50">
                  /{p.slug} · {p.difficulty} · {p.time_limit_ms / 1000}s · {p.comparator}
                </p>
              </div>
              <div className="flex gap-3 text-sm">
                <Link href={`/problems/${p.slug}`} className="text-black/60 hover:underline dark:text-white/60">
                  View
                </Link>
                <Link href={`/admin/problems/${p.slug}/edit`} className="text-blue-600 hover:underline dark:text-blue-400">
                  Edit
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
