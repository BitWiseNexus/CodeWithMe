import { hostname } from "node:os";
import { io as ioClient } from "socket.io-client";
import { FieldValue } from "firebase-admin/firestore";
import {
  RUN_STREAM,
  isRunnable,
  type ExecJob,
  type ExecResult,
  type QueueJob,
  type SubmitJob,
} from "@/lib/exec";
import {
  DEFAULT_COMPARATOR,
  DEFAULT_TIME_LIMIT_MS,
  type Comparator,
  type SubmissionResult,
} from "@/lib/judge";
import { requireWorkerSecret } from "./config";
import { getAdminDb } from "./firebaseAdmin";
import { judge, type JudgeTest } from "./judge";
import { JobQueue, byPriority, type Delivery } from "./queue";
import { removeOrphanedContainers, runBatch, runInSandbox } from "./sandbox";

// --- config ---
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3001";
const WORKER_SECRET = requireWorkerSecret();
/**
 * Stable name in the consumer group: after a crash/restart this worker picks
 * up the jobs it had taken. Give each worker on the same host its own id.
 */
const WORKER_ID = process.env.WORKER_ID ?? `worker-${hostname()}`;
/** Jobs (containers) run at the same time. Each container gets 0.5 CPU. */
const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 2));
/** Blocking read time. Longer = fewer idle Redis commands (matters on Upstash). */
const BLOCK_MS = 30_000;
/** Give up on a job after this many deliveries (it keeps crashing workers). */
const MAX_DELIVERIES = 3;
/** Jobs held this long by another consumer are presumed lost and claimed. */
const STALE_MS = 5 * 60_000;
/** A slow/unavailable Firestore must not stall the queue. */
const DB_WRITE_TIMEOUT_MS = 10_000;
/** Problems + tests are cached briefly to save Firestore reads on repeat submits. */
const PROBLEM_CACHE_MS = 60_000;

// A library promise we never see (e.g. the Firestore client failing to load
// credentials) must not kill the worker mid-job and orphan its container.
process.on("unhandledRejection", (e) =>
  console.error("[worker] unhandled rejection:", e instanceof Error ? e.message : e)
);

// Admin SDK: writes results directly (clients have no Firestore access).
const db = getAdminDb();

const queue = new JobQueue(REDIS_URL, WORKER_ID);

// Persistent socket to the /worker namespace so we can push results.
const socket = ioClient(`${SOCKET_URL}/worker`, {
  auth: { secret: WORKER_SECRET },
  transports: ["websocket"],
});
socket.on("connect", () => console.log("[worker] connected to socket server"));
socket.on("connect_error", (e) =>
  console.error("[worker] socket connect_error:", e.message)
);

/**
 * Best-effort, time-boxed DB write: a failing or slow Firestore must not
 * delay a run or stop its result from reaching the browser.
 */
function bestEffort(label: string, write: () => Promise<unknown>) {
  return Promise.race([
    write(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timed out")), DB_WRITE_TIMEOUT_MS).unref()
    ),
  ]).catch((e) =>
    console.error(`[worker] db write failed (${label}):`, e instanceof Error ? e.message : e)
  );
}

// ---------------------------------------------------------------------------
// Run (custom stdin)
// ---------------------------------------------------------------------------

async function processRun(job: ExecJob) {
  console.log(`[worker] running ${job.executionId} (${job.language})`);
  const ref = db.collection("executions").doc(job.executionId);
  const markedRunning = bestEffort(job.executionId, () => ref.update({ status: "running" }));

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
  await bestEffort(job.executionId, () =>
    ref.update({
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exitCode,
      truncated: result.truncated,
      finished_at: FieldValue.serverTimestamp(),
    })
  );
}

// ---------------------------------------------------------------------------
// Submit (judge against the problem's tests)
// ---------------------------------------------------------------------------

interface JudgeProblem {
  tests: JudgeTest[];
  comparator: Comparator;
  timeLimitMs: number;
}

const problemCache = new Map<string, { at: number; problem: JudgeProblem }>();

async function loadProblem(problemId: string): Promise<JudgeProblem> {
  const cached = problemCache.get(problemId);
  if (cached && Date.now() - cached.at < PROBLEM_CACHE_MS) return cached.problem;

  const ref = db.collection("problems").doc(problemId);
  const [doc, testSnap] = await Promise.all([ref.get(), ref.collection("test_cases").get()]);
  if (!doc.exists) throw new Error(`problem ${problemId} not found`);

  const d = doc.data()!;
  const tests = testSnap.docs
    .map((t) => t.data())
    .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
    .map((t) => ({ input: t.input ?? "", expected: t.expected_output ?? "", sample: t.is_sample === true }));

  const problem: JudgeProblem = {
    tests,
    comparator: d.comparator ?? DEFAULT_COMPARATOR,
    timeLimitMs: d.time_limit_ms ?? DEFAULT_TIME_LIMIT_MS,
  };
  problemCache.set(problemId, { at: Date.now(), problem });
  return problem;
}

/** attempted → solved; never downgrades a solved problem. */
async function updateProgress(userId: string, problemId: string, solved: boolean) {
  const ref = db.collection("users").doc(userId).collection("progress").doc(problemId);
  await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    const now = FieldValue.serverTimestamp();
    if (current?.status === "solved") {
      tx.update(ref, { updated_at: now });
    } else if (solved) {
      tx.set(ref, { status: "solved", solved_at: now, updated_at: now }, { merge: true });
    } else {
      tx.set(ref, { status: "attempted", updated_at: now }, { merge: true });
    }
  });
}

async function processSubmit(job: SubmitJob) {
  console.log(`[worker] judging ${job.submissionId} (${job.language}, ${job.problemId})`);
  const ref = db.collection("submissions").doc(job.submissionId);
  const markedRunning = bestEffort(job.submissionId, () => ref.update({ status: "running" }));

  let result: SubmissionResult;
  try {
    const problem = await loadProblem(job.problemId);
    const outcome = await judge(
      problem.tests,
      { comparator: problem.comparator, timeLimitMs: problem.timeLimitMs },
      (inputs) => runBatch(job.language, job.code, inputs, problem.timeLimitMs)
    );
    result = { submissionId: job.submissionId, ...outcome };
  } catch (e) {
    result = {
      submissionId: job.submissionId,
      status: "error",
      verdict: null,
      passed: 0,
      total: 0,
      timeMs: null,
      error: `The judge failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  socket.emit("submission", result);
  console.log(
    `[worker] judged ${job.submissionId}: ${result.verdict ?? result.status} (${result.passed}/${result.total})`
  );

  await markedRunning;
  await bestEffort(job.submissionId, () =>
    ref.update({
      status: result.status,
      verdict: result.verdict,
      passed: result.passed,
      total: result.total,
      time_ms: result.timeMs,
      failed_test: result.failedTest ?? null,
      compile_output: result.compileOutput ?? null,
      error: result.error ?? null,
      finished_at: FieldValue.serverTimestamp(),
    })
  );
  if (result.status === "done") {
    await bestEffort(`progress ${job.userId}/${job.problemId}`, () =>
      updateProgress(job.userId, job.problemId, result.verdict === "AC")
    );
  }
}

// ---------------------------------------------------------------------------
// Queue loop
// ---------------------------------------------------------------------------

function parseJob(raw: string): QueueJob | null {
  try {
    const job = JSON.parse(raw) as QueueJob;
    if (!isRunnable(job.language) || typeof job.code !== "string") return null;

    if (job.type === "submit") {
      return typeof job.submissionId === "string" &&
        typeof job.userId === "string" &&
        typeof job.problemId === "string"
        ? job
        : null;
    }
    // Run jobs (older ones have no `type`).
    return typeof job.executionId === "string" && typeof job.stdin === "string" ? job : null;
  } catch {
    return null;
  }
}

/** Gives up on a job that keeps failing: tell the browser and record the error. */
async function failJob(job: QueueJob, message: string) {
  const finished_at = FieldValue.serverTimestamp();
  if (job.type === "submit") {
    const result: SubmissionResult = {
      submissionId: job.submissionId,
      status: "error",
      verdict: null,
      passed: 0,
      total: 0,
      timeMs: null,
      error: message,
    };
    socket.emit("submission", result);
    await bestEffort(job.submissionId, () =>
      db.collection("submissions").doc(job.submissionId).update({ status: "error", error: message, finished_at })
    );
  } else {
    const result: ExecResult = {
      executionId: job.executionId,
      status: "error",
      stdout: "",
      stderr: message,
      exitCode: null,
    };
    socket.emit("result", result);
    await bestEffort(job.executionId, () =>
      db.collection("executions").doc(job.executionId).update({ status: "error", error: message, finished_at })
    );
  }
}

/** Processes one delivery, then acknowledges it (removing it from the queue). */
async function handle(d: Delivery) {
  const job = parseJob(d.raw);
  try {
    if (!job) {
      console.error("[worker] dropping malformed job:", d.raw.slice(0, 200));
    } else if (d.deliveries > MAX_DELIVERIES) {
      console.error(`[worker] giving up on ${d.id} after ${d.deliveries - 1} attempts`);
      await failJob(job, "This job failed repeatedly and was dropped. Please try again.");
    } else {
      if (d.deliveries > 1) console.log(`[worker] retrying ${d.id} (attempt ${d.deliveries})`);
      await (job.type === "submit" ? processSubmit(job) : processRun(job));
    }
  } catch (e) {
    console.error("[worker] job failed:", e);
  }
  // Ack even after an error: the job ran and reported back. Redelivery is for
  // jobs whose worker died before getting here.
  await queue.ack(d).catch((e) => console.error(`[worker] ack failed for ${d.id}:`, e.message));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Deliveries taken from Redis but not started yet (runs first). */
const buffer: Delivery[] = [];
const inFlight = new Set<Promise<void>>();
let stopping = false;

async function main() {
  const removed = await removeOrphanedContainers();
  if (removed) console.log(`[worker] removed ${removed} orphaned sandbox container(s)`);

  await queue.init();
  // Jobs this worker had taken before it stopped (crash, restart) come first.
  const recovered = await queue.ownPending();
  if (recovered.length) console.log(`[worker] resuming ${recovered.length} unfinished job(s)`);
  buffer.push(...recovered);

  // Jobs held too long by a worker that never came back.
  setInterval(() => {
    queue
      .claimStale(STALE_MS)
      .then((claimed) => {
        if (!claimed.length) return;
        console.log(`[worker] claimed ${claimed.length} stale job(s)`);
        buffer.push(...claimed);
        buffer.sort(byPriority);
      })
      .catch((e) => console.error("[worker] claim failed:", e.message));
  }, 60_000).unref();

  console.log(`[worker] ${WORKER_ID} ready — up to ${CONCURRENCY} job(s) at a time`);
  while (!stopping) {
    if (inFlight.size >= CONCURRENCY) {
      await Promise.race(inFlight);
      continue;
    }
    let next: Delivery | undefined;
    try {
      // A waiting run overtakes buffered submissions.
      if (buffer.length && buffer[0].stream !== RUN_STREAM) {
        const run = await queue.nextRunNow();
        if (run) buffer.unshift(run);
      }
      if (!buffer.length) buffer.push(...(await queue.next(BLOCK_MS)));
      next = buffer.shift();
    } catch (e) {
      if (stopping) break;
      console.error("[worker] queue error:", e instanceof Error ? e.message : e);
      await sleep(1000);
      continue;
    }
    if (!next || stopping) continue;

    const work: Promise<void> = handle(next).finally(() => inFlight.delete(work));
    inFlight.add(work);
  }
}

/** Finish running jobs (bounded), then exit. Unfinished ones resume on restart. */
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal}: finishing ${inFlight.size} job(s)…`);
  await Promise.race([Promise.allSettled([...inFlight]), sleep(30_000)]);
  queue.disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});
