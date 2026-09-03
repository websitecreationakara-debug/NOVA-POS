import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Makes Cloudflare bindings (env vars, etc.) available via getCloudflareContext()
// during `next dev`. No-op unless running under the Cloudflare dev server.
void initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
