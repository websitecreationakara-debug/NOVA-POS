// One-off: upload the brand-split CRM customer lists (built by
// split-customers-by-brand.mjs) into Meta as Custom Audiences, one per ad
// account. Unlike the Conversions API Purchase backfill, a Custom Audience
// is a static contact list (not time-stamped events), so it is NOT subject
// to the "event must be within 7 days" rule -- this is the correct path for
// uploading historical customers regardless of purchase recency.
//
// Usage:
//   node scripts/upload-custom-audiences.mjs --dry-run     # hash + preview counts, no API calls
//   node scripts/upload-custom-audiences.mjs                # create/find audiences + upload
//   node scripts/upload-custom-audiences.mjs --only=sora-sake
//
// Environment (checked in process.env, then .env.local):
//   META_ADS_ACCESS_TOKEN   system user token with ads_management on all 3 ad accounts
//   META_API_VERSION        defaults to v21.0

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

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

const ACCESS_TOKEN = process.env.META_ADS_ACCESS_TOKEN || "";
const API_VERSION = process.env.META_API_VERSION || "v21.0";

if (!DRY_RUN && !ACCESS_TOKEN) {
  console.error("Missing META_ADS_ACCESS_TOKEN (checked env + .env.local).");
  process.exit(1);
}

const BRANDS = [
  {
    slug: "bosba-premium-foods",
    name: "BOSBA Premium Foods",
    adAccountId: "act_296047923278724",
    csv: "customers-bosba-premium-foods.csv",
  },
  {
    slug: "bosba-drink-snack",
    name: "BOSBA Drink&Snack",
    adAccountId: "act_416191660516853",
    csv: "customers-bosba-drink-snack.csv",
  },
  {
    slug: "sora-sake",
    name: "SORA SAKE",
    adAccountId: "act_1212051802789759",
    csv: "customers-sora-sake.csv",
  },
].filter((b) => !ONLY || b.slug === ONLY);

// Customers with no paid order on any brand -- can't be attributed to one
// business, so the same list is uploaded as-is into all 3 ad accounts under
// a shared audience name.
const UNASSIGNED_CSV = "customers-unassigned.csv";
const UNASSIGNED_AUDIENCE_NAME = "NOVA POS - Unassigned CRM customers (shared)";
const UPLOAD_UNASSIGNED = args.includes("--unassigned");

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

// CSV parser matching toCsv()/csvEscape() in split-customers-by-brand.mjs:
// double-quoted fields, "" escaping, and -- critically -- fields that contain
// embedded newlines (e.g. a multi-line address) must NOT be split on those
// newlines. Parses the whole text char-by-char rather than splitting lines
// first, so a newline inside an open quote stays part of the current cell.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\r") {
      // ignore; \n handles the line break
    } else if (c === "\n") {
      row.push(cur);
      cur = "";
      rows.push(row);
      row = [];
    } else {
      cur += c;
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }

  const dataRows = rows.filter((r) => !(r.length === 1 && r[0] === ""));
  if (dataRows.length === 0) return [];
  const header = dataRows[0];
  return dataRows.slice(1).map((cells) => {
    const obj = {};
    header.forEach((col, i) => (obj[col] = cells[i] ?? ""));
    return obj;
  });
}

// Custom Audience schema: https://developers.facebook.com/docs/marketing-api/audiences/guides/custom-audiences
// Each row's values array must follow this exact field order.
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

async function graphPost(path, body) {
  const url = `https://graph.facebook.com/${API_VERSION}/${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: ACCESS_TOKEN }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`POST ${path} -> HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function graphGet(path, params) {
  const qs = new URLSearchParams({ ...params, access_token: ACCESS_TOKEN });
  const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${path}?${qs}`);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`GET ${path} -> HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function findOrCreateAudience(adAccountId, logLabel, audienceName, description) {
  const existing = await graphGet(`${adAccountId}/customaudiences`, {
    fields: "id,name",
    limit: "200",
  });
  const match = (existing.data || []).find((a) => a.name === audienceName);
  if (match) {
    console.log(`${logLabel}: reusing existing audience "${audienceName}" (${match.id})`);
    return match.id;
  }

  const created = await graphPost(`${adAccountId}/customaudiences`, {
    name: audienceName,
    subtype: "CUSTOM",
    description,
    customer_file_source: "USER_PROVIDED_ONLY",
  });
  console.log(`${logLabel}: created audience "${audienceName}" (${created.id})`);
  return created.id;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function uploadBatch(audienceId, rows) {
  return graphPost(`${audienceId}/users`, {
    payload: { schema: SCHEMA, data: rows },
  });
}

async function main() {
  for (const brand of BRANDS) {
    const csvPath = join(root, "scripts", "customer-brand-split", brand.csv);
    let text;
    try {
      text = readFileSync(csvPath, "utf8");
    } catch {
      console.error(`${brand.slug}: missing ${csvPath} -- run split-customers-by-brand.mjs first.`);
      continue;
    }

    const customers = parseCsv(text);
    const rows = customers.map(buildRow).filter(Boolean);
    const skipped = customers.length - rows.length;

    console.log(
      `${brand.slug}: ${customers.length} customer(s) in CSV, ${rows.length} with a usable identifier` +
        (skipped ? `, ${skipped} skipped (no phone/name)` : "")
    );

    if (DRY_RUN) continue;
    if (rows.length === 0) continue;

    const audienceId = await findOrCreateAudience(
      brand.adAccountId,
      brand.slug,
      `${brand.name} - CRM customers`,
      `CRM customers attributed to ${brand.name}, uploaded from NOVA POS.`
    );
    const batches = chunk(rows, 10000); // Meta's /users endpoint allows large batches; keep well under limits.

    for (let i = 0; i < batches.length; i++) {
      const result = await uploadBatch(audienceId, batches[i]);
      console.log(
        `${brand.slug}: batch ${i + 1}/${batches.length} -> num_received=${result.num_received} num_invalid_entries=${result.num_invalid_entries}`
      );
    }
  }

  if (UPLOAD_UNASSIGNED) {
    const csvPath = join(root, "scripts", "customer-brand-split", UNASSIGNED_CSV);
    let text;
    try {
      text = readFileSync(csvPath, "utf8");
    } catch {
      console.error(`unassigned: missing ${csvPath} -- run split-customers-by-brand.mjs first.`);
      text = null;
    }

    if (text !== null) {
      const customers = parseCsv(text);
      const rows = customers.map(buildRow).filter(Boolean);
      const skipped = customers.length - rows.length;

      console.log(
        `unassigned: ${customers.length} customer(s) in CSV, ${rows.length} with a usable identifier` +
          (skipped ? `, ${skipped} skipped (no phone/name)` : "")
      );

      if (!DRY_RUN && rows.length > 0) {
        const targets = [
          { slug: "bosba-premium-foods", adAccountId: "act_296047923278724" },
          { slug: "bosba-drink-snack", adAccountId: "act_416191660516853" },
          { slug: "sora-sake", adAccountId: "act_1212051802789759" },
        ];
        const batches = chunk(rows, 10000);

        for (const target of targets) {
          const audienceId = await findOrCreateAudience(
            target.adAccountId,
            `unassigned/${target.slug}`,
            UNASSIGNED_AUDIENCE_NAME,
            "CRM customers with no paid order on any brand, uploaded from NOVA POS. Same list shared across all 3 ad accounts."
          );
          for (let i = 0; i < batches.length; i++) {
            const result = await uploadBatch(audienceId, batches[i]);
            console.log(
              `unassigned/${target.slug}: batch ${i + 1}/${batches.length} -> num_received=${result.num_received} num_invalid_entries=${result.num_invalid_entries}`
            );
          }
        }
      }
    }
  }

  if (DRY_RUN) {
    console.log("Dry run only -- nothing was sent to Meta.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
