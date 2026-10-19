import { notFound } from "next/navigation";
import Link from "next/link";
import { Markdown } from "@/components/Markdown";
import { ProblemShell } from "@/components/ProblemShell";
import { requireUser } from "@/lib/auth";
import { getDrafts } from "@/lib/db/drafts";
import { getProblem, listSampleTests } from "@/lib/db/problems";
import { getProblemProgress } from "@/lib/db/progress";
import { listSubmissions } from "@/lib/db/submissions";

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

  const [samples, savedCode, submissions, progress] = await Promise.all([
    listSampleTests(problem.id),
    getDrafts(user.id, problem.id),
    listSubmissions(user.id, problem.id),
    getProblemProgress(user.id, problem.id),
  ]);

  const sections = [
    { title: "Input", body: problem.input_format },
    { title: "Output", body: problem.output_format },
    { title: "Constraints", body: problem.constraints },
  ].filter((s) => s.body);

  const description = (
    <>
      <div className="mb-4">
        <h1 className="text-xl font-bold">{problem.title}</h1>
        <div className="mt-1 flex items-center gap-3 text-xs">
          <span className="font-semibold uppercase text-white/50">{problem.difficulty}</span>
          <span className="text-white/40">Time limit {problem.time_limit_ms / 1000}s per test</span>
          {progress === "solved" && <span className="font-semibold text-green-400">✓ Solved</span>}
          {progress === "attempted" && <span className="text-amber-400">Attempted</span>}
        </div>
      </div>

      <Markdown>{problem.description}</Markdown>

      {sections.map((s) => (
        <div key={s.title} className="mt-5">
          <h2 className="mb-1 text-sm font-semibold">{s.title}</h2>
          <Markdown>{s.body}</Markdown>
        </div>
      ))}

      {samples.length ? (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Sample tests</h2>
          <div className="space-y-3">
            {samples.map((t, i) => (
              <div key={t.id} className="rounded-md border border-white/10 bg-black/30 p-3 text-xs">
                <p className="mb-1 text-white/50">Sample {i + 1}</p>
                <p className="text-white/50">Input</p>
                <pre className="mb-2 whitespace-pre-wrap font-mono">{t.input}</pre>
                <p className="text-white/50">Expected output</p>
                <pre className="whitespace-pre-wrap font-mono">{t.expected_output}</pre>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/40">
            Submit also runs hidden tests, which aren&apos;t shown.
          </p>
        </div>
      ) : null}
    </>
  );

  return (
    <div className="flex h-screen flex-col bg-[#1e1e1e] text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <Link href="/problems" className="text-sm text-white/70 hover:text-white">
          ← Problems
        </Link>
        <span className="text-sm text-white/50">{user.email}</span>
      </header>

      <ProblemShell
        description={description}
        submissions={submissions}
        workspace={{
          problemId: problem.id,
          initialLanguage: "python",
          savedCode,
          starterCode: problem.starter_code,
          socketUrl: process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3001",
        }}
      />
    </div>
  );
}
