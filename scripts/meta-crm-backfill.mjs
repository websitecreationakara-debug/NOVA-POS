// One-off: backfill real historical events from NOVA POS into Meta's Conversions API, routed
// to each order's own brand dataset (BOSBA Premium Foods, BOSBA Drink&Snack, Sora Sake -- same
// mapping as src/lib/metaConversions.ts). Each event is a real paid order (its actual paid_at
// date and customer), not a synthetic/placeholder event -- Meta's terms require events to
// reflect what actually happened, and backfilling fake conversions risks the ad account being
// flagged and corrupts ad optimization signal.
//
// Two event shapes, picked with --crm:
//   (default)  "Purchase" events for standard Conversions API / Ads Manager optimization.
//   --crm      "Lead" + "Customer" event pair per order, shaped for Meta's CRM Integration
//              (Events Manager > Connect your CRM): action_source "system_generated",
//              custom_data.event_source "crm". Meta's setup guide requires a trigger for
//              every funnel stage, "including the initial raw lead stage" -- NOVA POS has no
//              multi-day funnel (a customer is only recorded once they've already paid), so
//              both stages are reported at the same instant, for the same paid order.
//
// Defaults to a dry run: builds and hashes every event locally and writes a per-brand summary
// (counts only -- never raw PII) to scripts/.meta-crm-backfill-dry-run.json.
// Nothing is sent to Meta unless you pass --send.
//
// Usage:
//   node scripts/meta-crm-backfill.mjs                                   # dry run, Purchase, all orders
//   node scripts/meta-crm-backfill.mjs --crm                             # dry run, CRM Lead+Customer events
//   node scripts/meta-crm-backfill.mjs --crm --limit=5 --send --test-event-code=TEST12345
//                                                                         # verify a handful in
//                                                                         # Events Manager > Test Events
//   node scripts/meta-crm-backfill.mjs --crm --send                      # real send, all orders
//
// Environment (checked in process.env, then .env.local):
//   NEXT_PUBLIC_SUPABASE_URL          same as the app
//   SUPABASE_SERVICE_ROLE_KEY         same as the app (bypasses RLS to read all customers/orders)
//   META_ACCESS_TOKEN                 BOSBA Premium Foods + Sora Sake dataset token
//   META_ACCESS_TOKEN_DRINK_SNACK     BOSBA Drink&Snack dataset token
//   META_API_VERSION                  defaults to v21.0
//   META_ACTION_SOURCE                Purchase mode only; defaults to physical_store (in-store POS sales)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env.local loader (no dotenv dependency in this project).
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
const SEND = args.includes("--send");
const CRM = args.includes("--crm");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : null;
const testArg = args.find((a) => a.startsWith("--test-event-code="));
const TEST_EVENT_CODE = testArg ? testArg.split("=")[1] : null;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_VERSION = process.env.META_API_VERSION || "v21.0";
const ACTION_SOURCE = process.env.META_ACTION_SOURCE || "physical_store";
const BATCH_SIZE = 1000;

// Same brand -> dataset/token mapping as src/lib/metaConversions.ts.
const DATASETS = {
  "bosba-premium-foods": { datasetId: "557782553161482", tokenEnv: "META_ACCESS_TOKEN" },
  "sora-sake": { datasetId: "609436530954785", tokenEnv: "META_ACCESS_TOKEN" },
  "bosba-drink-snack": { datasetId: "965650992440513", tokenEnv: "META_ACCESS_TOKEN_DRINK_SNACK" },
};

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (checked env + .env.local)."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

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

function normalizeGender(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (v === "m" || v === "male") return "m";
  if (v === "f" || v === "female") return "f";
  return null;
}

// Meta expects db as YYYYMMDD (no separators) before hashing.
function normalizeDob(raw) {
  if (!raw) return null;
  const digits = String(raw).slice(0, 10).replace(/\D/g, "");
  return digits.length === 8 ? digits : null;
}

// All brands operate in Cambodia -- there is no per-customer country field in
// NOVA POS, so this is a safe constant rather than a guess.
const COUNTRY_CODE = "kh";

function buildUserData(customer) {
  const userData = {};

  const phones = [customer.phone, customer.second_phone]
    .map(normalizePhone)
    .filter(Boolean);
  if (phones.length) userData.ph = phones.map(sha256);

  const em = hashField(customer.email);
  if (em) userData.em = [em];

  let firstName = customer.first_name;
  let lastName = customer.last_name;
  if (!firstName && !lastName && customer.name) {
    const parts = customer.name.trim().split(/\s+/);
    firstName = parts[0] || null;
    lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
  }
  const fn = hashField(firstName);
  if (fn) userData.fn = [fn];
  const ln = hashField(lastName);
  if (ln) userData.ln = [ln];

  const gender = normalizeGender(customer.gender);
  if (gender) userData.ge = [sha256(gender)];

  // st/db/country: NOVA POS has no separate city/postal-code columns, so
  // only fields backed by a real, structured column are sent -- a guessed
  // city or zip parsed out of the free-text `address` field would create bad
  // matches more often than good ones.
  const st = hashField(customer.state);
  if (st) userData.st = [st];

  const db = normalizeDob(customer.dob);
  if (db) userData.db = [sha256(db)];

  userData.country = [sha256(COUNTRY_CODE)];

  // Always present -- guarantees every event has at least one match key.
  userData.external_id = [sha256(customer.id)];

  // PSID is sent as plain text per Meta's spec -- it is not a hashable field.
  if (customer.page_uid && customer.page_uid.trim()) {
    userData.page_scoped_user_id = customer.page_uid.trim();
  }

  return userData;
}

// Returns an array: CRM mode reports both funnel stages Meta's setup guide requires ("a
// trigger must occur for every stage of your funnel, including the initial raw lead stage")
// at the same instant, since NOVA POS has no multi-day funnel -- a customer is only ever
// recorded once they've already paid. Purchase mode is unaffected (array of one).
function buildEvents(order) {
  const customer = order.customers;
  if (!customer) return [];

  const tsSource = order.paid_at ?? order.created_at;
  const eventTime = Math.floor(new Date(tsSource).getTime() / 1000);
  if (!Number.isFinite(eventTime)) return [];

  if (CRM) {
    const userData = buildUserData(customer);
    const customData = { event_source: "crm", lead_event_source: "NOVA POS" };
    return [
      {
        event_name: "Lead",
        event_time: eventTime,
        event_id: `nova_crm_lead_${order.id}`,
        action_source: "system_generated",
        user_data: userData,
        custom_data: customData,
      },
      {
        event_name: "Customer",
        event_time: eventTime,
        event_id: `nova_crm_${order.id}`,
        action_source: "system_generated",
        user_data: userData,
        custom_data: customData,
      },
    ];
  }

  return [
    {
      event_name: "Purchase",
      event_time: eventTime,
      event_id: `nova_order_${order.id}`,
      action_source: ACTION_SOURCE,
      user_data: buildUserData(customer),
      custom_data: {
        currency: "USD",
        value: Number(order.total) || 0,
        order_id: order.id,
      },
    },
  ];
}

async function fetchPaidOrders() {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  for (;;) {
    const { data, error } = await supabase
      .from("orders")
      .select(
        `id, paid_at, created_at, total, customer_id, brand_id,
         brands!orders_brand_id_fkey ( slug ),
         customers ( id, name, first_name, last_name, phone, second_phone, email, gender, page_uid, state, dob )`
      )
      .eq("status", "paid")
      .not("customer_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function sendBatch(dataset, accessToken, batch, index, total, label) {
  const url = `https://graph.facebook.com/${API_VERSION}/${dataset.datasetId}/events?access_token=${encodeURIComponent(
    accessToken
  )}`;
  const body = { data: batch };
  if (TEST_EVENT_CODE) body.test_event_code = TEST_EVENT_CODE;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  console.log(
    `[${label}] Batch ${index + 1}/${total}: HTTP ${res.status}` +
      (json?.events_received !== undefined
        ? ` events_received=${json.events_received}`
        : ` ${JSON.stringify(json)}`)
  );
  return { ok: res.ok, status: res.status, json };
}

async function main() {
  console.log(`Fetching paid orders with a linked CRM customer from NOVA POS (${CRM ? "CRM Lead+Customer" : "Purchase"} mode)...`);
  const orders = await fetchPaidOrders();
  console.log(`Fetched ${orders.length} paid order(s) across all brands.`);

  const limited = LIMIT ? orders.slice(0, LIMIT) : orders;

  // Group by brand slug so each goes to its own dataset -- the same mapping
  // src/lib/metaConversions.ts uses for real-time events.
  const bySlug = new Map();
  let skippedUnknownBrand = 0;
  for (const order of limited) {
    const slug = order.brands?.slug;
    if (!slug || !DATASETS[slug]) {
      skippedUnknownBrand++;
      continue;
    }
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push(order);
  }
  if (skippedUnknownBrand) {
    console.log(`Skipped ${skippedUnknownBrand} order(s) with an unknown/unmapped brand.`);
  }

  const summary = {};
  const sampleEvents = {};
  let totalEvents = 0;

  for (const [slug, slugOrders] of bySlug) {
    const dataset = DATASETS[slug];
    const events = slugOrders.flatMap(buildEvents);
    totalEvents += events.length;

    const coverage = { ph: 0, em: 0, fn: 0, ln: 0, ge: 0, st: 0, db: 0, psid: 0 };
    for (const e of events) {
      if (e.user_data.ph) coverage.ph++;
      if (e.user_data.em) coverage.em++;
      if (e.user_data.fn) coverage.fn++;
      if (e.user_data.ln) coverage.ln++;
      if (e.user_data.ge) coverage.ge++;
      if (e.user_data.st) coverage.st++;
      if (e.user_data.db) coverage.db++;
      if (e.user_data.page_scoped_user_id) coverage.psid++;
    }

    summary[slug] = { datasetId: dataset.datasetId, eventCount: events.length, coverage };
    sampleEvents[slug] = events[0] ?? null;
    console.log(`[${slug}] Built ${events.length} ${CRM ? "Lead+Customer" : "Purchase"} event(s) for dataset ${dataset.datasetId}.`);
    console.log(`[${slug}] Identifier coverage:`, coverage);
  }

  if (!SEND) {
    const outPath = join(root, "scripts", ".meta-crm-backfill-dry-run.json");
    writeFileSync(outPath, JSON.stringify({ mode: CRM ? "crm" : "purchase", totalEvents, summary, sampleEvents }, null, 2));
    console.log(`\nDry run only -- nothing was sent to Meta. Summary written to ${outPath}`);
    console.log(
      "Next: get a test_event_code from Events Manager > Test Events, then run e.g.\n" +
        `  node scripts/meta-crm-backfill.mjs ${CRM ? "--crm " : ""}--limit=5 --send --test-event-code=XXXXX\n` +
        `Check it shows up in Test Events, then run the full --send without --limit/--test-event-code.`
    );
    return;
  }

  const results = [];
  for (const [slug, slugOrders] of bySlug) {
    const dataset = DATASETS[slug];
    const accessToken = process.env[dataset.tokenEnv];
    if (!accessToken) {
      console.error(`[${slug}] ${dataset.tokenEnv} is not set (checked env + .env.local) -- skipping this brand.`);
      continue;
    }

    const events = slugOrders.flatMap(buildEvents);
    const batches = chunk(events, BATCH_SIZE);
    console.log(`[${slug}] Sending ${batches.length} batch(es) of up to ${BATCH_SIZE} events each...`);
    for (let i = 0; i < batches.length; i++) {
      results.push(await sendBatch(dataset, accessToken, batches[i], i, batches.length, slug));
      if (i < batches.length - 1) await new Promise((r) => setTimeout(r, 500));
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nDone. ${results.length - failed.length}/${results.length} batch(es) succeeded.`);
  if (failed.length) {
    console.error(`${failed.length} batch(es) failed -- see batch output above for details.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
