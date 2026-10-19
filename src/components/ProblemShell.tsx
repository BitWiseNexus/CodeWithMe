"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Workspace, type WorkspaceHandle } from "@/components/Workspace";
import { VERDICT_COLOR } from "@/components/VerdictView";
import { VERDICT_LABEL } from "@/lib/judge";
import { LANGUAGES, type Language, type SubmissionSummary } from "@/lib/types";

const languageLabel = (l: Language) => LANGUAGES.find((x) => x.value === l)?.label ?? l;

/**
 * The problem page body: statement / submission history on the left, the
 * editor on the right. Server-rendered parts (the statement) come in as
 * `description`; the history comes in as props and is refreshed with
 * `router.refresh()` after each verdict (client state is preserved).
 */
export function ProblemShell({
  description,
  submissions,
  workspace,
}: {
  description: ReactNode;
  submissions: SubmissionSummary[];
  workspace: Omit<Parameters<typeof Workspace>[0], "ref" | "onSubmissionFinished">;
}) {
  const router = useRouter();
  const workspaceRef = useRef<WorkspaceHandle>(null);
  const [tab, setTab] = useState<"description" | "submissions">("description");
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  async function openSubmission(id: string) {
    setOpening(id);
    setOpenError(null);
    try {
      const res = await fetch(`/api/submissions/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { language: Language; code: string };
      workspaceRef.current?.loadCode(data.language, data.code);
    } catch (e) {
      setOpenError(`Could not open that submission (${e instanceof Error ? e.message : "error"}).`);
    } finally {
      setOpening(null);
    }
  }

  const tabClass = (active: boolean) =>
    `border-b-2 px-1 pb-2 text-sm ${
      active ? "border-white text-white" : "border-transparent text-white/50 hover:text-white/80"
    }`;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
      <section className="flex min-h-0 flex-col border-r border-white/10">
        <nav className="flex gap-4 border-b border-white/10 px-6 pt-3">
          <button className={tabClass(tab === "description")} onClick={() => setTab("description")}>
            Description
          </button>
          <button className={tabClass(tab === "submissions")} onClick={() => setTab("submissions")}>
            Submissions{submissions.length ? ` (${submissions.length})` : ""}
          </button>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {tab === "description" ? (
            description
          ) : submissions.length === 0 ? (
            <p className="text-sm text-white/50">No submissions yet. Press Submit to judge your code.</p>
          ) : (
            <div className="space-y-2">
              {openError && <p className="text-xs text-red-400">{openError}</p>}
              <ul className="divide-y divide-white/10 rounded-md border border-white/10 text-sm">
                {submissions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p
                        className={`font-medium ${
                          s.verdict ? VERDICT_COLOR[s.verdict] : s.status === "error" ? "text-red-400" : "text-white/60"
                        }`}
                      >
                        {s.verdict
                          ? VERDICT_LABEL[s.verdict]
                          : s.status === "error"
                            ? "Judge error"
                            : "Judging…"}
                        {s.verdict && s.verdict !== "CE" && (
                          <span className="ml-2 text-xs font-normal text-white/40">
                            {s.passed}/{s.total}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-white/40">
                        {languageLabel(s.language)}
                        {s.time_ms !== null ? ` · ${s.time_ms} ms` : ""} ·{" "}
                        <time dateTime={s.created_at} suppressHydrationWarning>
                          {s.created_at ? new Date(s.created_at).toLocaleString() : ""}
                        </time>
                      </p>
                    </div>
                    <button
                      onClick={() => openSubmission(s.id)}
                      disabled={opening !== null}
                      className="shrink-0 rounded-md border border-white/15 px-2 py-1 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
                    >
                      {opening === s.id ? "Opening…" : "Open in editor"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className="min-h-0">
        <Workspace
          {...workspace}
          ref={workspaceRef}
          onSubmissionFinished={() => router.refresh()}
        />
      </section>
    </div>
  );
}
