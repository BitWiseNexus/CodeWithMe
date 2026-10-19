import type { Language } from "@/lib/types";

// Shared by the Next.js app, the realtime server and the worker (server/ imports
// this via the `@/` alias), so keep it free of "server-only" and Node APIs.

/** Redis list that the worker drains (BRPOP). */
export const EXEC_QUEUE = "codewithme:exec:jobs";

/** Languages the sandbox can execute today (C++ comes with the judge). */
export const RUNNABLE_LANGUAGES = ["python", "javascript"] as const satisfies readonly Language[];
export type RunnableLanguage = (typeof RUNNABLE_LANGUAGES)[number];

export const isRunnable = (value: unknown): value is RunnableLanguage =>
  (RUNNABLE_LANGUAGES as readonly unknown[]).includes(value);

/** Input limits, enforced by /api/run and saveCode. */
export const MAX_CODE_CHARS = 50_000;
export const MAX_STDIN_CHARS = 10_000;

/** Output cap per stream (stdout / stderr), in bytes. */
export const MAX_OUTPUT_BYTES = 64 * 1024;

/** Socket.IO room that receives the result of one execution. */
export const execRoom = (executionId: string) => `exec:${executionId}`;

/** Job pushed onto the queue when a user clicks "Run". */
export interface ExecJob {
  executionId: string;
  userId: string;
  language: RunnableLanguage;
  code: string;
  stdin: string;
}

export type ExecStatus = "queued" | "running" | "done" | "error";

/** Result broadcast to the client over Socket.IO when execution finishes. */
export interface ExecResult {
  executionId: string;
  status: Exclude<ExecStatus, "queued" | "running">;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
  /** True when stdout or stderr was cut at MAX_OUTPUT_BYTES. */
  truncated?: boolean;
}
