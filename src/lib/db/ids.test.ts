import { describe, expect, it } from "vitest";
import { isValidDocId } from "@/lib/db/ids";

describe("isValidDocId", () => {
  it("accepts slugs and Firestore auto ids", () => {
    expect(isValidDocId("two-sum")).toBe(true);
    expect(isValidDocId("aB3dE5fG7hJ9kL1mN3pQ")).toBe(true);
  });

  it("rejects ids Firestore would misread or refuse", () => {
    expect(isValidDocId("")).toBe(false);
    expect(isValidDocId("a/b")).toBe(false);
    expect(isValidDocId(".")).toBe(false);
    expect(isValidDocId("..")).toBe(false);
    expect(isValidDocId("__reserved__")).toBe(false);
    expect(isValidDocId("x".repeat(257))).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isValidDocId(undefined)).toBe(false);
    expect(isValidDocId(123)).toBe(false);
    expect(isValidDocId({})).toBe(false);
  });
});
