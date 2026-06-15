"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { io, type Socket } from "socket.io-client";
import { CodeEditor } from "@/components/CodeEditor";
import { saveCode } from "@/app/problems/[slug]/actions";
import { LANGUAGES, STARTER_CODE, type Language } from "@/lib/types";
import type { ExecResult } from "@/lib/exec";

type SavedCode = Partial<Record<Language, string>>;

const RUNNABLE: Language[] = ["python", "javascript"]; // C++ deferred

type RunState =
  | { phase: "idle" }
  | { phase: "queued" | "running" }
  | { phase: "done"; result: ExecResult };

export function Workspace({
  problemId,
  initialLanguage,
  savedCode,
  socketUrl,
}: {
  problemId: string;
  initialLanguage: Language;
  /** Previously saved code keyed by language (from the DB). */
  savedCode: SavedCode;
  socketUrl: string;
}) {
  const [language, setLanguage] = useState<Language>(initialLanguage);

  // Per-language buffer so switching languages doesn't lose work.
  const [buffers, setBuffers] = useState<Record<Language, string>>(() => ({
    python: savedCode.python ?? STARTER_CODE.python,
    cpp: savedCode.cpp ?? STARTER_CODE.cpp,
    javascript: savedCode.javascript ?? STARTER_CODE.javascript,
  }));

  const [status, setStatus] = useState<string>("");
  const [stdin, setStdin] = useState("");
  const [run, setRun] = useState<RunState>({ phase: "idle" });
  const [isPending, startTransition] = useTransition();
  const dirtyRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);
  const execIdRef = useRef<string | null>(null);

  const code = buffers[language];

  // Persistent socket connection to receive execution results.
  useEffect(() => {
    const socket = io(socketUrl, { transports: ["websocket"] });
    socketRef.current = socket;
    socket.on("execution:result", (result: ExecResult) => {
      if (result.executionId !== execIdRef.current) return;
      setRun({ phase: "done", result });
    });
    return () => {
      socket.disconnect();
    };
  }, [socketUrl]);

  const handleChange = useCallback(
    (value: string) => {
      dirtyRef.current = true;
      setBuffers((prev) => ({ ...prev, [language]: value }));
      setStatus("Unsaved changes");
    },
    [language]
  );

  const handleSave = useCallback(() => {
    startTransition(async () => {
      const result = await saveCode({ problemId, language, code });
      if (result.ok) {
        dirtyRef.current = false;
        setStatus(`Saved ${new Date(result.savedAt).toLocaleTimeString()}`);
      } else {
        setStatus(`Error: ${result.error}`);
      }
    });
  }, [problemId, language, code]);

  const handleRun = useCallback(async () => {
    if (!RUNNABLE.includes(language)) return;
    setRun({ phase: "queued" });
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, code, stdin, problemId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRun({
          phase: "done",
          result: {
            executionId: "",
            status: "error",
            stdout: "",
            stderr: data.error ?? "Failed to queue execution",
            exitCode: null,
          },
        });
        return;
      }
      execIdRef.current = data.executionId;
      socketRef.current?.emit("watch", { executionId: data.executionId });
      setRun({ phase: "running" });
    } catch (e) {
      setRun({
        phase: "done",
        result: {
          executionId: "",
          status: "error",
          stdout: "",
          stderr: e instanceof Error ? e.message : "Network error",
          exitCode: null,
        },
      });
    }
  }, [language, code, stdin, problemId]);

  // Ctrl/Cmd+S to save, Ctrl/Cmd+Enter to run.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleRun();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave, handleRun]);

  const running = run.phase === "queued" || run.phase === "running";
  const canRun = RUNNABLE.includes(language);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#1e1e1e] px-3 py-2">
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

        <div className="flex items-center gap-3">
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
            disabled={running || !canRun}
            title={canRun ? "Run (Ctrl/Cmd+Enter)" : "C++ execution coming soon"}
            className="rounded-md bg-green-600 px-3 py-1 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
          >
            {running ? "Running…" : "▶ Run"}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <CodeEditor language={language} value={code} onChange={handleChange} />
      </div>

      {/* Run console */}
      <div className="flex h-56 shrink-0 flex-col border-t border-white/10 bg-[#1e1e1e] text-white">
        <div className="grid min-h-0 flex-1 grid-cols-3">
          <div className="flex flex-col border-r border-white/10">
            <label className="px-3 py-1 text-xs uppercase tracking-wide text-white/40">
              stdin
            </label>
            <textarea
              value={stdin}
              onChange={(e) => setStdin(e.target.value)}
              placeholder="Program input…"
              spellCheck={false}
              className="min-h-0 flex-1 resize-none bg-transparent px-3 pb-2 font-mono text-xs text-white/90 outline-none placeholder:text-white/30"
            />
          </div>
          <div className="col-span-2 flex min-h-0 flex-col">
            <div className="flex items-center justify-between px-3 py-1">
              <span className="text-xs uppercase tracking-wide text-white/40">
                output
              </span>
              {run.phase === "done" && (
                <span
                  className={`text-xs ${
                    run.result.status === "done" && run.result.exitCode === 0
                      ? "text-green-400"
                      : "text-red-400"
                  }`}
                >
                  {run.result.status === "error"
                    ? "error"
                    : `exit ${run.result.exitCode}`}
                </span>
              )}
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 pb-2 font-mono text-xs">
              {run.phase === "idle" && (
                <span className="text-white/30">
                  {canRun
                    ? "Click Run to execute in a sandbox."
                    : "C++ execution isn't available yet."}
                </span>
              )}
              {running && <span className="text-white/50">Running…</span>}
              {run.phase === "done" && (
                <>
                  {run.result.stdout && (
                    <span className="text-white/90">{run.result.stdout}</span>
                  )}
                  {run.result.stderr && (
                    <span className="text-red-400">{run.result.stderr}</span>
                  )}
                  {!run.result.stdout && !run.result.stderr && (
                    <span className="text-white/30">(no output)</span>
                  )}
                </>
              )}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
