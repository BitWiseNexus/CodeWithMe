/**
 * Shared secret between the worker and the realtime server's /worker
 * namespace. A default is only allowed outside production — otherwise anyone
 * could connect as the "worker" and push fake results.
 */
export function requireWorkerSecret(): string {
  const secret = process.env.WORKER_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    console.error("WORKER_SECRET must be set when NODE_ENV=production");
    process.exit(1);
  }
  return "dev-worker-secret";
}
