import { describe, expect, it } from "vitest";
import { REALTIME_TOKEN_TTL_S, signRealtimeToken, verifyRealtimeToken } from "@/lib/realtime-token";

const me = { uid: "u1", name: "ada", color: "#3b82f6" };

describe("realtime tokens", () => {
  it("round-trips the identity", () => {
    expect(verifyRealtimeToken(signRealtimeToken(me, "s"), "s")).toEqual(me);
  });

  it("rejects a wrong secret, tampering and garbage", () => {
    const token = signRealtimeToken(me, "s");
    expect(verifyRealtimeToken(token, "other")).toBeNull();
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...me, name: "mallory", exp: 9e9 })).toString("base64url");
    expect(verifyRealtimeToken(`${forged}.${sig}`, "s")).toBeNull();
    expect(verifyRealtimeToken(`${payload}.${sig}.x`, "s")).toBeNull();
    expect(verifyRealtimeToken("nope", "s")).toBeNull();
    expect(verifyRealtimeToken(undefined, "s")).toBeNull();
  });

  it("expires", () => {
    const issued = Date.now();
    const token = signRealtimeToken(me, "s", issued);
    expect(verifyRealtimeToken(token, "s", issued + (REALTIME_TOKEN_TTL_S - 1) * 1000)).toEqual(me);
    expect(verifyRealtimeToken(token, "s", issued + (REALTIME_TOKEN_TTL_S + 1) * 1000)).toBeNull();
  });
});
