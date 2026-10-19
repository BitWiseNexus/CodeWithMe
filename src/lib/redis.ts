import "server-only";
import Redis from "ioredis";

/**
 * Shared ioredis connection for the Next.js server (route handlers). Reused
 * across hot reloads in dev so we don't leak connections.
 *
 * `lazyConnect` defers connecting until the first command, so importing this
 * module (e.g. during `next build`) doesn't try to reach Redis.
 */
const globalForRedis = globalThis as unknown as { redis?: Redis };

function createRedis() {
  const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });
  // Without a listener ioredis logs "Unhandled error event" on every retry.
  let lastError = "";
  client.on("error", (e: Error) => {
    if (e.message !== lastError) console.error("[redis]", e.message);
    lastError = e.message;
  });
  client.on("ready", () => (lastError = ""));
  return client;
}

export const redis = globalForRedis.redis ?? createRedis();

if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;

/**
 * Fixed-window rate limiter: allows `limit` hits per `windowSec` per key.
 * Returns how long to wait when the limit is exceeded.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const fullKey = `codewithme:ratelimit:${key}`;
  // SET NX starts the window with its expiry; INCR keeps that TTL.
  const results = await redis
    .multi()
    .set(fullKey, 0, "EX", windowSec, "NX")
    .incr(fullKey)
    .ttl(fullKey)
    .exec();

  const count = Number(results?.[1]?.[1] ?? 0);
  if (count <= limit) return { ok: true };

  const ttl = Number(results?.[2]?.[1] ?? windowSec);
  return { ok: false, retryAfterSec: ttl > 0 ? ttl : windowSec };
}
