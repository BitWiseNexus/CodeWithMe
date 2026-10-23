import type { Language } from "@/lib/types";

// Shared by the Next.js app, the realtime server and the worker (server/ imports
// this via the `@/` alias), so keep it free of "server-only" and Node APIs.

/**
 * Job queues: Redis Streams read by a consumer group, so a job stays pending
 * (and is retried) until a worker acknowledges it. Runs and submissions use
 * separate streams so runs (quick, interactive) can go first.
 */
export const RUN_STREAM = "codewithme:jobs:run";
export const SUBMIT_STREAM = "codewithme:jobs:submit";
export const JOB_GROUP = "workers";

/** The old Redis list queue (before streams); the worker migrates leftovers. */
export const LEGACY_QUEUE = "codewithme:exec:jobs";

/** Refuse new jobs when this many are waiting or running (worker backed up). */
export const MAX_QUEUED_JOBS = 50;

/** Languages the sandbox can execute (each needs a runtime in server/sandbox.ts). */
export const RUNNABLE_LANGUAGES = ["python", "javascript", "cpp"] as const satisfies readonly Language[];
export type RunnableLanguage = (typeof RUNNABLE_LANGUAGES)[number];

export const isRunnable = (value: unknown): value is RunnableLanguage =>
  (RUNNABLE_LANGUAGES as readonly unknown[]).includes(value);

/** Input limits, enforced by /api/run, /api/submit and saveCode. */
export const MAX_CODE_CHARS = 50_000;
export const MAX_STDIN_CHARS = 10_000;

/** Output cap per stream (stdout / stderr) for a Run, in bytes. */
export const MAX_OUTPUT_BYTES = 64 * 1024;

/**
 * Socket.IO room that receives the result of one job (a run or a
 * submission — both ids are random Firestore ids, so they never collide).
 */
export const execRoom = (jobId: string) => `exec:${jobId}`;

/** Job pushed onto the queue when a user clicks "Run". */
export interface ExecJob {
  type?: "run"; // optional: jobs queued before submissions existed have no type
  executionId: string;
  userId: string;
  language: RunnableLanguage;
  code: string;
  stdin: string;
}

/** Job pushed onto the queue when a user clicks "Submit". */
export interface SubmitJob {
  type: "submit";
  submissionId: string;
  userId: string;
  problemId: string;
  language: RunnableLanguage;
  code: string;
}

export type QueueJob = ExecJob | SubmitJob;

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
