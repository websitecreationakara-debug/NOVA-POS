// One-off: split the shared CRM customer list into 3 CSVs, one per brand
// (BOSBA Premium Foods, BOSBA Drink&Snack, SORA SAKE), based on actual
// purchase history. Customers are shared across brands in NOVA POS (no
// brand_id on the customers table) -- a customer's brand is derived from
// their paid orders via order_brands (handles orders that mix products from
// multiple brands, each with a revenue `share`).
//
// A customer is assigned to the single brand they've spent the most with
// (ties broken by paid order count, then brand name). Customers with no paid
// orders at all can't be attributed to a brand and are written to
// customers-unassigned.csv instead.
//
// Usage:
//   node scripts/split-customers-by-brand.mjs
//
// Environment (checked in process.env, then .env.local):
//   NEXT_PUBLIC_SUPABASE_URL      same as the app
//   SUPABASE_SERVICE_ROLE_KEY     same as the app (bypasses RLS to read all customers/orders)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (checked env + .env.local)."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function fetchAll(table, select) {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Supabase query on ${table} failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows, columns) {
  const header = columns.join(",");
  const lines = rows.map((row) => columns.map((c) => csvEscape(row[c])).join(","));
  return [header, ...lines].join("\n") + "\n";
}

async function main() {
  console.log("Fetching brands, customers, paid orders and order_brands...");

  const brands = await fetchAll("brands", "id, slug, name");
  const brandById = new Map(brands.map((b) => [b.id, b]));

  const customers = await fetchAll(
    "customers",
    "id, name, first_name, last_name, phone, second_phone, email, address, gender, dob, customer_since, created_at"
  );
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const orders = await fetchAll(
    "orders",
    "id, customer_id, total, status, paid_at"
  );
  const paidOrderById = new Map(
    orders.filter((o) => o.status === "paid" && o.customer_id).map((o) => [o.id, o])
  );

  const orderBrands = await fetchAll("order_brands", "order_id, brand_id, share");

  console.log(
    `Fetched ${brands.length} brand(s), ${customers.length} customer(s), ` +
      `${paidOrderById.size} paid order(s) with a customer, ${orderBrands.length} order_brands row(s).`
  );

  // spend[customerId][brandId] = { amount, orderCount }
  const spend = new Map();
  for (const ob of orderBrands) {
    const order = paidOrderById.get(ob.order_id);
    if (!order) continue; // order not paid, or has no linked customer
    const customerId = order.customer_id;
    const amount = (Number(order.total) || 0) * Number(ob.share);

    let byBrand = spend.get(customerId);
    if (!byBrand) {
      byBrand = new Map();
      spend.set(customerId, byBrand);
    }
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
        (entry.amount === best.entry.amount &&
          entry.orderCount === best.entry.orderCount &&
          brand.name < best.brand.name)
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

  const columns = [
    "id",
    "name",
    "first_name",
    "last_name",
    "phone",
    "second_phone",
    "email",
    "address",
    "gender",
    "dob",
    "customer_since",
    "created_at",
  ];

  const outDir = join(root, "scripts", "customer-brand-split");
  mkdirSync(outDir, { recursive: true });

  for (const [slug, rows] of Object.entries(byBrandSlug)) {
    const outPath = join(outDir, `customers-${slug}.csv`);
    writeFileSync(outPath, toCsv(rows, columns));
    console.log(`${slug}: ${rows.length} customer(s) -> ${outPath}`);
  }

  const unassignedPath = join(outDir, "customers-unassigned.csv");
  writeFileSync(unassignedPath, toCsv(unassigned, columns));
  console.log(`unassigned (no paid order history): ${unassigned.length} customer(s) -> ${unassignedPath}`);

  console.log(`Total customers: ${customers.length}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
