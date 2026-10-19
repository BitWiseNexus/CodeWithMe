import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { createExecution, markExecutionFailed } from "@/lib/db/executions";
import { problemExists } from "@/lib/db/problems";
import { rateLimit, redis } from "@/lib/redis";
import {
  EXEC_QUEUE,
  MAX_CODE_CHARS,
  MAX_STDIN_CHARS,
  isRunnable,
  type ExecJob,
} from "@/lib/exec";

/** Per-user runs allowed per minute. */
const RUNS_PER_MINUTE = 10;
/** Refuse new jobs when this many are already waiting (worker is backed up). */
const MAX_QUEUE_LENGTH = 50;

const unavailable = () =>
  NextResponse.json(
    { error: "Code execution is temporarily unavailable. Please try again." },
    { status: 503 }
  );

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    language?: unknown;
    code?: unknown;
    stdin?: unknown;
    problemId?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const language = body.language;
  const code = body.code ?? "";
  const stdin = body.stdin ?? "";
  const problemId = body.problemId ?? null;

  if (!isRunnable(language)) {
    return NextResponse.json(
      { error: `Unsupported language: ${String(language)}` },
      { status: 400 }
    );
  }
  if (typeof code !== "string" || typeof stdin !== "string") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (code.length > MAX_CODE_CHARS || stdin.length > MAX_STDIN_CHARS) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  // Rate limit per user and refuse work when the queue is backed up.
  try {
    const limited = await rateLimit(`run:${user.id}`, RUNS_PER_MINUTE, 60);
    if (!limited.ok) {
      return NextResponse.json(
        { error: `Too many runs. Try again in ${limited.retryAfterSec}s.` },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
      );
    }
    if ((await redis.llen(EXEC_QUEUE)) >= MAX_QUEUE_LENGTH) {
      return NextResponse.json(
        { error: "The runner is busy. Please try again in a moment." },
        { status: 503 }
      );
    }
  } catch {
    return unavailable();
  }

  // Record the execution for the verified user, status = queued.
  let executionId: string;
  try {
    if (problemId !== null && !(await problemExists(problemId))) {
      return NextResponse.json({ error: "Unknown problem" }, { status: 400 });
    }
    executionId = await createExecution({
      userId: user.id,
      problemId: problemId as string | null,
      language,
      code,
      stdin,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not create execution" },
      { status: 500 }
    );
  }

  // Enqueue the job for the worker. LPUSH + BRPOP = FIFO.
  const job: ExecJob = { executionId, userId: user.id, language, code, stdin };
  try {
    await redis.lpush(EXEC_QUEUE, JSON.stringify(job));
  } catch {
    // Don't leave the execution stuck in "queued" forever.
    await markExecutionFailed(executionId, "Could not queue the job").catch(() => {});
    return unavailable();
  }

  return NextResponse.json({ executionId });
}
