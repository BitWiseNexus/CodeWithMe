import { describe, expect, it } from "vitest";
import { safeRedirect } from "@/lib/redirect";

describe("safeRedirect", () => {
  it("keeps same-site paths", () => {
    expect(safeRedirect("/problems/two-sum")).toBe("/problems/two-sum");
    expect(safeRedirect("/room/abc?x=1")).toBe("/room/abc?x=1");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeRedirect("https://evil.com")).toBe("/problems");
    expect(safeRedirect("//evil.com")).toBe("/problems");
    expect(safeRedirect("/\\evil.com")).toBe("/problems");
    expect(safeRedirect("javascript:alert(1)")).toBe("/problems");
  });

  it("falls back for non-strings and empty values", () => {
    expect(safeRedirect(undefined)).toBe("/problems");
    expect(safeRedirect(null)).toBe("/problems");
    expect(safeRedirect("")).toBe("/problems");
    expect(safeRedirect(42, "/home")).toBe("/home");
  });
});
