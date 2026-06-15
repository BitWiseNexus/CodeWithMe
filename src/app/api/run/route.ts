import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { redis } from "@/lib/redis";
import { EXEC_QUEUE, type ExecJob } from "@/lib/exec";
import type { Language } from "@/lib/types";

const SUPPORTED: Language[] = ["python", "javascript"]; // C++ deferred
const MAX_CODE = 50_000;
const MAX_STDIN = 10_000;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  if (!SUPPORTED.includes(language)) {
    return NextResponse.json(
      { error: `Unsupported language: ${body.language}` },
      { status: 400 }
    );
  }
  if (code.length > MAX_CODE || stdin.length > MAX_STDIN) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  // Record the execution as the user (RLS-checked insert), status = queued.
  const { data: execution, error } = await supabase
    .from("executions")
    .insert({
      user_id: user.id,
      problem_id: body.problemId ?? null,
      language,
      code,
      stdin,
      status: "queued",
    })
    .select("id")
    .single();

  if (error || !execution) {
    return NextResponse.json(
      { error: error?.message ?? "Could not create execution" },
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
