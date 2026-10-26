// One-off: import the BOSBA Stock Google Sheet (one tab per month, Feb-26 .. Oct-26) into the
// Stock > Daily Ledger as ledger-only products (daily_ledger_products + daily_ledger_product_entries,
// migrations 0091 / 0092). Nothing is created in Stock, Sales or the website.
//
// Per tab: each product row becomes (or reuses) a ledger product under its group row (FROZEN FOOD,
// Chilled Items, ...), and its SKU, weight, unit price, ex-date, S-Price LOKA, TC+10%, Total Cost,
// Begining stock and the P / S / O of each day of that month are saved as typed ledger values. R and
// the totals are worked out by the ledger itself. Days that belong to the next month (the extra
// 1/Mar..4/Mar columns on the Feb tab) are skipped -- the next tab has its own.
//
// Cells that already have a typed value are never overwritten.
//
// Usage:
//   node scripts/import-daily-ledger-sheet.mjs                 dry run: parse + print counts only
//   node scripts/import-daily-ledger-sheet.mjs --apply         write to the database
//   node scripts/import-daily-ledger-sheet.mjs --dir <folder>  read <month>.csv files from a folder
//                                                              instead of downloading the tabs
//
// The sheet must be readable by "anyone with the link". Environment (process.env, then .env.local):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SHEET_ID = "1toIQKpFtPqwkwKhRD4lSZ9NYksISvG8tijhxLaPTDts";
const BRAND_NAME = "BOSBA Premium Foods";
const TABS = [
  { key: "feb", gid: "987117747" },
  { key: "mar", gid: "931055623" },
  { key: "apr", gid: "1105732378" },
  { key: "may", gid: "220838619" },
  { key: "jun", gid: "2120327979" },
  { key: "jul", gid: "1593623522" },
  { key: "aug", gid: "560812397" },
  { key: "sep", gid: "609943356" },
  { key: "oct", gid: "980289502" },
];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Sheet columns (0-based): SKU, Name, Weight/size, Unit price, Ex-Date, S-Price LOKA, TC+10%,
// Total Cost, Begining stock; then a P,S,O,R block per day starting at column 9.
const COL = { sku: 0, name: 1, weight: 2, unitPrice: 3, exDate: 4, loka: 5, tc10: 6, totalCost: 7, begin: 8 };
const HEADER_ROW = 2;
const FIRST_DATA_ROW = 4;

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

// Minimal RFC 4180 CSV parser (quoted fields, "" escapes, newlines inside quotes).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// " $ 34.00 " / "$1,020.00" / " $ -   " -> number, or null when blank / not a number.
function money(raw) {
  const s = (raw ?? "").replace(/[$,\s]/g, "");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function num(raw) {
  const s = (raw ?? "").replace(/,/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const text = (raw) => (raw ?? "").trim().replace(/\s+/g, " ");

// One tab -> { month: "YYYY-MM", rows: [{ category, sku, name, weight, entries: {field: value} }] }
function parseTab(csv) {
  const grid = parseCsv(csv);
  const title = text(grid[HEADER_ROW]?.[0]); // "Feb-2026"
  const tm = /^([A-Za-z]{3})[A-Za-z]*-(\d{4})$/.exec(title);
  const mi = tm ? MONTHS.indexOf(tm[1].toLowerCase()) : -1;
  if (mi < 0) throw new Error(`Can't read the month from the tab title "${title}"`);
  const month = `${tm[2]}-${String(mi + 1).padStart(2, "0")}`;

  // The day blocks of this month: header "12/Feb" over the P column, then S, O, R.
  const days = [];
  grid[HEADER_ROW].forEach((h, col) => {
    const m = /^(\d{1,2})\/([A-Za-z]{3})$/.exec(text(h));
    if (col > COL.begin && m && MONTHS.indexOf(m[2].toLowerCase()) === mi) days.push({ day: Number(m[1]), col });
  });
  if (days.length === 0) throw new Error(`No day columns found for ${month}`);

  const rows = [];
  let category = null;
  for (const r of grid.slice(FIRST_DATA_ROW)) {
    const name = text(r[COL.name]);
    if (!name) {
      // A group heading has only the first cell (and, after it, the group's subtotals).
      if (text(r[COL.sku])) category = text(r[COL.sku]);
      continue;
    }
    const entries = {};
    const put = (field, value) => {
      if (value !== null && value !== "") entries[field] = String(value);
    };
    put("sku", text(r[COL.sku]));
    put("weight", text(r[COL.weight]));
    put("unit_price", money(r[COL.unitPrice]));
    put("ex_date", text(r[COL.exDate]).slice(0, 40));
    put("s_price_loka", money(r[COL.loka]));
    put("tc10", money(r[COL.tc10]));
    put("total_cost", money(r[COL.totalCost]));
    put("begin", num(r[COL.begin]));
    for (const { day, col } of days) {
      const dd = String(day).padStart(2, "0");
      const p = num(r[col]);
      const s = num(r[col + 1]);
      const o = num(r[col + 2]);
      if (p) entries[`p:${dd}`] = String(p);
      if (s) entries[`s:${dd}`] = String(s);
      if (o) entries[`o:${dd}`] = String(o);
    }
    rows.push({ category, sku: text(r[COL.sku]), name, weight: text(r[COL.weight]), entries });
  }
  return { month, rows };
}

async function loadTab({ key, gid }, dir) {
  if (dir) {
    const file = join(dir, `${key}.csv`);
    if (!existsSync(file)) throw new Error(`${file} not found`);
    return readFileSync(file, "utf8");
  }
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`);
  if (!res.ok) throw new Error(`Couldn't download tab ${key} (HTTP ${res.status}) -- is the sheet shared by link?`);
  return await res.text();
}

const apply = process.argv.includes("--apply");
const dirIdx = process.argv.indexOf("--dir");
const dir = dirIdx > -1 ? process.argv[dirIdx + 1] : null;

loadEnvLocal();

// 1. Parse every tab. A product is the same SKU + weight in every month (a repeat of that within one
//    tab is told apart by its order); with no SKU, the same name + weight.
const products = new Map(); // key -> { category, name, unitPrice, months: Map<month, entries> }
const perTab = [];
for (const tab of TABS) {
  const { month, rows } = parseTab(await loadTab(tab, dir));
  const seen = new Map();
  let groupSku = "";
  let groupCategory = null;
  for (const row of rows) {
    // A row with no SKU is another size of the SKU row above it (the sheet leaves the SKU blank), so a
    // product keeps its identity when it is renamed between months (e.g. "Azuma Tako Wasabi" ->
    // "Octopus Green Takowasabi", SKU AZ020a). Without a SKU anywhere it is told apart by name.
    if (row.category !== groupCategory) groupSku = "";
    groupCategory = row.category;
    if (row.sku) groupSku = row.sku;
    const base = (groupSku ? [groupSku, row.weight] : ["", row.name, row.weight]).join("|").toLowerCase();
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const key = `${base}#${n}`;
    const p = products.get(key) ?? { name: row.name, category: row.category, unitPrice: 0, months: new Map() };
    p.name = row.name; // the latest tab's name and group win
    p.category = row.category ?? p.category;
    const price = Number(row.entries.unit_price);
    if (price > 0) p.unitPrice = price;
    p.months.set(month, row.entries);
    products.set(key, p);
  }
  perTab.push({ month, products: rows.length, values: rows.reduce((a, r) => a + Object.keys(r.entries).length, 0) });
}
console.table(perTab);
const totalValues = [...products.values()].reduce(
  (a, p) => a + [...p.months.values()].reduce((b, e) => b + Object.keys(e).length, 0),
  0
);
console.log(`${products.size} products, ${totalValues} typed values in total.`);
if (!apply) {
  console.log("Dry run -- nothing written. Re-run with --apply to import.");
  process.exit(0);
}

// 2. Write.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (checked env + .env.local).");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: brand, error: brandErr } = await supabase.from("brands").select("id").eq("name", BRAND_NAME).single();
if (brandErr || !brand) throw new Error(`Brand "${BRAND_NAME}" not found: ${brandErr?.message}`);

// Safety: running twice would duplicate every product, so stop if the brand already has many.
const { count, error: countErr } = await supabase
  .from("daily_ledger_products")
  .select("id", { count: "exact", head: true })
  .eq("brand_id", brand.id);
if (countErr) throw new Error(`${countErr.message} -- are migrations 0091 and 0092 applied?`);
if ((count ?? 0) > 5 && !process.argv.includes("--force")) {
  console.error(`${BRAND_NAME} already has ${count} ledger products -- looks already imported. Use --force to import anyway.`);
  process.exit(1);
}

const list = [...products.values()];
const ids = [];
for (let i = 0; i < list.length; i += 200) {
  const chunk = list.slice(i, i + 200);
  const { data, error } = await supabase
    .from("daily_ledger_products")
    .insert(
      chunk.map((p) => ({
        brand_id: brand.id,
        name: p.name,
        unit: "pcs",
        unit_price: p.unitPrice,
        category: p.category,
      }))
    )
    .select("id");
  if (error) throw new Error(`${error.message} -- are migrations 0091 and 0092 applied?`);
  // insert().select() returns the rows in insert order
  ids.push(...data.map((d) => d.id));
}

const entryRows = [];
list.forEach((p, i) => {
  for (const [month, entries] of p.months) {
    for (const [field, value] of Object.entries(entries)) {
      entryRows.push({ product_id: ids[i], month, field, value });
    }
  }
});
for (let i = 0; i < entryRows.length; i += 1000) {
  const { error } = await supabase
    .from("daily_ledger_product_entries")
    .upsert(entryRows.slice(i, i + 1000), { onConflict: "product_id,month,field", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}
console.log(`Imported ${list.length} products and ${entryRows.length} typed values into ${BRAND_NAME}.`);
