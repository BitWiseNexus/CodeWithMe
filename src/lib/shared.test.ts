import { describe, expect, it } from "vitest";
import { colorFor, isValidRoomId, roomChannel } from "@/lib/collab";
import { execRoom, isRunnable } from "@/lib/exec";
import { isLanguage } from "@/lib/types";

describe("language helpers", () => {
  it("knows which languages exist and which can run", () => {
    expect(isLanguage("cpp")).toBe(true);
    expect(isLanguage("ruby")).toBe(false);
    expect(isRunnable("python")).toBe(true);
    expect(isRunnable("javascript")).toBe(true);
    expect(isRunnable("cpp")).toBe(false);
    expect(isRunnable(undefined)).toBe(false);
  });
});

describe("realtime room names", () => {
  it("keeps collaborative rooms and execution rooms apart", () => {
    expect(roomChannel("exec:abc")).not.toBe(execRoom("abc"));
    expect(roomChannel("a1b2c3d4")).toBe("room:a1b2c3d4");
  });

  it("only accepts URL-safe room ids", () => {
    expect(isValidRoomId("a1b2c3d4")).toBe(true);
    expect(isValidRoomId("exec:abc")).toBe(false);
    expect(isValidRoomId("")).toBe(false);
    expect(isValidRoomId("x".repeat(65))).toBe(false);
  });
});

describe("colorFor", () => {
  it("is stable for the same seed and returns a hex colour", () => {
    expect(colorFor("ada@example.com")).toBe(colorFor("ada@example.com"));
    expect(colorFor("ada@example.com")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
