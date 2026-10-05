// Nightly backup, run by .github/workflows/backup-to-drive.yml on a GitHub runner.
//
// Reads the orders, order lines and (optionally) customers straight from
// Supabase, zips them, and hands the zip to the Google Apps Script web app that
// saves it into the shared Drive folder (scripts/google-drive-backup.gs).
//
// It runs here rather than inside the app because the app lives on Cloudflare
// Workers, whose memory/CPU limits are too small to build a backup this size
// (error 1102). A GitHub runner has plenty of room. Node built-ins only, so the
// workflow needs no npm install.
//
// Environment:
//   SUPABASE_URL                 e.g. https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    full-access key (keep it a secret)
//   GOOGLE_DRIVE_BACKUP_URL      the Apps Script web app URL
//   GOOGLE_DRIVE_BACKUP_SECRET   must equal the script's BACKUP_SECRET property
//   BACKUP_INCLUDE_CUSTOMER      "true" to include customer details; anything
//                                else leaves names/phones/emails out entirely
//   DRY_RUN=1                    build the zip locally, don't upload it
//   BACKUP_OUT_DIR               where DRY_RUN writes the zip (default: .)

import fs from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_DRIVE_BACKUP_URL, GOOGLE_DRIVE_BACKUP_SECRET } = process.env;
const includeCustomers = process.env.BACKUP_INCLUDE_CUSTOMER === "true";
const dryRun = process.env.DRY_RUN === "1";

function fail(message) {
  console.error(`Backup failed: ${message}`);
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) fail("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
if (!dryRun && (!GOOGLE_DRIVE_BACKUP_URL || !GOOGLE_DRIVE_BACKUP_SECRET)) {
  fail("GOOGLE_DRIVE_BACKUP_URL or GOOGLE_DRIVE_BACKUP_SECRET is not set");
}

// ---------- read a whole table, a page at a time ----------
const PAGE = 1000;

async function readTable(table) {
  const rows = [];
  let total = null;
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=id.asc`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Range-Unit": "items",
        Range: `${from}-${from + PAGE - 1}`,
        Prefer: "count=exact",
      },
    });
    if (!res.ok) fail(`reading ${table} returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const range = res.headers.get("content-range"); // "0-999/11998"
    if (range && range.includes("/")) total = Number(range.split("/")[1]);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  if (total !== null && rows.length !== total) {
    fail(`${table}: read ${rows.length} rows but the database reports ${total}`);
  }
  return rows;
}

// ---------- CSV ----------
function csvCell(value) {
  if (value === null || value === undefined) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const lines = [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))];
  // UTF-8 marker so Excel shows Khmer text correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// ---------- zip (deflate), no dependencies ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const raw = Buffer.from(f.data, "utf8");
    const packed = deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // file names are UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, packed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);

    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

// ---------- build ----------
// Phnom Penh calendar day (UTC+7, no daylight saving).
const day = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

const orders = await readTable("orders");
const items = await readTable("order_items");
let customers = [];
if (includeCustomers) customers = await readTable("customers");

if (!includeCustomers) {
  // Customer details stay out of the file unless asked for: the Drive folder is shared.
  for (const o of orders) {
    o.customer_name = null;
    o.customer_phone = null;
    o.customer_email = null;
  }
}

const files = [
  { name: `orders-${day}.csv`, data: toCsv(orders) },
  { name: `order_items-${day}.csv`, data: toCsv(items) },
];
if (includeCustomers) files.push({ name: `customers-${day}.csv`, data: toCsv(customers) });

const archive = zip(files);
const filename = `nova-pos-orders-backup-${day}${includeCustomers ? "" : "-no-customer"}.zip`;
console.log(
  `Built ${filename}: ${orders.length} orders, ${items.length} order lines, ` +
    `${includeCustomers ? `${customers.length} customers` : "customers left out"}, ` +
    `${(archive.length / 1048576).toFixed(2)} MB zipped`
);

if (dryRun) {
  const out = path.join(process.env.BACKUP_OUT_DIR || ".", filename);
  fs.writeFileSync(out, archive);
  console.log(`DRY_RUN: saved to ${out} (not uploaded)`);
  process.exit(0);
}

// ---------- hand it to the Google script ----------
const res = await fetch(GOOGLE_DRIVE_BACKUP_URL, {
  method: "POST",
  headers: { "Content-Type": "text/plain;charset=utf-8" },
  body: JSON.stringify({ secret: GOOGLE_DRIVE_BACKUP_SECRET, filename, base64: archive.toString("base64") }),
  redirect: "follow",
});
const text = await res.text();
let payload;
try {
  payload = JSON.parse(text);
} catch {
  fail(`the Drive script returned something that isn't JSON (HTTP ${res.status}) -- is the web app's access set to "Anyone"?`);
}
if (!res.ok || !payload.ok) fail(`the Drive script said: ${payload.error ?? `HTTP ${res.status}`}`);
console.log(`Saved to Drive: ${payload.name} (${payload.size} bytes, file id ${payload.id})`);
