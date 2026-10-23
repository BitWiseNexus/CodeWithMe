import { createHmac, timingSafeEqual } from "node:crypto";

// Node-only (node:crypto): used by /api/realtime-token and server/index.ts.
// Never import this from a client component.

/** Who a realtime connection belongs to — set by the server, not the browser. */
export interface RealtimeIdentity {
  uid: string;
  name: string;
  color: string;
}

/** Long enough that y-webrtc's automatic reconnects keep working all day. */
export const REALTIME_TOKEN_TTL_S = 12 * 60 * 60;

/**
 * Shared by the Next app (signs) and the realtime server (verifies). A
 * default only outside production; in production a missing secret is fatal.
 */
export function realtimeSecret(): string {
  const secret = process.env.REALTIME_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("REALTIME_SECRET must be set when NODE_ENV=production");
  }
  return "dev-realtime-secret";
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");
const sign = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest();

/** `<payload>.<signature>`, both base64url. */
export function signRealtimeToken(
  identity: RealtimeIdentity,
  secret = realtimeSecret(),
  now = Date.now()
): string {
  const payload = b64url(JSON.stringify({ ...identity, exp: Math.floor(now / 1000) + REALTIME_TOKEN_TTL_S }));
  return `${payload}.${b64url(sign(payload, secret))}`;
}

/** The identity in a valid, unexpired token — or null. */
export function verifyRealtimeToken(
  token: unknown,
  secret = realtimeSecret(),
  now = Date.now()
): RealtimeIdentity | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;

  const expected = sign(payload, secret);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.exp !== "number" || data.exp * 1000 < now) return null;
    if (typeof data.uid !== "string" || typeof data.name !== "string" || typeof data.color !== "string") {
      return null;
    }
    return { uid: data.uid, name: data.name, color: data.color };
  } catch {
    return null;
  }
}
