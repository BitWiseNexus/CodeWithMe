import { describe, expect, it } from "vitest";
import { CappedBuffer, dockerArgs } from "./sandbox";

describe("CappedBuffer", () => {
  it("keeps everything under the limit", () => {
    const buf = new CappedBuffer(10);
    buf.push(Buffer.from("hello"));
    buf.push(Buffer.from("!"));
    expect(buf.toString()).toBe("hello!");
    expect(buf.truncated).toBe(false);
  });

  it("cuts at the byte limit and flags truncation", () => {
    const buf = new CappedBuffer(8);
    buf.push(Buffer.from("12345"));
    buf.push(Buffer.from("67890"));
    buf.push(Buffer.from("more"));
    expect(buf.toString()).toBe("12345678");
    expect(buf.truncated).toBe(true);
  });

  it("ignores empty chunks", () => {
    const buf = new CappedBuffer(0);
    buf.push(Buffer.alloc(0));
    expect(buf.truncated).toBe(false);
  });
});

describe("dockerArgs", () => {
  const args = dockerArgs("python", "cwm-exec-test");
  const joined = args.join(" ");

  it("applies the sandbox lockdown flags", () => {
    expect(joined).toContain("--network none");
    expect(joined).toContain("--read-only");
    expect(joined).toContain("--cap-drop ALL");
    expect(joined).toContain("--security-opt no-new-privileges");
    expect(joined).toContain("--user 65534:65534");
    expect(joined).toContain("--pids-limit 64");
  });

  it("never puts the program source on the command line", () => {
    expect(args.some((a) => a.startsWith("CODE="))).toBe(false);
    expect(args).not.toContain("-e");
  });

  it("uses the right runtime per language", () => {
    expect(args).toContain("python:3.12-alpine");
    expect(dockerArgs("javascript", "x")).toContain("node:20-alpine");
  });
});
