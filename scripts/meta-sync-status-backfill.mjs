// One-off: stamp customers.meta_sync_status = 'connected' for customers whose
// Meta Conversions API events were already being sent successfully in production
// BEFORE migration 0112 added the column -- without this, the CRM "Meta Conv."
// column (src/app/(app)/marketing/MarketingClient.tsx) would show every
// long-time customer as "Not connected" until their *next* order, even though
// their data has been reaching Meta all along.
//
// Scope: a customer counts as backfillable "connected" if they have at least
// one 'paid' order on a brand whose Meta access token is configured (same
// brand -> dataset/token mapping as src/lib/metaConversions.ts). This mirrors
// what resolveEventContext() actually gates sends on.
//
// Only touches customers where meta_sync_status IS NULL -- a customer already
// marked 'failed' by a real send is left alone rather than guessed over, since
// that reflects an actual recent attempt, not a data gap.
//
// Usage:
//   node scripts/meta-sync-status-backfill.mjs                # dry run, prints what would change
//   node scripts/meta-sync-status-backfill.mjs --apply         # writes the update

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvLocal() {
  let raw;
  try {
    raw = readFileSync(join(root, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

loadEnvLocal();

const APPLY = process.argv.includes("--apply");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Same brand -> token mapping as src/lib/metaConversions.ts -- only brands
// with a token actually configured ever produce a real send.
const DATASETS = {
  "bosba-premium-foods": { tokenEnv: "META_ACCESS_TOKEN" },
  "sora-sake": { tokenEnv: "META_ACCESS_TOKEN" },
  "bosba-drink-snack": { tokenEnv: "META_ACCESS_TOKEN_DRINK_SNACK" },
};

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (checked env + .env.local).");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchPaidCustomerIdsForConfiguredBrands() {
  const configuredSlugs = Object.entries(DATASETS)
    .filter(([, d]) => Boolean(process.env[d.tokenEnv]))
    .map(([slug]) => slug);
  if (!configuredSlugs.length) {
    console.log("No Meta access token is configured for any brand -- nothing to backfill.");
    return new Set();
  }
  console.log(`Brands with a configured Meta token: ${configuredSlugs.join(", ")}`);

  const ids = new Set();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("orders")
      .select("customer_id, brands!orders_brand_id_fkey(slug)")
      .eq("status", "paid")
      .not("customer_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (configuredSlugs.includes(row.brands?.slug)) ids.add(row.customer_id);
    }
    if (data.length < pageSize) break;
  }
  return ids;
}

async function main() {
  const candidateIds = [...(await fetchPaidCustomerIdsForConfiguredBrands())];
  console.log(`${candidateIds.length} customer(s) have a paid order on a Meta-configured brand.`);
  if (!candidateIds.length) return;

  // Only touch customers with no status yet -- never overwrite a 'failed' from
  // an actual recent send attempt.
  const unsetIds = [];
  for (const batch of chunk(candidateIds, 150)) {
    const { data, error } = await supabase
      .from("customers")
      .select("id")
      .in("id", batch)
      .is("meta_sync_status", null);
    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    unsetIds.push(...data.map((r) => r.id));
  }
  console.log(`${unsetIds.length} of those customer(s) currently have no meta_sync_status set.`);

  if (!APPLY) {
    console.log("\nDry run only -- nothing was written. Re-run with --apply to mark them 'connected'.");
    return;
  }

  const now = new Date().toISOString();
  let updated = 0;
  for (const batch of chunk(unsetIds, 150)) {
    const { error, count } = await supabase
      .from("customers")
      .update({ meta_sync_status: "connected", meta_synced_at: now })
      .in("id", batch)
      .is("meta_sync_status", null)
      .select("id", { count: "exact", head: true });
    if (error) throw new Error(`Supabase update failed: ${error.message}`);
    updated += count ?? batch.length;
  }
  console.log(`Done. Marked ${updated} customer(s) as 'connected'.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
