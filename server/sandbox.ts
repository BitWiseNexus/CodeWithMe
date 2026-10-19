import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { MAX_OUTPUT_BYTES, type ExecJob, type RunnableLanguage } from "@/lib/exec";
import { MAX_JUDGE_OUTPUT_BYTES, type TestRunRecord } from "@/lib/judge";

/** Wall-clock limit for a Run (custom stdin). */
export const RUN_TIMEOUT_S = 8;
/** C++ only: separate wall-clock limit for compiling. */
const COMPILE_TIMEOUT_S = 15;
/** Must match the flags the precompiled header was built with (sandbox/cpp/Dockerfile). */
const CPP_FLAGS = "-std=c++17 -O2 -pipe";
/** Programs get 256 MB, whatever the container size (C++ needs compiler headroom). */
const PROGRAM_MEMORY_KB = 256 * 1024;
/** A judged batch never runs longer than this, however many tests it has. */
const MAX_BATCH_MS = 120_000;

interface Runtime {
  image: string;
  /** Container memory. C++ gets extra headroom for the compiler. */
  memory: string;
  /** Writable scratch dir. Only C++ may execute files there (its binary). */
  tmpfs: string;
  /** Max size of any file written (RLIMIT_FSIZE), in bytes. */
  maxFileBytes: number;
  /** Source file name inside /tmp. */
  file: string;
  /** Compile command (compiled languages only); must exit non-zero on failure. */
  compile?: string;
  /** Command that runs the program. */
  run: string;
  /** Cap the program with `ulimit -v` (when the container itself is larger). */
  limitMemory?: boolean;
}

const RUNTIMES: Record<RunnableLanguage, Runtime> = {
  python: {
    image: "python:3.12-alpine",
    memory: "256m",
    tmpfs: "/tmp:rw,size=16m,noexec,nosuid,nodev,mode=1777",
    maxFileBytes: 1024 * 1024,
    file: "main.py",
    run: "python /tmp/main.py",
  },
  javascript: {
    image: "node:20-alpine",
    memory: "256m",
    tmpfs: "/tmp:rw,size=16m,noexec,nosuid,nodev,mode=1777",
    maxFileBytes: 1024 * 1024,
    file: "main.js",
    run: "node /tmp/main.js",
  },
  cpp: {
    // Built locally from sandbox/cpp/Dockerfile (npm run sandbox:images).
    image: "codewithme-cpp",
    memory: "512m",
    tmpfs: "/tmp:rw,exec,size=64m,nosuid,nodev,mode=1777",
    maxFileBytes: 64 * 1024 * 1024,
    file: "main.cpp",
    compile: `g++ ${CPP_FLAGS} -o /tmp/main /tmp/main.cpp`,
    run: "/tmp/main",
    limitMemory: true,
  },
};

// ---------------------------------------------------------------------------
// Shell building blocks. Everything runs under busybox `sh` in the image.
// ---------------------------------------------------------------------------

/**
 * Line 1 of stdin is the program source in base64 (command lines are length-
 * limited: ~32k chars on Windows, 128 KiB per argument on Linux).
 */
const decodeSource = (rt: Runtime) =>
  `read -r CODE && printf %s "$CODE" | base64 -d > /tmp/${rt.file} || exit 1`;

/** The program under `timeout` (exits 137 when it kills), memory-capped if needed. */
const timedProgram = (rt: Runtime, seconds: string) =>
  rt.limitMemory
    ? `(ulimit -v ${PROGRAM_MEMORY_KB}; exec timeout -s KILL ${seconds} ${rt.run})`
    : `timeout -s KILL ${seconds} ${rt.run}`;

/** Sets $ms to the milliseconds between two /proc/uptime readings $t0 and $t1. */
const ELAPSED_MS = `ms=$(awk -v a="$t0" -v b="$t1" 'BEGIN{printf "%d", (b-a)*1000}')`;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s: string) => Buffer.from(s, "base64").toString("utf8");

/** Run mode: compile if needed, then run once on the rest of stdin. */
function runScript(rt: Runtime): string {
  const limitMs = RUN_TIMEOUT_S * 1000;
  return [
    decodeSource(rt),
    ...(rt.compile
      ? [
          `if ! timeout -s KILL ${COMPILE_TIMEOUT_S} ${rt.compile}; then`,
          `  printf '\\n[Compilation failed]\\n' >&2; exit 1`,
          `fi`,
        ]
      : []),
    `read t0 _ < /proc/uptime`,
    timedProgram(rt, String(RUN_TIMEOUT_S)),
    `code=$?`,
    `read t1 _ < /proc/uptime`,
    ELAPSED_MS,
    `if [ "$code" -eq 137 ]; then`,
    `  if [ "$ms" -ge ${limitMs - 50} ]; then`,
    `    printf '\\n[Killed: exceeded ${RUN_TIMEOUT_S}s time limit]\\n' >&2`,
    `  else`,
    `    printf '\\n[Killed: memory limit exceeded]\\n' >&2`,
    `  fi`,
    `fi`,
    `exit $code`,
  ].join("\n");
}

/**
 * Judge mode. stdin: line 1 = source (base64), line 2 = N, then N lines of
 * test input (base64). stdout protocol, one item per line:
 *   CE            then the compiler output (base64) — and nothing else
 *   S             compiled/ready; tests start now
 *   T i code ms bytes   then the program's stdout and stderr (base64, capped)
 *   END
 * Expected outputs never enter the container: the worker compares them.
 * A crash or timeout ends the batch early (the first failure is the verdict).
 */
function judgeScript(rt: Runtime, timeLimitS: string): string {
  return [
    decodeSource(rt),
    ...(rt.compile
      ? [
          `if ! timeout -s KILL ${COMPILE_TIMEOUT_S} ${rt.compile} 2> /tmp/cerr; then`,
          `  echo CE; head -c 8192 /tmp/cerr | base64 | tr -d '\\n'; echo; exit 0`,
          `fi`,
        ]
      : []),
    `read -r N || exit 1`,
    `echo S`,
    `i=0`,
    `while [ "$i" -lt "$N" ]; do`,
    `  read -r IN || exit 1`,
    `  printf %s "$IN" | base64 -d > /tmp/in`,
    `  read t0 _ < /proc/uptime`,
    `  ${timedProgram(rt, timeLimitS)} < /tmp/in > /tmp/out 2> /tmp/err`,
    `  code=$?`,
    `  read t1 _ < /proc/uptime`,
    `  ${ELAPSED_MS}`,
    `  printf 'T %s %s %s %s\\n' "$i" "$code" "$ms" "$(wc -c < /tmp/out)"`,
    `  head -c ${MAX_JUDGE_OUTPUT_BYTES} /tmp/out | base64 | tr -d '\\n'; echo`,
    `  head -c 2048 /tmp/err | base64 | tr -d '\\n'; echo`,
    `  [ "$code" -ne 0 ] && break`,
    `  i=$((i + 1))`,
    `done`,
    `echo END`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

/** Collects a byte stream up to `limit` bytes and remembers if anything was cut. */
export class CappedBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  truncated = false;

  constructor(private readonly limit: number) {}

  push(chunk: Buffer) {
    if (chunk.length === 0) return;
    const room = this.limit - this.size;
    if (chunk.length > room) {
      this.truncated = true;
      if (room > 0) this.chunks.push(chunk.subarray(0, room));
      this.size = this.limit;
      return;
    }
    this.chunks.push(chunk);
    this.size += chunk.length;
  }

  toString() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

/**
 * Builds the `docker run` arguments. The program source is NOT in here — it
 * arrives on stdin (see `decodeSource`).
 */
export function dockerArgs(
  language: RunnableLanguage,
  containerName: string,
  script: string = runScript(RUNTIMES[language])
): string[] {
  const rt = RUNTIMES[language];
  return [
    "run",
    "--rm",
    "-i",
    "--pull",
    "never", // a missing image fails fast instead of downloading mid-run
    "--name",
    containerName,
    "--network",
    "none", // no internet / no localhost access
    "--memory",
    rt.memory,
    "--memory-swap",
    rt.memory, // disallow swap escape
    "--cpus",
    "0.5",
    "--pids-limit",
    "64", // fork-bomb guard
    "--read-only", // immutable root fs...
    "--tmpfs",
    rt.tmpfs, // ...with a small writable scratch dir
    "--user",
    "65534:65534", // "nobody" — never root inside the container
    "--ulimit",
    "nofile=128:128",
    "--ulimit",
    `fsize=${rt.maxFileBytes}:${rt.maxFileBytes}`,
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    rt.image,
    "sh",
    "-c",
    script,
  ];
}

interface ContainerExit {
  exitCode: number | null;
  /** Our wall-clock safety net killed the container. */
  timedOut: boolean;
  /** The docker CLI itself didn't exit in time and was killed. */
  stuck?: boolean;
  /** The docker CLI couldn't be started at all. */
  spawnError?: string;
}

/** Starts one sandbox container, feeds it `input`, and supervises it. */
function startContainer(opts: {
  language: RunnableLanguage;
  script: string;
  input: string;
  timeoutMs: number;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
}): { done: Promise<ContainerExit>; kill: () => void; stdout: NodeJS.ReadableStream } {
  const name = `cwm-exec-${randomUUID().slice(0, 12)}`;
  const child = spawn("docker", dockerArgs(opts.language, name, opts.script));
  const kill = () => {
    spawn("docker", ["kill", name]).on("error", () => {});
  };

  if (opts.onStdout) child.stdout.on("data", opts.onStdout);
  if (opts.onStderr) child.stderr.on("data", opts.onStderr);
  child.stdin.on("error", () => {}); // ignore EPIPE if the program exits early
  child.stdin.end(opts.input);

  const done = new Promise<ContainerExit>((resolve) => {
    let settled = false;
    let timedOut = false;
    const finish = (exit: ContainerExit) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hardStop);
      resolve(exit);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill(); // --rm cleans it up
    }, opts.timeoutMs);
    // Last resort: never let a stuck docker CLI hang the worker.
    const hardStop = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ exitCode: null, timedOut: true, stuck: true });
    }, opts.timeoutMs + 10_000);

    child.on("close", (code) => finish({ exitCode: code, timedOut }));
    child.on("error", (e) => finish({ exitCode: null, timedOut: false, spawnError: e.message }));
  });

  return { done, kill, stdout: child.stdout };
}

/** Explains docker-level failures (exit 125) that aren't the user's fault. */
function infraProblem(rt: Runtime, exit: ContainerExit, dockerStderr: string): string | null {
  if (exit.spawnError) return `failed to start the sandbox: ${exit.spawnError}`;
  if (exit.stuck) return "the sandbox did not stop in time";
  if (exit.exitCode === 125) {
    return /No such image/i.test(dockerStderr)
      ? `sandbox image "${rt.image}" is missing — run: npm run sandbox:images`
      : `docker failed: ${dockerStderr.trim().slice(0, 300)}`;
  }
  return null;
}

/**
 * Removes sandbox containers a crashed worker left behind. Only containers
 * that never started or already stopped — running ones are left alone.
 * Resolves with how many were removed.
 */
export function removeOrphanedContainers(): Promise<number> {
  return new Promise((resolve) => {
    const ps = spawn("docker", [
      "ps",
      "-aq",
      "--filter",
      "name=cwm-exec-",
      "--filter",
      "status=created",
      "--filter",
      "status=exited",
    ]);
    let out = "";
    ps.stdout.on("data", (c: Buffer) => (out += c.toString()));
    ps.on("error", () => resolve(0));
    ps.on("close", () => {
      const ids = out.split(/\s+/).filter(Boolean);
      if (ids.length === 0) return resolve(0);
      spawn("docker", ["rm", "-f", ...ids])
        .on("close", () => resolve(ids.length))
        .on("error", () => resolve(0));
    });
  });
}

// ---------------------------------------------------------------------------
// Run: one execution with custom stdin
// ---------------------------------------------------------------------------

export interface RunOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  /** True when stdout or stderr hit MAX_OUTPUT_BYTES. */
  truncated: boolean;
}

/** Run untrusted code in a throwaway, locked-down container. */
export async function runInSandbox(
  job: Pick<ExecJob, "language" | "code" | "stdin">
): Promise<RunOutcome> {
  const rt = RUNTIMES[job.language];
  const stdout = new CappedBuffer(MAX_OUTPUT_BYTES);
  const stderr = new CappedBuffer(MAX_OUTPUT_BYTES);
  // The in-container `timeout` enforces the real limit; this is a safety net.
  const timeoutMs = (RUN_TIMEOUT_S + (rt.compile ? COMPILE_TIMEOUT_S : 0) + 5) * 1000;

  const { done } = startContainer({
    language: job.language,
    script: runScript(rt),
    input: `${b64(job.code)}\n${job.stdin}`,
    timeoutMs,
    onStdout: (c) => stdout.push(c),
    onStderr: (c) => stderr.push(c),
  });
  const exit = await done;

  let err = stderr.toString();
  const infra = infraProblem(rt, exit, err);
  if (infra) err += `\n[worker] ${infra}`;
  else if (exit.timedOut) err += `\n[Killed: exceeded the ${timeoutMs / 1000}s limit]`;

  return {
    stdout: stdout.toString(),
    stderr: err,
    exitCode: exit.exitCode,
    timedOut: exit.timedOut,
    truncated: stdout.truncated || stderr.truncated,
  };
}

// ---------------------------------------------------------------------------
// Judge: one container per batch of tests
// ---------------------------------------------------------------------------

export interface BatchOutcome {
  /** C++ compile failure: the compiler's output. */
  compileError?: string;
  /** One record per test that finished, in order. */
  records: TestRunRecord[];
  /** Why the batch stopped before every test reported (if it did). */
  aborted?: "timeout" | "protocol";
  /** The sandbox itself failed (not the user's fault). */
  infraError?: string;
}

/**
 * Runs the program once per input inside a single container and returns what
 * each run printed. Comparing against expected outputs is the caller's job.
 */
export async function runBatch(
  language: RunnableLanguage,
  code: string,
  inputs: string[],
  timeLimitMs: number
): Promise<BatchOutcome> {
  const rt = RUNTIMES[language];
  const timeoutMs = Math.min(
    MAX_BATCH_MS,
    (rt.compile ? COMPILE_TIMEOUT_S * 1000 : 0) + inputs.length * (timeLimitMs + 1000) + 5000
  );
  const dockerStderr = new CappedBuffer(16 * 1024);
  const input = [b64(code), String(inputs.length), ...inputs.map(b64)].join("\n") + "\n";

  const container = startContainer({
    language,
    script: judgeScript(rt, (timeLimitMs / 1000).toFixed(3)),
    input,
    timeoutMs,
    onStderr: (c) => dockerStderr.push(c),
  });

  const outcome: BatchOutcome = { records: [] };
  // Host-side clock per test: a program that kills the runner to escape its
  // `timeout` still can't take longer than this between two results.
  const maxGapMs = timeLimitMs + 2000;
  type ParserState = "start" | "header" | "stdout" | "stderr" | "compile" | "done";
  let expect: ParserState = "start";
  let header: { exitCode: number; timeMs: number; outputBytes: number } | null = null;
  let stdoutB64 = "";
  let lastMark = 0;
  let tooSlow = false;

  const protocolError = () => {
    if (expect === "done") return;
    outcome.aborted = "protocol";
    expect = "done";
    container.kill();
  };

  const lines = createInterface({ input: container.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    switch (expect) {
      case "start":
        if (line === "S") {
          expect = "header";
          lastMark = Date.now();
        } else if (line === "CE") {
          expect = "compile";
        } else protocolError();
        return;
      case "compile":
        outcome.compileError = unb64(line);
        expect = "done";
        return;
      case "header": {
        if (line === "END") {
          expect = "done";
          return;
        }
        const m = /^T (\d+) (\d+) (\d+) (\d+)$/.exec(line);
        if (!m || Number(m[1]) !== outcome.records.length) return protocolError();
        const now = Date.now();
        const gap = now - lastMark;
        lastMark = now;
        header = { exitCode: Number(m[2]), timeMs: Number(m[3]), outputBytes: Number(m[4]) };
        if (gap > maxGapMs) {
          // Took longer than allowed in real time: treat as a time limit kill.
          header = { ...header, exitCode: 137, timeMs: gap };
          tooSlow = true;
        }
        expect = "stdout";
        return;
      }
      case "stdout":
        stdoutB64 = line;
        expect = "stderr";
        return;
      case "stderr":
        outcome.records.push({ ...header!, stdout: unb64(stdoutB64), stderr: unb64(line) });
        if (tooSlow) {
          expect = "done";
          container.kill();
        } else {
          expect = "header";
        }
        return;
      case "done":
        // Anything after END/CE/abort is ignored (and suspicious, but harmless).
        return;
    }
  });

  // Let readline drain every line before reading the outcome (bounded, in
  // case a stuck docker CLI never closes its stdout).
  const linesClosed = new Promise<void>((resolve) => lines.once("close", resolve));
  const exit = await container.done;
  await Promise.race([linesClosed, new Promise((r) => setTimeout(r, 1000))]);

  const infra = infraProblem(rt, exit, dockerStderr.toString());
  if (infra) return { records: outcome.records, infraError: infra };

  // (cast: `expect` is updated inside the readline callback, which TS can't see)
  if ((expect as ParserState) !== "done" && !outcome.aborted) {
    outcome.aborted = exit.timedOut ? "timeout" : "protocol";
  }
  return outcome;
}
