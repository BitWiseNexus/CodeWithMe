import { notFound } from "next/navigation";
import Link from "next/link";
import { Workspace } from "@/components/Workspace";
import { requireUser } from "@/lib/auth";
import { getDrafts } from "@/lib/db/drafts";
import { getProblem, listSampleTests } from "@/lib/db/problems";

export default async function ProblemPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireUser();

  const problem = await getProblem(slug);
  if (!problem) {
    notFound();
  }

  const [samples, savedCode] = await Promise.all([
    listSampleTests(problem.id),
    getDrafts(user.id, problem.id),
  ]);

  return (
    <div className="flex h-screen flex-col bg-[#1e1e1e] text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <Link href="/problems" className="text-sm text-white/70 hover:text-white">
          ← Problems
        </Link>
        <span className="text-sm text-white/50">{user.email}</span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
        {/* Description */}
        <section className="overflow-y-auto border-r border-white/10 p-6">
          <h1 className="mb-1 text-xl font-bold">{problem.title}</h1>
          <span className="text-xs font-semibold uppercase text-white/50">
            {problem.difficulty}
          </span>
          <article className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-white/85">
            {problem.description}
          </article>

          {samples.length ? (
            <div className="mt-6">
              <h2 className="mb-2 text-sm font-semibold">Sample test cases</h2>
              <div className="space-y-3">
                {samples.map((t, i) => (
                  <div
                    key={t.id}
                    className="rounded-md border border-white/10 bg-black/30 p-3 text-xs"
                  >
                    <p className="mb-1 text-white/50">Case {i + 1}</p>
                    <p className="text-white/50">Input</p>
                    <pre className="mb-2 whitespace-pre-wrap font-mono">{t.input}</pre>
                    <p className="text-white/50">Expected output</p>
                    <pre className="whitespace-pre-wrap font-mono">
                      {t.expected_output}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {/* Editor */}
        <section className="min-h-0">
          <Workspace
            problemId={problem.id}
            initialLanguage="python"
            savedCode={savedCode}
            socketUrl={
              process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3001"
            }
          />
        </section>
      </div>
    </div>
  );
}
