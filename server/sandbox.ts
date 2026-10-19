import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { MAX_OUTPUT_BYTES, type ExecJob, type RunnableLanguage } from "@/lib/exec";

/** Wall-clock limit for the user's program. */
export const RUN_TIMEOUT_S = 8;
/** C++ only: separate wall-clock limit for compiling. */
const COMPILE_TIMEOUT_S = 15;
/** Must match the flags the precompiled header was built with (sandbox/cpp/Dockerfile). */
const CPP_FLAGS = "-std=c++17 -O2 -pipe";

/**
 * Line 1 of stdin is the program source in base64 (command lines are length-
 * limited: ~32k chars on Windows, 128 KiB per argument on Linux). The rest of
 * stdin is left for the program.
 */
const decodeTo = (file: string) => `read -r CODE && printf %s "$CODE" | base64 -d > /tmp/${file}`;

interface Runtime {
  image: string;
  /** Shell script run inside the container. */
  script: string;
  /** Container memory. C++ needs headroom for the compiler. */
  memory: string;
  /** Writable scratch dir. Only C++ may execute files there (its binary). */
  tmpfs: string;
  /** Max size of any file written (RLIMIT_FSIZE), in bytes. */
  maxFileBytes: number;
  /** Worker-side safety net: the whole container is killed after this. */
  timeoutMs: number;
}

const RUNTIMES: Record<RunnableLanguage, Runtime> = {
  python: {
    image: "python:3.12-alpine",
    script: `${decodeTo("main.py")} && exec python /tmp/main.py`,
    memory: "256m",
    tmpfs: "/tmp:rw,size=16m,noexec,nosuid,nodev,mode=1777",
    maxFileBytes: 1024 * 1024,
    timeoutMs: RUN_TIMEOUT_S * 1000,
  },
  javascript: {
    image: "node:20-alpine",
    script: `${decodeTo("main.js")} && exec node /tmp/main.js`,
    memory: "256m",
    tmpfs: "/tmp:rw,size=16m,noexec,nosuid,nodev,mode=1777",
    maxFileBytes: 1024 * 1024,
    timeoutMs: RUN_TIMEOUT_S * 1000,
  },
  cpp: {
    // Built locally from sandbox/cpp/Dockerfile (npm run sandbox:images).
    image: "codewithme-cpp",
    // Compile and run get separate limits via busybox `timeout` (exits 137
    // when it kills). The program itself is held to 256 MB like the others,
    // via `ulimit -v`; the container's 512 MB is headroom for the compiler.
    script: [
      `${decodeTo("main.cpp")} || exit 1`,
      `if ! timeout -s KILL ${COMPILE_TIMEOUT_S} g++ ${CPP_FLAGS} -o /tmp/main /tmp/main.cpp; then`,
      `  printf '\\n[Compilation failed]\\n' >&2; exit 1`,
      `fi`,
      `start=$(date +%s)`,
      `(ulimit -v 262144; exec timeout -s KILL ${RUN_TIMEOUT_S} /tmp/main)`,
      `code=$?`,
      `if [ "$code" -eq 137 ]; then`,
      `  if [ $(( $(date +%s) - start )) -ge ${RUN_TIMEOUT_S} ]; then`,
      `    printf '\\n[Killed: exceeded ${RUN_TIMEOUT_S}s time limit]\\n' >&2`,
      `  else`,
      `    printf '\\n[Killed: memory limit exceeded]\\n' >&2`,
      `  fi`,
      `fi`,
      `exit $code`,
    ].join("\n"),
    memory: "512m",
    tmpfs: "/tmp:rw,exec,size=64m,nosuid,nodev,mode=1777",
    maxFileBytes: 64 * 1024 * 1024,
    timeoutMs: (COMPILE_TIMEOUT_S + RUN_TIMEOUT_S + 5) * 1000,
  },
};

export interface RunOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  /** True when stdout or stderr hit MAX_OUTPUT_BYTES. */
  truncated: boolean;
}

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
 * Builds the `docker run` arguments for one job. The program source is NOT in
 * here — it arrives on stdin (see `decodeTo`).
 */
export function dockerArgs(language: RunnableLanguage, containerName: string): string[] {
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
    rt.script,
  ];
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

/** Run untrusted code in a throwaway, locked-down container. */
export function runInSandbox(job: Pick<ExecJob, "language" | "code" | "stdin">): Promise<RunOutcome> {
  const rt = RUNTIMES[job.language];
  const containerName = `cwm-exec-${randomUUID().slice(0, 12)}`;
  const codeB64 = Buffer.from(job.code, "utf8").toString("base64");

  return new Promise((resolve) => {
    const child = spawn("docker", dockerArgs(job.language, containerName));
    const stdout = new CappedBuffer(MAX_OUTPUT_BYTES);
    const stderr = new CappedBuffer(MAX_OUTPUT_BYTES);
    let timedOut = false;
    let settled = false;

    const finish = (outcome: Omit<RunOutcome, "truncated">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hardStop);
      resolve({ ...outcome, truncated: stdout.truncated || stderr.truncated });
    };

    child.stdout.on("data", (c: Buffer) => stdout.push(c));
    child.stderr.on("data", (c: Buffer) => stderr.push(c));

    // Line 1: the program (base64). Then the user's stdin.
    child.stdin.on("error", () => {}); // ignore EPIPE if the program exits early
    child.stdin.write(`${codeB64}\n`);
    child.stdin.write(job.stdin);
    child.stdin.end();

    const timer = setTimeout(() => {
      timedOut = true;
      // Forcibly stop the container; --rm cleans it up.
      spawn("docker", ["kill", containerName]).on("error", () => {});
    }, rt.timeoutMs);

    // Last resort: never let a stuck docker CLI hang the worker.
    const hardStop = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        stdout: stdout.toString(),
        stderr: stderr.toString() + "\n[worker] sandbox did not stop in time",
        exitCode: null,
        timedOut: true,
      });
    }, rt.timeoutMs + 10_000);

    child.on("close", (code) => {
      let err = stderr.toString();
      if (timedOut) err += `\n[Killed: exceeded ${rt.timeoutMs / 1000}s time limit]`;
      // Exit 125 = docker itself failed (e.g. the image isn't on this machine).
      if (code === 125 && /No such image/i.test(err)) {
        err += `\n[worker] sandbox image "${rt.image}" is missing — run: npm run sandbox:images`;
      }
      finish({ stdout: stdout.toString(), stderr: err, exitCode: code, timedOut });
    });

    child.on("error", (e) => {
      finish({
        stdout: stdout.toString(),
        stderr: stderr.toString() + `\n[worker] failed to start container: ${e.message}`,
        exitCode: null,
        timedOut: false,
      });
    });
  });
}
