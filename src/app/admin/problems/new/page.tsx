import Link from "next/link";
import { Header } from "@/components/Header";
import { EMPTY_PROBLEM, ProblemEditor } from "@/components/admin/ProblemEditor";
import { requireAdmin } from "@/lib/auth";

export default async function NewProblemPage() {
  await requireAdmin();

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 p-6">
        <Link href="/admin/problems" className="text-sm text-black/60 hover:underline dark:text-white/60">
          ← Manage problems
        </Link>
        <h1 className="mb-6 mt-2 text-2xl font-bold">New problem</h1>
        <ProblemEditor initial={EMPTY_PROBLEM} mode="create" />
      </main>
    </div>
  );
}
