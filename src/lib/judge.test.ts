import { describe, expect, it } from "vitest";
import { classifyTest, outputsMatch, type TestRunRecord } from "@/lib/judge";

describe("outputsMatch", () => {
  it("tokens: ignores all whitespace differences", () => {
    expect(outputsMatch("0  1\n", "0 1", "tokens")).toBe(true);
    expect(outputsMatch("0\n1\r\n", "0 1", "tokens")).toBe(true);
    expect(outputsMatch("1 0", "0 1", "tokens")).toBe(false);
    expect(outputsMatch("0 1 2", "0 1", "tokens")).toBe(false);
  });

  it("exact: compares lines, ignoring trailing spaces and blank lines", () => {
    expect(outputsMatch("Fizz \n1\n\n\n", "Fizz\n1", "exact")).toBe(true);
    expect(outputsMatch("a b\r\nc", "a b\nc", "exact")).toBe(true);
    expect(outputsMatch("a  b", "a b", "exact")).toBe(false);
    expect(outputsMatch(" a", "a", "exact")).toBe(false);
    expect(outputsMatch("a\n\nb", "a\nb", "exact")).toBe(false);
  });

  it("float: compares numbers within a tolerance", () => {
    expect(outputsMatch("0.3333333", "0.33333333", "float:1e-6")).toBe(true);
    expect(outputsMatch("1000000.5", "1000000.0", "float:1e-6")).toBe(true); // relative
    expect(outputsMatch("0.34", "0.3333", "float:1e-6")).toBe(false);
    expect(outputsMatch("yes 1.0", "yes 1", "float:1e-9")).toBe(true);
    expect(outputsMatch("no 1.0", "yes 1", "float:1e-9")).toBe(false);
  });
});

describe("classifyTest", () => {
  const rec = (over: Partial<TestRunRecord>): TestRunRecord => ({
    exitCode: 0,
    timeMs: 30,
    outputBytes: 4,
    stdout: "0 1\n",
    stderr: "",
    ...over,
  });

  it("accepts matching output and rejects wrong output", () => {
    expect(classifyTest(rec({}), "0 1", "tokens", 2000).verdict).toBe("AC");
    expect(classifyTest(rec({ stdout: "1 0" }), "0 1", "tokens", 2000).verdict).toBe("WA");
  });

  it("tells time limit from memory kill by elapsed time", () => {
    expect(classifyTest(rec({ exitCode: 137, timeMs: 2003 }), "", "tokens", 2000).verdict).toBe("TLE");
    expect(classifyTest(rec({ exitCode: 137, timeMs: 400 }), "", "tokens", 2000).verdict).toBe("MLE");
  });

  it("maps crashes, allocation failures and output floods", () => {
    expect(classifyTest(rec({ exitCode: 1, stderr: "Traceback..." }), "", "tokens", 2000)).toEqual({
      verdict: "RE",
      reason: "Exit code 1",
    });
    expect(classifyTest(rec({ exitCode: 134, stderr: "std::bad_alloc" }), "", "tokens", 2000).verdict).toBe("MLE");
    expect(classifyTest(rec({ exitCode: 153 }), "", "tokens", 2000).reason).toBe("Output limit exceeded");
    expect(classifyTest(rec({ outputBytes: 5_000_000 }), "", "tokens", 2000).verdict).toBe("RE");
    // Python ignores SIGXFSZ: exit 1 with the file stuck at exactly the cap.
    expect(
      classifyTest(rec({ exitCode: 1, outputBytes: 1024 * 1024, stderr: "File too large" }), "", "tokens", 2000)
    ).toEqual({ verdict: "RE", reason: "Output limit exceeded" });
  });
});
