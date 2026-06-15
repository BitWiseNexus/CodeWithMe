import "server-only";
import Redis from "ioredis";

/**
 * Shared ioredis connection for the Next.js server (route handlers). Reused
 * across hot reloads in dev so we don't leak connections.
 */
const globalForRedis = globalThis as unknown as { redis?: Redis };

export const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 3,
  });

if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;
