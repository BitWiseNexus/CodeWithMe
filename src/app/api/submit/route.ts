import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { problemExists } from "@/lib/db/problems";
import { createSubmission, markSubmissionFailed } from "@/lib/db/submissions";
import { enqueueJob, queuedJobCount, rateLimit } from "@/lib/redis";
import { MAX_CODE_CHARS, MAX_QUEUED_JOBS, isRunnable, type SubmitJob } from "@/lib/exec";

/** Per-user submissions allowed per minute (each one runs every test). */
const SUBMITS_PER_MINUTE = 6;

const unavailable = () =>
  NextResponse.json(
    { error: "Judging is temporarily unavailable. Please try again." },
    { status: 503 }
  );

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { language?: unknown; code?: unknown; problemId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { language, code, problemId } = body;
  if (!isRunnable(language)) {
    return NextResponse.json(
      { error: `Unsupported language: ${String(language)}` },
      { status: 400 }
    );
  }
  if (typeof code !== "string" || !code.trim()) {
    return NextResponse.json({ error: "Write some code first." }, { status: 400 });
  }
  if (code.length > MAX_CODE_CHARS) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  try {
    const limited = await rateLimit(`submit:${user.id}`, SUBMITS_PER_MINUTE, 60);
    if (!limited.ok) {
      return NextResponse.json(
        { error: `Too many submissions. Try again in ${limited.retryAfterSec}s.` },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
      );
    }
    if ((await queuedJobCount()) >= MAX_QUEUED_JOBS) {
      return NextResponse.json(
        { error: "The judge is busy. Please try again in a moment." },
        { status: 503 }
      );
    }
  } catch {
    return unavailable();
  }

  let submissionId: string;
  try {
    if (!(await problemExists(problemId))) {
      return NextResponse.json({ error: "Unknown problem" }, { status: 400 });
    }
    submissionId = await createSubmission({
      userId: user.id,
      problemId: problemId as string,
      language,
      code,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not create submission" },
      { status: 500 }
    );
  }

  const job: SubmitJob = {
    type: "submit",
    submissionId,
    userId: user.id,
    problemId: problemId as string,
    language,
    code,
  };
  try {
    await enqueueJob(job);
  } catch {
    await markSubmissionFailed(submissionId, "Could not queue the job").catch(() => {});
    return unavailable();
  }

  return NextResponse.json({ submissionId });
}
