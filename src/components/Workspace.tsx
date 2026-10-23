"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useTransition,
  type Ref,
} from "react";
import { io, type Socket } from "socket.io-client";
import { CodeEditor } from "@/components/CodeEditor";
import { VerdictView, type SubmitState } from "@/components/VerdictView";
import { saveCode, type SaveResult } from "@/app/problems/[slug]/actions";
import { LANGUAGES, STARTER_CODE, type Language } from "@/lib/types";
import { isRunnable, type ExecResult } from "@/lib/exec";
import type { SubmissionResult } from "@/lib/judge";

type CodeByLanguage = Partial<Record<Language, string>>;

type RunState =
  | { phase: "idle" }
  | { phase: "queued" | "running" }
  | { phase: "done"; result: ExecResult };

/** The run or submission we're waiting for. */
type Job = { kind: "run" | "submit"; id: string };

/** Lets the problem page load old code (e.g. from the submission history). */
export interface WorkspaceHandle {
  loadCode: (language: Language, code: string) => void;
}

/** If the Socket.IO result hasn't arrived by then, start polling the API. */
const POLL_AFTER_MS = 10_000;
const POLL_EVERY_MS = 5_000;
/** Stop waiting entirely (worker likely offline). Judging takes longer. */
const GIVE_UP_AFTER_MS = { run: 60_000, submit: 180_000 };
/** Drafts save themselves this long after the last edit. */
const AUTOSAVE_MS = 5_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runError = (message: string, executionId = ""): ExecResult => ({
  executionId,
  status: "error",
  stdout: "",
  stderr: message,
  exitCode: null,
});

const submitError = (message: string, submissionId = ""): SubmissionResult => ({
  submissionId,
  status: "error",
  verdict: null,
  passed: 0,
  total: 0,
  timeMs: null,
  error: message,
});

/** POST JSON and return the parsed body — without assuming the reply is JSON. */
async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, data };
}

export function Workspace({
  problemId,
  initialLanguage,
  savedCode,
  starterCode,
  socketUrl,
  onSubmissionFinished,
  ref,
}: {
  problemId: string;
  initialLanguage: Language;
  /** Previously saved code keyed by language (from the DB). */
  savedCode: CodeByLanguage;
  /** This problem's starter code (falls back to a generic template). */
  starterCode: CodeByLanguage;
  socketUrl: string;
  /** Called after a verdict arrives (e.g. to refresh the history list). */
  onSubmissionFinished?: () => void;
  ref?: Ref<WorkspaceHandle>;
}) {
  const starterFor = useCallback(
    (l: Language) => starterCode[l] ?? STARTER_CODE[l],
    [starterCode]
  );

  const [language, setLanguage] = useState<Language>(initialLanguage);
  // Per-language buffer so switching languages doesn't lose work.
  const [buffers, setBuffers] = useState<Record<Language, string>>(
    () =>
      Object.fromEntries(
        LANGUAGES.map(({ value: l }) => [l, savedCode[l] ?? starterFor(l)])
      ) as Record<Language, string>
  );

  const [status, setStatus] = useState<string>("");
  const [stdin, setStdin] = useState("");
  const [run, setRun] = useState<RunState>({ phase: "idle" });
  const [submit, setSubmit] = useState<SubmitState>({ phase: "idle" });
  const [panel, setPanel] = useState<"output" | "verdict">("output");
  const [isPending, startTransition] = useTransition();
  /** Languages with edits that haven't been saved yet. */
  const dirtyRef = useRef<Set<Language>>(new Set());
  /** Latest buffers, for saves that finish after more typing. */
  const buffersRef = useRef(buffers);
  useEffect(() => {
    buffersRef.current = buffers;
  }, [buffers]);
  const socketRef = useRef<Socket | null>(null);
  const jobRef = useRef<Job | null>(null);
  const onFinishedRef = useRef(onSubmissionFinished);
  useEffect(() => {
    onFinishedRef.current = onSubmissionFinished;
  }, [onSubmissionFinished]);

  const code = buffers[language];
  const busy =
    run.phase === "queued" || run.phase === "running" ||
    submit.phase === "queued" || submit.phase === "running";
  const canRun = isRunnable(language);

  const finishRun = useCallback((result: ExecResult) => {
    jobRef.current = null; // also stops any polling loop
    setRun({ phase: "done", result });
  }, []);

  const finishSubmit = useCallback((result: SubmissionResult) => {
    jobRef.current = null;
    setSubmit({ phase: "done", result });
    onFinishedRef.current?.();
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      loadCode(l, c) {
        setLanguage(l);
        setBuffers((prev) => ({ ...prev, [l]: c }));
        dirtyRef.current.add(l);
        setStatus("Loaded from a submission — unsaved");
      },
    }),
    []
  );

  // Persistent socket connection to receive run results and verdicts.
  useEffect(() => {
    const socket = io(socketUrl, { transports: ["websocket"] });
    socketRef.current = socket;
    socket.on("execution:result", (result: ExecResult) => {
      const job = jobRef.current;
      if (job?.kind === "run" && job.id === result.executionId) finishRun(result);
    });
    socket.on("submission:result", (result: SubmissionResult) => {
      const job = jobRef.current;
      if (job?.kind === "submit" && job.id === result.submissionId) finishSubmit(result);
    });
    // Socket.IO rooms don't survive a reconnect: watch again. The server
    // replays the result if it finished while we were disconnected.
    socket.on("connect", () => {
      if (jobRef.current) socket.emit("watch", { executionId: jobRef.current.id });
    });
    return () => {
      socket.disconnect();
      jobRef.current = null; // stop polling after unmount
    };
  }, [socketUrl, finishRun, finishSubmit]);

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current.size > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  /**
   * Fallback when the socket result doesn't arrive: poll the API until the
   * job finishes, another job starts, the component unmounts, or we give up.
   */
  const pollJob = useCallback(
    async (job: Job) => {
      const startedAt = Date.now();
      const url = job.kind === "run" ? `/api/executions/${job.id}` : `/api/submissions/${job.id}`;
      await sleep(POLL_AFTER_MS);

      while (jobRef.current?.id === job.id) {
        if (Date.now() - startedAt > GIVE_UP_AFTER_MS[job.kind]) {
          const message = "No result yet — the code runner may be offline. Please try again later.";
          if (job.kind === "run") finishRun(runError(message, job.id));
          else finishSubmit(submitError(message, job.id));
          return;
        }
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (res.ok) {
            const data = (await res.json()) as { result: ExecResult | SubmissionResult | null };
            if (data.result && jobRef.current?.id === job.id) {
              if (job.kind === "run") finishRun(data.result as ExecResult);
              else finishSubmit(data.result as SubmissionResult);
              return;
            }
          }
        } catch {
          // Network blip — keep trying until we give up.
        }
        await sleep(POLL_EVERY_MS);
      }
    },
    [finishRun, finishSubmit]
  );

  /** Starts waiting for a queued job's result. */
  const watchJob = useCallback(
    (job: Job) => {
      jobRef.current = job;
      socketRef.current?.emit("watch", { executionId: job.id });
      void pollJob(job);
    },
    [pollJob]
  );

  const handleChange = useCallback(
    (value: string) => {
      dirtyRef.current.add(language);
      setBuffers((prev) => ({ ...prev, [language]: value }));
      setStatus("Unsaved changes");
    },
    [language]
  );

  /**
   * Saves one language's code. Its "unsaved" flag is only cleared if the
   * editor still holds exactly what was saved (no typing during the save).
   */
  const persist = useCallback(
    async (l: Language, text: string): Promise<SaveResult> => {
      const result = await saveCode({ problemId, language: l, code: text });
      if (result.ok && buffersRef.current[l] === text) dirtyRef.current.delete(l);
      return result;
    },
    [problemId]
  );

  const handleSave = useCallback(() => {
    startTransition(async () => {
      const result = await persist(language, code);
      setStatus(
        result.ok ? `Saved ${new Date(result.savedAt).toLocaleTimeString()}` : `Error: ${result.error}`
      );
    });
  }, [persist, language, code]);

  // Autosave: AUTOSAVE_MS after the last edit, save every language with
  // unsaved changes — so leaving the page (even via an in-app link) can't
  // lose more than a few seconds of work.
  useEffect(() => {
    if (dirtyRef.current.size === 0) return;
    const timer = setTimeout(async () => {
      const dirty = [...dirtyRef.current];
      const results = await Promise.all(dirty.map((l) => persist(l, buffersRef.current[l])));
      const failed = results.find((r): r is Extract<SaveResult, { ok: false }> => !r.ok);
      setStatus(
        failed ? `Autosave failed: ${failed.error}` : `Autosaved ${new Date().toLocaleTimeString()}`
      );
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [buffers, persist]);

  const handleReset = useCallback(() => {
    if (!window.confirm("Replace your code with the starter code for this language?")) return;
    setBuffers((prev) => ({ ...prev, [language]: starterFor(language) }));
    dirtyRef.current.add(language);
    setStatus("Reset to starter code — unsaved");
  }, [language, starterFor]);

  const handleRun = useCallback(async () => {
    if (!isRunnable(language) || busy) return;
    setPanel("output");
    setRun({ phase: "queued" });
    try {
      const { res, data } = await postJson("/api/run", { language, code, stdin, problemId });
      if (!res.ok || typeof data.executionId !== "string") {
        finishRun(runError((data.error as string) ?? `Failed to queue execution (HTTP ${res.status})`));
        return;
      }
      setRun({ phase: "running" });
      watchJob({ kind: "run", id: data.executionId });
    } catch (e) {
      finishRun(runError(e instanceof Error ? e.message : "Network error"));
    }
  }, [language, code, stdin, problemId, busy, finishRun, watchJob]);

  const handleSubmit = useCallback(async () => {
    if (!isRunnable(language) || busy) return;
    setPanel("verdict");
    setSubmit({ phase: "queued" });
    try {
      const { res, data } = await postJson("/api/submit", { language, code, problemId });
      if (!res.ok || typeof data.submissionId !== "string") {
        finishSubmit(submitError((data.error as string) ?? `Failed to submit (HTTP ${res.status})`));
        return;
      }
      setSubmit({ phase: "running" });
      watchJob({ kind: "submit", id: data.submissionId });
    } catch (e) {
      finishSubmit(submitError(e instanceof Error ? e.message : "Network error"));
    }
  }, [language, code, problemId, busy, finishSubmit, watchJob]);

  // Shortcuts when focus is outside the editor (e.g. the stdin box). Inside
  // Monaco, CodeEditor registers the same keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) handleSubmit();
        else handleRun();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave, handleRun, handleSubmit]);

  const tabClass = (active: boolean) =>
    `text-xs uppercase tracking-wide ${active ? "text-white" : "text-white/40 hover:text-white/70"}`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#1e1e1e] px-3 py-2">
        <div className="flex items-center gap-2">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            className="rounded-md border border-white/15 bg-[#2a2a2a] px-2 py-1 text-sm text-white outline-none"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <button
            onClick={handleReset}
            title="Replace your code with the starter code"
            className="rounded-md px-2 py-1 text-xs text-white/50 hover:bg-white/10 hover:text-white"
          >
            Reset
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-white/50">{status}</span>
          <button
            onClick={handleSave}
            disabled={isPending}
            className="rounded-md border border-white/15 px-3 py-1 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
          <button
            onClick={handleRun}
            disabled={busy || !canRun}
            title={canRun ? "Run with your input (Ctrl/Cmd+Enter)" : "This language can't run yet"}
            className="rounded-md border border-green-600 px-3 py-1 text-sm font-medium text-green-400 hover:bg-green-600/15 disabled:opacity-50"
          >
            {run.phase === "queued" || run.phase === "running" ? "Running…" : "▶ Run"}
          </button>
          <button
            onClick={handleSubmit}
            disabled={busy || !canRun}
            title="Judge against all test cases (Ctrl/Cmd+Shift+Enter)"
            className="rounded-md bg-green-600 px-3 py-1 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
          >
            {submit.phase === "queued" || submit.phase === "running" ? "Judging…" : "Submit"}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <CodeEditor
          language={language}
          value={code}
          onChange={handleChange}
          onRun={handleRun}
          onSubmit={handleSubmit}
          onSave={handleSave}
        />
      </div>

      {/* Console: stdin + run output / verdict */}
      <div className="flex h-60 shrink-0 flex-col border-t border-white/10 bg-[#1e1e1e] text-white">
        <div className="grid min-h-0 flex-1 grid-cols-3">
          <div className="flex flex-col border-r border-white/10">
            <label className="px-3 py-1 text-xs uppercase tracking-wide text-white/40">
              stdin
            </label>
            <textarea
              value={stdin}
              onChange={(e) => setStdin(e.target.value)}
              placeholder="Program input for Run…"
              spellCheck={false}
              className="min-h-0 flex-1 resize-none bg-transparent px-3 pb-2 font-mono text-xs text-white/90 outline-none placeholder:text-white/30"
            />
          </div>
          <div className="col-span-2 flex min-h-0 flex-col">
            <div className="flex items-center justify-between px-3 py-1">
              <div className="flex gap-3">
                <button className={tabClass(panel === "output")} onClick={() => setPanel("output")}>
                  output
                </button>
                <button className={tabClass(panel === "verdict")} onClick={() => setPanel("verdict")}>
                  verdict
                </button>
              </div>
              {panel === "output" && run.phase === "done" && (
                <span
                  className={`text-xs ${
                    run.result.status === "done" && run.result.exitCode === 0
                      ? "text-green-400"
                      : "text-red-400"
                  }`}
                >
                  {run.result.status === "error" ? "error" : `exit ${run.result.exitCode}`}
                </span>
              )}
            </div>

            {panel === "output" ? (
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 pb-2 font-mono text-xs">
                {run.phase === "idle" && (
                  <span className="text-white/30">
                    {canRun
                      ? "Click Run to execute with the input on the left."
                      : "This language can't run yet."}
                  </span>
                )}
                {(run.phase === "queued" || run.phase === "running") && (
                  <span className="text-white/50">Running…</span>
                )}
                {run.phase === "done" && (
                  <>
                    {run.result.stdout && <span className="text-white/90">{run.result.stdout}</span>}
                    {run.result.stderr && <span className="text-red-400">{run.result.stderr}</span>}
                    {!run.result.stdout && !run.result.stderr && (
                      <span className="text-white/30">(no output)</span>
                    )}
                    {run.result.truncated && (
                      <span className="text-amber-400">
                        {"\n"}[output truncated at 64 KB]
                      </span>
                    )}
                  </>
                )}
              </pre>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto px-3 pb-2">
                <VerdictView state={submit} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
