import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every route in this app is dynamic (server-rendered per request), so there is
// no ISR/SSG output to cache — the default no-op incremental cache is fine and
// avoids needing an R2 bucket + service binding.
export default defineCloudflareConfig();
