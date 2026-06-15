import { notFound } from "next/navigation";
import Link from "next/link";
import { Workspace } from "@/components/Workspace";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Language, Problem, Submission, TestCase } from "@/lib/types";

export default async function ProblemPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireUser();
  const supabase = await createClient();

  const { data: problem } = await supabase
    .from("problems")
    .select("id, slug, title, description, difficulty, created_at")
    .eq("slug", slug)
    .maybeSingle<Problem>();

  if (!problem) {
    notFound();
  }

  const [{ data: samples }, { data: subs }] = await Promise.all([
    supabase
      .from("test_cases")
      .select("id, problem_id, input, expected_output, is_sample, ordinal")
      .eq("problem_id", problem.id)
      .eq("is_sample", true)
      .order("ordinal", { ascending: true }),
    supabase
      .from("submissions")
      .select("language, code")
      .eq("problem_id", problem.id)
      .eq("user_id", user.id),
  ]);

  const savedCode: Partial<Record<Language, string>> = {};
  for (const s of (subs as Pick<Submission, "language" | "code">[]) ?? []) {
    savedCode[s.language] = s.code;
  }

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

          {(samples as TestCase[] | null)?.length ? (
            <div className="mt-6">
              <h2 className="mb-2 text-sm font-semibold">Sample test cases</h2>
              <div className="space-y-3">
                {(samples as TestCase[]).map((t, i) => (
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
