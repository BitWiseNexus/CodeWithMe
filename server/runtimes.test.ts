import { describe, expect, it } from "vitest";
import { RUNTIMES, resolveRuntimes } from "./runtimes";

const base = {
  python: { image: "py", source: "main.py", run: "python /tmp/main.py" },
  javascript: { image: "node", source: "main.js", run: "node /tmp/main.js" },
  cpp: { image: "c", source: "main.cpp", compile: "cc", run: "/tmp/main", compileMemoryMb: 512 },
};

describe("resolveRuntimes", () => {
  it("loads sandbox/runtimes.json for every runnable language", () => {
    expect(Object.keys(RUNTIMES).sort()).toEqual(["cpp", "javascript", "python"]);
  });

  it("derives limits from the config, not from the language name", () => {
    const r = resolveRuntimes(base);
    // Interpreted: no exec in /tmp, container = program memory.
    expect(r.python.tmpfs).toContain("noexec");
    expect(r.python.containerMb).toBe(256);
    // Anything with a compile step may execute its binary and gets compiler headroom.
    expect(r.cpp.tmpfs).toMatch(/,exec,/);
    expect(r.cpp.containerMb).toBe(512);
    expect(r.cpp.programMb).toBe(256);
  });

  it("treats a newly configured compiled language the same way", () => {
    const r = resolveRuntimes({ ...base, python: { ...base.python, compile: "py_compile" } });
    expect(r.python.tmpfs).toMatch(/,exec,/);
  });

  it("rejects incomplete or unsafe entries", () => {
    const noCpp = { python: base.python, javascript: base.javascript };
    expect(() => resolveRuntimes(noCpp)).toThrow(/"cpp" is missing/);
    expect(() => resolveRuntimes({ ...base, cpp: { ...base.cpp, run: "" } })).toThrow(/run is required/);
    expect(() => resolveRuntimes({ ...base, cpp: { ...base.cpp, source: "../x.cpp" } })).toThrow(/plain file name/);
  });
});
