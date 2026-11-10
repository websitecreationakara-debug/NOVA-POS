// Daily: sync NOVA POS's current customer list into Meta Custom Audiences, one per brand
// (BOSBA Premium Foods, BOSBA Drink&Snack, SORA SAKE) plus a shared "Unassigned" audience for
// customers with no paid order on any brand. Reads straight from Supabase and uploads in one
// run -- no CSV step.
//
// A Custom Audience is a static contact list (not timestamped events), so unlike
// meta-crm-backfill.mjs's events it is NOT subject to the "event must be within 7 days" rule --
// this is the only correct path for keeping customers with older purchase history represented
// in Meta for ad targeting. Re-uploading the full current list every run is safe: Meta de-dupes
// already-present hashed identifiers, so there's no harm (and no way to "remove" someone who no
// longer qualifies -- Meta's Custom Audience API has no bulk-replace, only add/remove by row).
//
// Brand attribution matches split-customers-by-brand.mjs: customers are shared across brands in
// NOVA POS (no brand_id on the customers table), so each customer's brand is the one they've
// spent the most with, via order_brands' per-order revenue `share` (ties broken by paid order
// count, then brand name).
//
// This is the automated counterpart to the one-off scripts/split-customers-by-brand.mjs +
// scripts/upload-custom-audiences.mjs pair (kept for manual CSV inspection); run this one on a
// schedule instead.
//
// Usage:
//   node scripts/meta-audience-sync.mjs --dry-run     # build + hash locally, no API calls
//   node scripts/meta-audience-sync.mjs               # real sync, all brands + unassigned
//   node scripts/meta-audience-sync.mjs --only=sora-sake
//
// Environment (checked in process.env, then .env.local):
//   NEXT_PUBLIC_SUPABASE_URL      same as the app
//   SUPABASE_SERVICE_ROLE_KEY     same as the app (bypasses RLS to read all customers/orders)
//   META_ADS_ACCESS_TOKEN         system user token with ads_management on all 3 ad accounts
//   META_API_VERSION              defaults to v21.0

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
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

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const onlyArg = args.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.split("=")[1] : null;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ACCESS_TOKEN = process.env.META_ADS_ACCESS_TOKEN || "";
const API_VERSION = process.env.META_API_VERSION || "v21.0";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (checked env + .env.local).");
  process.exit(1);
}
if (!DRY_RUN && !ACCESS_TOKEN) {
  console.error("Missing META_ADS_ACCESS_TOKEN (checked env + .env.local).");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const BRANDS = [
  { slug: "bosba-premium-foods", name: "BOSBA Premium Foods", adAccountId: "act_296047923278724" },
  { slug: "bosba-drink-snack", name: "BOSBA Drink&Snack", adAccountId: "act_416191660516853" },
  { slug: "sora-sake", name: "SORA SAKE", adAccountId: "act_1212051802789759" },
].filter((b) => !ONLY || b.slug === ONLY);

const UNASSIGNED_AUDIENCE_NAME = "NOVA POS - Unassigned CRM customers (shared)";

// ---------- Supabase reads ----------

async function fetchAll(table, select) {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  for (;;) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (error) throw new Error(`Supabase query on ${table} failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// Same attribution algorithm as split-customers-by-brand.mjs: each customer belongs to the
// single brand they've spent the most with (via order_brands' revenue share), ties broken by
// paid order count then brand name. No paid orders at all -> "unassigned".
async function attributeCustomersToBrands() {
  const [brands, customers, orders, orderBrands] = await Promise.all([
    fetchAll("brands", "id, slug, name"),
    fetchAll(
      "customers",
      "id, name, first_name, last_name, phone, second_phone, email, gender, dob"
    ),
    fetchAll("orders", "id, customer_id, total, status"),
    fetchAll("order_brands", "order_id, brand_id, share"),
  ]);

  const brandById = new Map(brands.map((b) => [b.id, b]));
  const paidOrderById = new Map(orders.filter((o) => o.status === "paid" && o.customer_id).map((o) => [o.id, o]));

  const spend = new Map(); // customerId -> brandId -> { amount, orderCount }
  for (const ob of orderBrands) {
    const order = paidOrderById.get(ob.order_id);
    if (!order) continue;
    const amount = (Number(order.total) || 0) * Number(ob.share);
    let byBrand = spend.get(order.customer_id);
    if (!byBrand) spend.set(order.customer_id, (byBrand = new Map()));
    const entry = byBrand.get(ob.brand_id) || { amount: 0, orderCount: 0 };
    entry.amount += amount;
    entry.orderCount += 1;
    byBrand.set(ob.brand_id, entry);
  }

  const byBrandSlug = { "bosba-premium-foods": [], "bosba-drink-snack": [], "sora-sake": [] };
  const unassigned = [];

  for (const customer of customers) {
    const byBrand = spend.get(customer.id);
    if (!byBrand || byBrand.size === 0) {
      unassigned.push(customer);
      continue;
    }

    let best = null;
    for (const [brandId, entry] of byBrand) {
      const brand = brandById.get(brandId);
      if (!brand) continue;
      if (
        !best ||
        entry.amount > best.entry.amount ||
        (entry.amount === best.entry.amount && entry.orderCount > best.entry.orderCount) ||
        (entry.amount === best.entry.amount && entry.orderCount === best.entry.orderCount && brand.name < best.brand.name)
      ) {
        best = { brand, entry };
      }
    }

    if (!best || !(best.brand.slug in byBrandSlug)) {
      unassigned.push(customer);
      continue;
    }
    byBrandSlug[best.brand.slug].push(customer);
  }

  return { byBrandSlug, unassigned };
}

// ---------- hashing + Custom Audience schema ----------
// https://developers.facebook.com/docs/marketing-api/audiences/guides/custom-audiences

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashField(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim().toLowerCase();
  return cleaned ? sha256(cleaned) : null;
}

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits || null;
}

const SCHEMA = ["PHONE", "FN", "LN", "GEN", "DOBY", "EXTERN_ID"];

function buildRow(customer) {
  const phones = [customer.phone, customer.second_phone].map(normalizePhone).filter(Boolean);
  const ph = phones.length ? sha256(phones[0]) : "";

  let firstName = customer.first_name;
  let lastName = customer.last_name;
  if (!firstName && !lastName && customer.name) {
    const parts = customer.name.trim().split(/\s+/);
    firstName = parts[0] || "";
    lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
  }
  const fn = hashField(firstName) || "";
  const ln = hashField(lastName) || "";

  let gen = "";
  const g = (customer.gender || "").trim().toLowerCase();
  if (g === "m" || g === "male") gen = sha256("m");
  else if (g === "f" || g === "female") gen = sha256("f");

  let doby = "";
  if (customer.dob) {
    const year = String(customer.dob).slice(0, 4);
    if (/^\d{4}$/.test(year)) doby = sha256(year);
  }

  const externId = sha256(customer.id);

  // A row needs at least one real identifier besides EXTERN_ID to be useful for matching.
  if (!ph && !fn && !ln) return null;

  return [ph, fn, ln, gen, doby, externId];
}

// ---------- Meta Graph API ----------

async function graphPost(path, body) {
  const url = `https://graph.facebook.com/${API_VERSION}/${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: ACCESS_TOKEN }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`POST ${path} -> HTTP ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function graphGet(path, params) {
  const qs = new URLSearchParams({ ...params, access_token: ACCESS_TOKEN });
  const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${path}?${qs}`);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function findOrCreateAudience(adAccountId, logLabel, audienceName, description) {
  const existing = await graphGet(`${adAccountId}/customaudiences`, { fields: "id,name", limit: "200" });
  const match = (existing.data || []).find((a) => a.name === audienceName);
  if (match) return match.id;

  const created = await graphPost(`${adAccountId}/customaudiences`, {
    name: audienceName,
    subtype: "CUSTOM",
    description,
    customer_file_source: "USER_PROVIDED_ONLY",
  });
  console.log(`${logLabel}: created new audience "${audienceName}" (${created.id})`);
  return created.id;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function syncList(logLabel, adAccountId, audienceName, description, customers) {
  const rows = customers.map(buildRow).filter(Boolean);
  const skipped = customers.length - rows.length;
  console.log(
    `${logLabel}: ${customers.length} customer(s), ${rows.length} with a usable identifier` +
      (skipped ? `, ${skipped} skipped (no phone/name)` : "")
  );

  if (DRY_RUN || rows.length === 0) return;

  const audienceId = await findOrCreateAudience(adAccountId, logLabel, audienceName, description);
  const batches = chunk(rows, 10000); // Meta's /users endpoint allows large batches; keep well under limits.
  for (let i = 0; i < batches.length; i++) {
    const result = await graphPost(`${audienceId}/users`, { payload: { schema: SCHEMA, data: batches[i] } });
    console.log(
      `${logLabel}: batch ${i + 1}/${batches.length} -> num_received=${result.num_received} num_invalid_entries=${result.num_invalid_entries}`
    );
  }
}

async function main() {
  console.log(`Fetching customers and attributing them to brands by purchase history (${DRY_RUN ? "dry run" : "live"})...`);
  const { byBrandSlug, unassigned } = await attributeCustomersToBrands();

  for (const brand of BRANDS) {
    await syncList(
      brand.slug,
      brand.adAccountId,
      `${brand.name} - CRM customers`,
      `CRM customers attributed to ${brand.name}, synced daily from NOVA POS.`,
      byBrandSlug[brand.slug]
    );
  }

  if (!ONLY) {
    for (const brand of BRANDS) {
      await syncList(
        `unassigned/${brand.slug}`,
        brand.adAccountId,
        UNASSIGNED_AUDIENCE_NAME,
        "CRM customers with no paid order on any brand, synced daily from NOVA POS. Same list shared across all 3 ad accounts.",
        unassigned
      );
    }
  }

  if (DRY_RUN) console.log("Dry run only -- nothing was sent to Meta.");
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
