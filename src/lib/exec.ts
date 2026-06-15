import type { Language } from "@/lib/types";

/** Redis list that the worker drains (BRPOP). */
export const EXEC_QUEUE = "codewithme:exec:jobs";

/** Job pushed onto the queue when a user clicks "Run". */
export interface ExecJob {
  executionId: string;
  userId: string;
  language: Language;
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
}
