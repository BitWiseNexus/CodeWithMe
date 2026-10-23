/**
 * Prepares every sandbox image listed in sandbox/runtimes.json: builds the
 * ones with a `build` section (passing its `args`), pulls the rest.
 *
 *   npm run sandbox:images
 */
import { spawnSync } from "node:child_process";
import { RUNTIME_CONFIG } from "../server/runtimes";

let failed = 0;
for (const [lang, rt] of Object.entries(RUNTIME_CONFIG)) {
  if (lang.startsWith("$") || typeof rt !== "object") continue; // "$comment"
  const args = rt.build
    ? [
        "build",
        "-t",
        rt.image,
        ...Object.entries(rt.build.args ?? {}).flatMap(([k, v]) => ["--build-arg", `${k}=${v}`]),
        rt.build.context,
      ]
    : ["pull", rt.image];

  console.log(`\n[sandbox:images] ${lang}: docker ${args.join(" ")}`);
  const res = spawnSync("docker", args, { stdio: "inherit" });
  if (res.status !== 0) {
    failed++;
    console.error(`[sandbox:images] ${lang} failed (${res.error?.message ?? `exit ${res.status}`})`);
  }
}

process.exit(failed ? 1 : 0);
