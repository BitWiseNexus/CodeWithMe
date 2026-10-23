import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { ProblemEditor } from "@/components/admin/ProblemEditor";
import { requireAdmin } from "@/lib/auth";
import { getProblemForEditing } from "@/lib/db/problems";

export default async function EditProblemPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireAdmin();
  const { slug } = await params;
  const found = await getProblemForEditing(slug);
  if (!found) notFound();
  const { problem, tests } = found;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 p-6">
        <div className="flex items-center justify-between">
          <Link href="/admin/problems" className="text-sm text-black/60 hover:underline dark:text-white/60">
            ← Manage problems
          </Link>
          <Link href={`/problems/${problem.slug}`} className="text-sm text-blue-600 hover:underline dark:text-blue-400">
            Open problem page → try a Submit
          </Link>
        </div>
        <h1 className="mb-6 mt-2 text-2xl font-bold">Edit: {problem.title}</h1>
        <ProblemEditor
          mode="update"
          initial={{
            slug: problem.slug,
            title: problem.title,
            difficulty: problem.difficulty,
            description: problem.description,
            input_format: problem.input_format,
            output_format: problem.output_format,
            constraints: problem.constraints,
            time_limit_ms: problem.time_limit_ms,
            comparator: problem.comparator,
            starter_code: problem.starter_code,
            tests,
          }}
        />
      </main>
    </div>
  );
}
