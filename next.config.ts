import type { NextConfig } from "next";

/**
 * Security headers for every response. The CSP only contains directives that
 * can't break the editor (Monaco loads from a CDN and uses blob: workers) or
 * WebRTC: no framing (clickjacking), no plugins, no <base> hijacking, forms
 * post only to us. A full script-src/connect-src policy is a TODO that needs
 * testing in a browser.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // HSTS only makes sense (and only works) over HTTPS, i.e. in production.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // The admin problem editor sends all tests in one Server Action call
      // (capped at ~3 MB by src/lib/problem-input.ts). Default is 1 MB.
      bodySizeLimit: "4mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
