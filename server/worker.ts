import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { io as ioClient } from "socket.io-client";
import { createClient } from "@supabase/supabase-js";

// --- config ---
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3001";
const WORKER_SECRET = process.env.WORKER_SECRET ?? "dev-worker-secret";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const EXEC_QUEUE = "codewithme:exec:jobs";
const TIMEOUT_MS = 8_000;
const MAX_OUTPUT = 100_000; // chars per stream

interface ExecJob {
  executionId: string;
  userId: string;
  language: "python" | "javascript";
  code: string;
  stdin: string;
}

// Per-language sandbox image + filename + run command.
const RUNTIMES = {
  python: { image: "python:3.12-alpine", file: "main.py", cmd: "python" },
  javascript: { image: "node:20-alpine", file: "main.js", cmd: "node" },
} as const;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "[worker] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Dedicated connection for blocking BRPOP.
const redis = new Redis(REDIS_URL);

// Persistent socket to the /worker namespace so we can push results.
const socket = ioClient(`${SOCKET_URL}/worker`, {
  auth: { secret: WORKER_SECRET },
  transports: ["websocket"],
});
socket.on("connect", () => console.log("[worker] connected to socket server"));
socket.on("connect_error", (e) =>
  console.error("[worker] socket connect_error:", e.message)
);

interface RunOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

/** Run untrusted code in a throwaway, locked-down container. */
function runInSandbox(job: ExecJob): Promise<RunOutcome> {
  const rt = RUNTIMES[job.language];
  const containerName = `cwm-exec-${randomUUID().slice(0, 12)}`;
  const codeB64 = Buffer.from(job.code, "utf8").toString("base64");

  const args = [
    "run",
    "--rm",
    "-i",
    "--name",
    containerName,
    "--network",
    "none", // no internet / no localhost access
    "--memory",
    "256m",
    "--memory-swap",
    "256m", // disallow swap escape
    "--cpus",
    "0.5",
    "--pids-limit",
    "64", // fork-bomb guard
    "--read-only", // immutable root fs...
    "--tmpfs",
    "/tmp:rw,size=16m,noexec", // ...with a small writable scratch dir
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "-e",
    `CODE=${codeB64}`,
    rt.image,
    "sh",
    "-c",
    `echo "$CODE" | base64 -d > /tmp/${rt.file} && exec ${rt.cmd} /tmp/${rt.file}`,
  ];

  return new Promise((resolve) => {
    const child = spawn("docker", args);
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const cap = (buf: string, chunk: Buffer) =>
      buf.length >= MAX_OUTPUT ? buf : (buf + chunk.toString()).slice(0, MAX_OUTPUT);

    child.stdout.on("data", (c) => (stdout = cap(stdout, c)));
    child.stderr.on("data", (c) => (stderr = cap(stderr, c)));

    // Feed program input, then close stdin.
    child.stdin.on("error", () => {}); // ignore EPIPE if the program exits early
    child.stdin.write(job.stdin);
    child.stdin.end();

    const timer = setTimeout(() => {
      timedOut = true;
      // Forcibly stop the container; --rm cleans it up.
      spawn("docker", ["kill", containerName]);
    }, TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        stderr += `\n[Killed: exceeded ${TIMEOUT_MS / 1000}s time limit]`;
      }
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: stderr + `\n[worker] failed to start container: ${err.message}`,
        exitCode: null,
        timedOut: false,
      });
    });
  });
}

async function processJob(job: ExecJob) {
  console.log(`[worker] running ${job.executionId} (${job.language})`);
  await supabase
    .from("executions")
    .update({ status: "running" })
    .eq("id", job.executionId);

  const outcome = await runInSandbox(job);
  const status = outcome.timedOut ? "error" : "done";

  await supabase
    .from("executions")
    .update({
      status,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      exit_code: outcome.exitCode,
      finished_at: new Date().toISOString(),
    })
    .eq("id", job.executionId);

  socket.emit("result", {
    executionId: job.executionId,
    status,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    exitCode: outcome.exitCode,
  });
  console.log(`[worker] done ${job.executionId} (exit ${outcome.exitCode})`);
}

async function main() {
  console.log("[worker] waiting for jobs on", EXEC_QUEUE);
  // Use a separate blocking connection so BRPOP doesn't block other commands.
  const blocking = redis.duplicate();
  for (;;) {
    try {
      // BRPOP returns [key, value] or null on timeout.
      const res = await blocking.brpop(EXEC_QUEUE, 5);
      if (!res) continue;
      const job = JSON.parse(res[1]) as ExecJob;
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
