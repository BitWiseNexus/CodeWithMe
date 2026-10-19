import { VERDICT_LABEL, type SubmissionResult, type Verdict } from "@/lib/judge";

export type SubmitState =
  | { phase: "idle" }
  | { phase: "queued" | "running" }
  | { phase: "done"; result: SubmissionResult };

export const VERDICT_COLOR: Record<Verdict, string> = {
  AC: "text-green-400",
  WA: "text-red-400",
  RE: "text-red-400",
  CE: "text-red-400",
  TLE: "text-amber-400",
  MLE: "text-amber-400",
};

function Block({ label, text, tone = "text-white/90" }: { label: string; text: string; tone?: string }) {
  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-wide text-white/40">{label}</p>
      <pre className={`max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 font-mono text-xs ${tone}`}>
        {text === "" ? <span className="text-white/30">(empty)</span> : text}
      </pre>
    </div>
  );
}

/** The judge's answer for the latest submission, in the console's Verdict tab. */
export function VerdictView({ state }: { state: SubmitState }) {
  if (state.phase === "idle") {
    return (
      <p className="text-xs text-white/30">
        Click Submit (Ctrl/Cmd+Shift+Enter) to judge your code against every test case.
      </p>
    );
  }
  if (state.phase !== "done") {
    return <p className="text-xs text-white/50">Judging…</p>;
  }

  const r = state.result;
  if (r.status === "error" || !r.verdict) {
    return <p className="text-xs text-red-400">Judge error: {r.error ?? "unknown error"}</p>;
  }

  const ft = r.failedTest;
  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`text-base font-semibold ${VERDICT_COLOR[r.verdict]}`}>
          {VERDICT_LABEL[r.verdict]}
        </span>
        {r.verdict !== "CE" && (
          <span className="text-white/60">
            {r.passed} / {r.total} tests passed
          </span>
        )}
        {r.timeMs !== null && <span className="text-white/40">slowest passed test {r.timeMs} ms</span>}
      </div>

      {r.compileOutput !== undefined && (
        <Block label="Compiler output" text={r.compileOutput} tone="text-red-300" />
      )}

      {ft && (
        <div className="space-y-2">
          <p className="text-white/70">
            Failed on test #{ft.number} ({ft.sample ? "sample" : "hidden"})
            {ft.reason ? ` — ${ft.reason}` : ""}
          </p>
          {ft.sample ? (
            <>
              {ft.input !== undefined && <Block label="Input" text={ft.input} />}
              {ft.expected !== undefined && <Block label="Expected output" text={ft.expected} />}
              {ft.actual !== undefined && <Block label="Your output" text={ft.actual} />}
              {ft.stderr ? <Block label="Error output" text={ft.stderr} tone="text-red-300" /> : null}
            </>
          ) : (
            <p className="text-white/40">Hidden tests don&apos;t show their input or output.</p>
          )}
        </div>
      )}
    </div>
  );
}
