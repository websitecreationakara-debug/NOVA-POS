// One-off: create an admin staff account directly against Supabase.
//
// The in-app /users screen can create staff, but it requires an existing admin
// session -- so the very first admin has to be made out-of-band. This uses the
// service-role key from .env.local (same client as src/lib/supabase/server.ts)
// and mirrors createStaffAccountAction: auth user + matching profiles row.
//
// Usage:
//   node scripts/create-admin.mjs "admin@example.com" "the-password" "Full Name"
// or set ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME in the environment.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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

const email = (process.argv[2] ?? process.env.ADMIN_EMAIL ?? "").trim();
const password = process.argv[3] ?? process.env.ADMIN_PASSWORD ?? "";
const fullName = (process.argv[4] ?? process.env.ADMIN_NAME ?? "Admin").trim();

if (!email || !password) {
  console.error(
    'Usage: node scripts/create-admin.mjs "<email>" "<password>" "<full name>"'
  );
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (checked env + .env.local)."
  );
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false },
});

const { data: created, error: createError } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { role: "admin", full_name: fullName },
});

if (createError || !created?.user) {
  console.error("Failed to create auth user:", createError?.message ?? createError);
  process.exit(1);
}

const { error: profileError } = await supabase
  .from("profiles")
  .upsert(
    { id: created.user.id, full_name: fullName, role: "admin" },
    { onConflict: "id" }
  );

if (profileError) {
  console.error(
    "Auth user created, but writing the profiles row failed:",
    profileError.message
  );
  console.error("User id:", created.user.id);
  process.exit(1);
}

console.log("Admin account ready.");
console.log("  email:", email);
console.log("  role:  admin");
console.log("  id:    ", created.user.id);
console.log("Sign in at /login");
