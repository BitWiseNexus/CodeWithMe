import { describe, expect, it } from "vitest";
import { validateProblemInput } from "@/lib/problem-input";

const valid = {
  slug: "sum-two",
  title: "Sum Two",
  difficulty: "easy",
  description: "Add two numbers.",
  input_format: "Two integers.",
  output_format: "Their sum.",
  constraints: "",
  time_limit_ms: 2000,
  comparator: "tokens",
  starter_code: { python: "print(sum(map(int, input().split())))", cpp: "   " },
  tests: [
    { input: "1 2\n", expected: "3", sample: true },
    { input: "5 5\n", expected: "10" },
  ],
};

describe("validateProblemInput", () => {
  it("accepts and normalises a valid problem", () => {
    const res = validateProblemInput(valid);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.starter_code).toEqual({ python: valid.starter_code.python }); // blank C++ dropped
    expect(res.value.tests[1].sample).toBe(false);
  });

  it("rejects bad slugs, limits and comparators", () => {
    const res = validateProblemInput({
      ...valid,
      slug: "Bad Slug",
      time_limit_ms: 50,
      comparator: "fuzzy",
      difficulty: "insane",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join(" ")).toMatch(/Slug/);
    expect(res.errors.join(" ")).toMatch(/Time limit/);
    expect(res.errors.join(" ")).toMatch(/Comparator/);
    expect(res.errors.join(" ")).toMatch(/difficulty/);
  });

  it("accepts float comparators", () => {
    expect(validateProblemInput({ ...valid, comparator: "float:1e-6" }).ok).toBe(true);
    expect(validateProblemInput({ ...valid, comparator: "float:0.001" }).ok).toBe(true);
    expect(validateProblemInput({ ...valid, comparator: "float:" }).ok).toBe(false);
  });

  it("requires tests with expected output", () => {
    expect(validateProblemInput({ ...valid, tests: [] }).ok).toBe(false);
    const res = validateProblemInput({ ...valid, tests: [{ input: "1", expected: "  " }] });
    expect(res.ok).toBe(false);
  });

  it("survives garbage input", () => {
    expect(validateProblemInput(null).ok).toBe(false);
    expect(validateProblemInput("x").ok).toBe(false);
    expect(validateProblemInput({ tests: "nope" }).ok).toBe(false);
  });
});
