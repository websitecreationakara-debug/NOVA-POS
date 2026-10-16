import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";

// Real-time Purchase sync to Meta's Conversions API, fired right after an
// order is created with status 'paid' (charge_order / create_online_order
// insert orders as 'paid' directly -- there is no separate "mark paid" step).
// Unlike a historical backfill, event_time here is always "now", so it is
// never rejected by Meta's 7-day event-age limit (see scripts/meta-crm-backfill.mjs).
//
// Must never throw into the caller: a Meta API hiccup can't be allowed to
// fail or slow down a sale that's already been committed to the database.
// Call sites should schedule this with next/server's after() so the fetch
// gets a chance to finish on Vercel after the response has been sent,
// instead of being cancelled fire-and-forget.

type BrandSlug = "bosba-premium-foods" | "bosba-drink-snack" | "sora-sake";

const DATASETS: Record<BrandSlug, { datasetId: string; tokenEnv: string }> = {
  "bosba-premium-foods": { datasetId: "557782553161482", tokenEnv: "META_ACCESS_TOKEN" },
  "sora-sake": { datasetId: "609436530954785", tokenEnv: "META_ACCESS_TOKEN" },
  // No token covers this dataset yet -- generate one in Events Manager >
  // BOSBA Drink&Snack > Settings > Conversions API > Set up direct
  // integration, then set META_ACCESS_TOKEN_DRINK_SNACK. Until then, sends
  // for this brand are skipped (logged, not thrown).
  "bosba-drink-snack": { datasetId: "965650992440513", tokenEnv: "META_ACCESS_TOKEN_DRINK_SNACK" },
};

const API_VERSION = process.env.META_API_VERSION || "v21.0";
const COUNTRY_CODE = "kh";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashField(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = String(value).trim().toLowerCase();
  return cleaned ? sha256(cleaned) : null;
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits || null;
}

function normalizeGender(value: string | null | undefined): "m" | "f" | null {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (v === "m" || v === "male") return "m";
  if (v === "f" || v === "female") return "f";
  return null;
}

function normalizeDob(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).slice(0, 10).replace(/\D/g, "");
  return digits.length === 8 ? digits : null;
}

interface CustomerRow {
  id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  second_phone: string | null;
  email: string | null;
  gender: string | null;
  page_uid: string | null;
  state: string | null;
  dob: string | null;
}

function buildUserData(customer: CustomerRow) {
  const userData: Record<string, string[] | string> = {};

  const phones = [customer.phone, customer.second_phone].map(normalizePhone).filter((p): p is string => Boolean(p));
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

  const st = hashField(customer.state);
  if (st) userData.st = [st];

  const db = normalizeDob(customer.dob);
  if (db) userData.db = [sha256(db)];

  userData.country = [sha256(COUNTRY_CODE)];
  userData.external_id = [sha256(customer.id)];

  if (customer.page_uid?.trim()) {
    userData.page_scoped_user_id = customer.page_uid.trim();
  }

  return userData;
}

export async function sendPurchaseEvent(orderId: string): Promise<void> {
  try {
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("id, paid_at, created_at, total, customer_id, brand_id, channel")
      .eq("id", orderId)
      .single();

    if (error || !order?.customer_id) {
      return; // No linked customer -- nothing to match on, skip silently.
    }

    const { data: brand } = await supabaseAdmin.from("brands").select("slug").eq("id", order.brand_id).single();
    const slug = brand?.slug as BrandSlug | undefined;
    const dataset = slug ? DATASETS[slug] : undefined;
    if (!dataset) {
      console.warn(`metaConversions: unknown or unmapped brand slug "${slug}" for order ${orderId}`);
      return;
    }

    const { data: customer } = await supabaseAdmin
      .from("customers")
      .select("id, name, first_name, last_name, phone, second_phone, email, gender, page_uid, state, dob")
      .eq("id", order.customer_id)
      .single();
    if (!customer) return;

    const accessToken = process.env[dataset.tokenEnv];
    if (!accessToken) {
      console.warn(
        `metaConversions: ${dataset.tokenEnv} not set -- skipping Purchase sync for order ${orderId} (${slug})`
      );
      return;
    }

    const tsSource = order.paid_at ?? order.created_at;
    const eventTime = Math.floor(new Date(tsSource).getTime() / 1000);
    if (!Number.isFinite(eventTime)) return;

    const event = {
      event_name: "Purchase",
      event_time: eventTime,
      event_id: `nova_order_${order.id}`,
      // "online" storefront orders (create_online_order) came through a
      // website checkout; everything else (charge_order -- in-store,
      // Telegram, or Meta/Messenger sales) was taken in person.
      action_source: order.channel === "online" ? "website" : "physical_store",
      user_data: buildUserData(customer as CustomerRow),
      custom_data: {
        currency: "USD",
        value: Number(order.total) || 0,
        order_id: order.id,
      },
    };

    const url = `https://graph.facebook.com/${API_VERSION}/${dataset.datasetId}/events?access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [event] }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      console.error(`metaConversions: send failed for order ${orderId} (${slug})`, res.status, body);
    }
  } catch (e) {
    // Best effort -- must never fail an order that's already been taken.
    console.error(`metaConversions: unexpected error syncing order ${orderId}`, e);
  }
}
