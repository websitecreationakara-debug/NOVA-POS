import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Makes Cloudflare bindings (env vars, etc.) available via getCloudflareContext()
// during `next dev`. No-op unless running under the Cloudflare dev server.
void initOpenNextCloudflareForDev();

// Basic hardening headers. No full Content-Security-Policy on purpose: Next's
// inline scripts would need nonces, and a wrong CSP breaks pages -- only
// frame-ancestors is set. HSTS starts short; raise max-age once it's proven.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=2592000" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
