import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { MAX_OUTPUT_BYTES, type ExecJob, type RunnableLanguage } from "@/lib/exec";

/** Wall-clock limit per run. */
export const TIMEOUT_MS = 8_000;

// Per-language sandbox image + filename + run command.
const RUNTIMES: Record<RunnableLanguage, { image: string; file: string; cmd: string }> = {
  python: { image: "python:3.12-alpine", file: "main.py", cmd: "python" },
  javascript: { image: "node:20-alpine", file: "main.js", cmd: "node" },
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
 * here: it arrives as the first line of stdin (base64), because command lines
 * are length-limited (~32k chars on Windows, 128 KiB per argument on Linux).
 */
export function dockerArgs(language: RunnableLanguage, containerName: string): string[] {
  const rt = RUNTIMES[language];
  // Read line 1 (the base64 source) into a file, then hand the rest of stdin
  // to the program.
  const script =
    `read -r CODE && printf %s "$CODE" | base64 -d > /tmp/${rt.file}` +
    ` && exec ${rt.cmd} /tmp/${rt.file}`;

  return [
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
    "/tmp:rw,size=16m,noexec,nosuid,nodev,mode=1777", // ...with a small writable scratch dir
    "--user",
    "65534:65534", // "nobody" — never root inside the container
    "--ulimit",
    "nofile=128:128",
    "--ulimit",
    "fsize=1048576:1048576", // max 1 MB per written file
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
    }, TIMEOUT_MS);

    // Last resort: never let a stuck docker CLI hang the worker.
    const hardStop = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        stdout: stdout.toString(),
        stderr: stderr.toString() + "\n[worker] sandbox did not stop in time",
        exitCode: null,
        timedOut: true,
      });
    }, TIMEOUT_MS + 10_000);

    child.on("close", (code) => {
      let err = stderr.toString();
      if (timedOut) err += `\n[Killed: exceeded ${TIMEOUT_MS / 1000}s time limit]`;
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
