import { describe, expect, it } from "vitest";
import type { TestRunRecord } from "@/lib/judge";
import { judge, type JudgeTest } from "./judge";
import type { BatchOutcome } from "./sandbox";

const ok = (stdout: string, timeMs = 10): TestRunRecord => ({
  exitCode: 0,
  timeMs,
  outputBytes: stdout.length,
  stdout,
  stderr: "",
});

/** Fake sandbox: answers each input with `answer(input)`. */
const runnerFrom =
  (answer: (input: string) => TestRunRecord, calls: string[][] = []) =>
  async (inputs: string[]): Promise<BatchOutcome> => {
    calls.push(inputs);
    return { records: inputs.map(answer) };
  };

const tests: JudgeTest[] = [
  { input: "s1", expected: "S1", sample: true },
  { input: "h1", expected: "H1", sample: false },
  { input: "s2", expected: "S2", sample: true },
  { input: "h2", expected: "H2", sample: false },
];
const opts = { comparator: "tokens" as const, timeLimitMs: 1000 };

describe("judge", () => {
  it("accepts when every test matches and runs samples and hidden tests separately", async () => {
    const calls: string[][] = [];
    const res = await judge(tests, opts, runnerFrom((i) => ok(i.toUpperCase(), i.length * 7), calls));
    expect(res).toMatchObject({ status: "done", verdict: "AC", passed: 4, total: 4, timeMs: 14 });
    // Samples first, hidden in a second container — never mixed.
    expect(calls).toEqual([["s1", "s2"], ["h1", "h2"]]);
  });

  it("shows input/output for a failed sample", async () => {
    const res = await judge(tests, opts, runnerFrom((i) => ok(i === "s2" ? "nope" : i.toUpperCase())));
    expect(res.verdict).toBe("WA");
    expect(res.passed).toBe(1);
    expect(res.failedTest).toMatchObject({ number: 2, sample: true, input: "s2", expected: "S2", actual: "nope" });
  });

  it("hides input/output for a failed hidden test", async () => {
    const res = await judge(tests, opts, runnerFrom((i) => ok(i === "h2" ? "leak" : i.toUpperCase())));
    expect(res.verdict).toBe("WA");
    expect(res.passed).toBe(3);
    expect(res.failedTest).toEqual({ number: 4, sample: false });
  });

  it("stops at compile errors without running hidden tests", async () => {
    const calls: string[][] = [];
    const res = await judge(tests, opts, async (inputs) => {
      calls.push(inputs);
      return { records: [], compileError: "main.cpp:1: error: expected ';'" };
    });
    expect(res).toMatchObject({ verdict: "CE", passed: 0, compileOutput: "main.cpp:1: error: expected ';'" });
    expect(calls).toHaveLength(1);
  });

  it("treats a batch that stopped early as a time limit on the next test", async () => {
    const res = await judge(tests, opts, async (inputs) =>
      inputs[0] === "s1"
        ? { records: inputs.map((i) => ok(i.toUpperCase())) }
        : { records: [ok("H1")], aborted: "timeout" }
    );
    expect(res).toMatchObject({ verdict: "TLE", passed: 3, failedTest: { number: 4, sample: false } });
  });

  it("reports judge failures as errors, not verdicts", async () => {
    const res = await judge(tests, opts, async () => ({ records: [], infraError: "image missing" }));
    expect(res).toMatchObject({ status: "error", verdict: null, error: "image missing" });
    expect((await judge([], opts, runnerFrom(() => ok("")))).status).toBe("error");
  });
});
