import { NextResponse, type NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getUser } from "@/lib/auth";
import { executionsCol, isValidDocId, problemsCol } from "@/lib/firebase/data";
import { redis } from "@/lib/redis";
import { EXEC_QUEUE, type ExecJob } from "@/lib/exec";
import type { Language } from "@/lib/types";

const SUPPORTED: Language[] = ["python", "javascript"]; // C++ deferred
const MAX_CODE = 50_000;
const MAX_STDIN = 10_000;

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    language?: string;
    code?: string;
    stdin?: string;
    problemId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const language = body.language as Language;
  const code = body.code ?? "";
  const stdin = body.stdin ?? "";
  const problemId = body.problemId ?? null;

  if (!SUPPORTED.includes(language)) {
    return NextResponse.json(
      { error: `Unsupported language: ${body.language}` },
      { status: 400 }
    );
  }
  if (typeof code !== "string" || typeof stdin !== "string") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (code.length > MAX_CODE || stdin.length > MAX_STDIN) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  if (problemId !== null && !isValidDocId(problemId)) {
    return NextResponse.json({ error: "Invalid problemId" }, { status: 400 });
  }

  // Record the execution for the verified user, status = queued.
  let execution: { id: string };
  try {
    if (problemId !== null && !(await problemsCol().doc(problemId).get()).exists) {
      return NextResponse.json({ error: "Unknown problem" }, { status: 400 });
    }
    execution = await executionsCol().add({
      user_id: user.id,
      problem_id: problemId,
      language,
      code,
      stdin,
      status: "queued",
      stdout: "",
      stderr: "",
      exit_code: null,
      error: null,
      created_at: FieldValue.serverTimestamp(),
      finished_at: null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not create execution" },
      { status: 500 }
    );
  }

  // Enqueue the job for the worker. LPUSH + BRPOP = FIFO.
  const job: ExecJob = {
    executionId: execution.id,
    userId: user.id,
    language,
    code,
    stdin,
  };
  await redis.lpush(EXEC_QUEUE, JSON.stringify(job));

  return NextResponse.json({ executionId: execution.id });
}
