import Redis from "ioredis";
import { io as ioClient } from "socket.io-client";
import { FieldValue } from "firebase-admin/firestore";
import { EXEC_QUEUE, isRunnable, type ExecJob, type ExecResult } from "@/lib/exec";
import { requireWorkerSecret } from "./config";
import { getAdminDb } from "./firebaseAdmin";
import { removeOrphanedContainers, runInSandbox } from "./sandbox";

// --- config ---
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3001";
const WORKER_SECRET = requireWorkerSecret();
/** BRPOP block time. Longer = fewer idle Redis commands (matters on Upstash). */
const POLL_SECONDS = 30;
/** A slow/unavailable Firestore must not stall the queue. */
const DB_WRITE_TIMEOUT_MS = 10_000;

// A library promise we never see (e.g. the Firestore client failing to load
// credentials) must not kill the worker mid-job and orphan its container.
process.on("unhandledRejection", (e) =>
  console.error("[worker] unhandled rejection:", e instanceof Error ? e.message : e)
);

// Admin SDK: writes results directly (clients have no Firestore access).
const db = getAdminDb();
const executionRef = (id: string) => db.collection("executions").doc(id);

// Dedicated connection for the blocking BRPOP.
const redis = new Redis(REDIS_URL);
redis.on("error", (e) => console.error("[worker] redis:", e.message));

// Persistent socket to the /worker namespace so we can push results.
const socket = ioClient(`${SOCKET_URL}/worker`, {
  auth: { secret: WORKER_SECRET },
  transports: ["websocket"],
});
socket.on("connect", () => console.log("[worker] connected to socket server"));
socket.on("connect_error", (e) =>
  console.error("[worker] socket connect_error:", e.message)
);

async function processJob(job: ExecJob) {
  console.log(`[worker] running ${job.executionId} (${job.language})`);
  // DB writes are best-effort and time-boxed: a failing or slow Firestore must
  // not delay the run or stop the result from reaching the browser.
  const record = (data: Record<string, unknown>) =>
    Promise.race([
      executionRef(job.executionId).update(data),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timed out")), DB_WRITE_TIMEOUT_MS).unref()
      ),
    ]).catch((e) =>
      console.error(`[worker] db update failed for ${job.executionId}:`, e instanceof Error ? e.message : e)
    );

  const markedRunning = record({ status: "running" }); // don't wait before running

  const outcome = await runInSandbox(job);
  const result: ExecResult = {
    executionId: job.executionId,
    status: outcome.timedOut ? "error" : "done",
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    exitCode: outcome.exitCode,
    truncated: outcome.truncated,
  };

  // Deliver first; the stored copy is for the polling fallback and history.
  socket.emit("result", result);
  console.log(`[worker] done ${job.executionId} (exit ${outcome.exitCode})`);

  // Keep writes ordered so "running" can never land after the final status.
  await markedRunning;
  await record({
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exitCode,
    truncated: result.truncated,
    finished_at: FieldValue.serverTimestamp(),
  });
}

function parseJob(raw: string): ExecJob | null {
  try {
    const job = JSON.parse(raw) as ExecJob;
    if (
      typeof job.executionId === "string" &&
      isRunnable(job.language) &&
      typeof job.code === "string" &&
      typeof job.stdin === "string"
    ) {
      return job;
    }
  } catch {
    // fall through
  }
  return null;
}

async function main() {
  const removed = await removeOrphanedContainers();
  if (removed) console.log(`[worker] removed ${removed} orphaned sandbox container(s)`);

  console.log("[worker] waiting for jobs on", EXEC_QUEUE);
  for (;;) {
    try {
      // BRPOP returns [key, value] or null on timeout.
      const res = await redis.brpop(EXEC_QUEUE, POLL_SECONDS);
      if (!res) continue;
      const job = parseJob(res[1]);
      if (!job) {
        console.error("[worker] dropping malformed job:", res[1].slice(0, 200));
        continue;
      }
      // Run jobs sequentially for simplicity; one container at a time.
      await processJob(job).catch((e) =>
        console.error("[worker] job failed:", e)
      );
    } catch (e) {
      console.error("[worker] loop error:", e);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

main();
