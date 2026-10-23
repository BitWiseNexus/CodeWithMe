import runtimesJson from "../sandbox/runtimes.json";
import { RUNNABLE_LANGUAGES, type RunnableLanguage } from "@/lib/exec";

/** One entry of sandbox/runtimes.json. */
export interface RuntimeConfig {
  /** Docker image to run. */
  image: string;
  /** Build the image locally (npm run sandbox:images) instead of pulling it. */
  build?: { context: string; args?: Record<string, string> };
  /** File name the source is written to, inside /tmp. */
  source: string;
  /** Compile command (compiled languages only); must exit non-zero on failure. */
  compile?: string;
  /** Command that runs the program. */
  run: string;
  /** Memory for the program (default 256 MB). */
  memoryMb?: number;
  /** Container memory while compiling, if more than the program gets. */
  compileMemoryMb?: number;
  /** Size of the writable /tmp (default 16 MB). */
  scratchMb?: number;
  /** Largest file the program may write (default 1 MB). */
  maxFileMb?: number;
}

/** A runtime with every limit resolved — what server/sandbox.ts uses. */
export interface Runtime {
  image: string;
  source: string;
  compile?: string;
  run: string;
  /** Container memory: the larger of program and compiler needs. */
  containerMb: number;
  /** Program memory; enforced with `ulimit -v` when the container is larger. */
  programMb: number;
  /** /tmp mount options — executable only when a compile step produces a binary. */
  tmpfs: string;
  maxFileBytes: number;
}

const MB = 1024 * 1024;

/** Validates the config and resolves defaults. Throws with a readable message. */
export function resolveRuntimes(config: unknown): Record<RunnableLanguage, Runtime> {
  const all = (config ?? {}) as Record<string, RuntimeConfig>;
  const out = {} as Record<RunnableLanguage, Runtime>;

  for (const lang of RUNNABLE_LANGUAGES) {
    const c = all[lang];
    const where = `sandbox/runtimes.json → "${lang}"`;
    if (!c) throw new Error(`${where} is missing`);
    for (const key of ["image", "source", "run"] as const) {
      if (typeof c[key] !== "string" || !c[key].trim()) throw new Error(`${where}.${key} is required`);
    }
    if (!/^[\w.-]+$/.test(c.source)) throw new Error(`${where}.source must be a plain file name`);

    const programMb = c.memoryMb ?? 256;
    const containerMb = Math.max(programMb, c.compileMemoryMb ?? 0);
    const scratchMb = c.scratchMb ?? 16;
    out[lang] = {
      image: c.image,
      source: c.source,
      compile: c.compile,
      run: c.run,
      containerMb,
      programMb,
      tmpfs: `/tmp:rw,${c.compile ? "exec" : "noexec"},size=${scratchMb}m,nosuid,nodev,mode=1777`,
      maxFileBytes: (c.maxFileMb ?? 1) * MB,
    };
  }
  return out;
}

/** Raw config entries (for scripts/sandbox-images.ts). */
export const RUNTIME_CONFIG = runtimesJson as unknown as Record<string, RuntimeConfig>;

export const RUNTIMES = resolveRuntimes(RUNTIME_CONFIG);
