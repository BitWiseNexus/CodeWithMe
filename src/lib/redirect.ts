/**
 * Only allow same-site relative redirects. Rejects absolute URLs and
 * protocol-relative tricks like `//evil.com` or `/\evil.com`.
 */
export function safeRedirect(target: unknown, fallback = "/problems"): string {
  return typeof target === "string" &&
    target.startsWith("/") &&
    !target.startsWith("//") &&
    !target.startsWith("/\\")
    ? target
    : fallback;
}
