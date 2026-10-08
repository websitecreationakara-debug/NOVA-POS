import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { ProductSiteLink } from "@/types/database";
import { ALL_PAYMENT_METHODS, type PaymentMethod } from "@/lib/paymentMethods";
import { ppDay } from "@/lib/phnomPenhTime";

const VALID_SITES: ProductSiteLink["site"][] = [
  "bosba-premium-foods",
  "bosba-drink-snack",
  "sora-sake",
];
const VALID_PAYMENT_METHODS = ALL_PAYMENT_METHODS;

// Strip the punctuation people type into a phone field so "012 345 678",
// "012-345-678" and "012345678" resolve to ONE customer. Anything that isn't
// then 8-15 digits (optional leading +) is treated as no phone at all, rather
// than saved as junk or rejecting a paid order over a bad contact field.
// A Cambodian number typed with its local leading 0 ("0968581842") is saved the way the
// POS and the customer list keep them, with the country code: "855968581842".
function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[\s\-().]/g, "");
  if (!/^\+?\d{8,15}$/.test(cleaned)) return null;
  // "00855…" is the same number with the international call prefix.
  if (cleaned.startsWith("00")) return cleaned.slice(2);
  return /^0\d/.test(cleaned) ? `855${cleaned.slice(1)}` : cleaned;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Sanity bounds. order_items.quantity / unit_price / line_total are
// numeric(12,2): quantity is stored to 2 decimals (so < 0.01 rounds to 0 and
// trips the quantity > 0 check), and MAX_QUANTITY * MAX_UNIT_PRICE stays well
// under the ~10 billion the column holds. Anything outside these is a
// storefront bug, not a real sale -- reject it here as a clean 400 instead of
// writing absurd stock movements (or hitting a DB overflow).
const MIN_QUANTITY = 0.01;
const MAX_QUANTITY = 10_000;
const MAX_UNIT_PRICE = 100_000;
const MAX_ORDER_AMOUNT = 1_000_000_000;

// variationId is the specific size/variant the customer bought, for a
// "variable" site product -- "" or omitted for a simple product. Matched
// against product_site_links.variation_id in create_online_order(); without
// it, a variable product's siteProductId (shared across all its sizes) either
// matches every linked size at once or, when the storefront instead sends the
// variation's own id as siteProductId, matches nothing at all.
// title names a brand-new POS product create_online_order() auto-creates
// and links on the spot when siteProductId (+variationId) doesn't match any
// existing product_site_links row -- so an unlinked product no longer just
// silently drops its line from the order; it self-heals instead. Omitted
// (or blank) falls back to a generic placeholder name in that product.
type InboundItem = {
  siteProductId: string;
  quantity: number;
  unitPrice: number;
  variationId?: string;
  title?: string;
};

// Inbound side of Phase 7's order sync: a storefront calls this right after
// a checkout finishes, so the sale shows up in POS as a real paid order (with
// its own invoice, printable at /invoice/[orderId]) instead of only ever
// nudging the linked product's stock down (see /api/stock-sync). The actual
// insert + line items + stock decrement all happen in one DB transaction via
// create_online_order() (see the "online_order_sync" migration) -- this
// route's job is just auth, payload validation, and looking up the brand id
// the storefront's site slug maps to.
export async function POST(request: NextRequest) {
  const secret = process.env.STOCK_SYNC_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    site?: string;
    siteOrderId?: string;
    items?: unknown;
    customerName?: string | null;
    customerPhone?: string | null;
    customerEmail?: string | null;
    customerAddress?: string | null;
    subtotal?: number | null;
    discount?: number;
    deliveryFee?: number;
    total?: number | null;
    paymentMethod?: string | null;
    // The customer's requested delivery/pickup time, as a proper ISO string
    // with an explicit offset (e.g. "...+07:00") or "Z" -- the caller is
    // responsible for that conversion, since a bare "YYYY-MM-DDTHH:mm" with
    // no offset would be parsed as UTC here, silently shifting it off by
    // whatever the storefront's local UTC offset actually is.
    deliveryAt?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { site, siteOrderId, items, customerName, customerPhone, customerEmail } = body;
  const isValidSite = (s: unknown): s is ProductSiteLink["site"] =>
    typeof s === "string" && VALID_SITES.includes(s as ProductSiteLink["site"]);

  const isInboundItem = (v: unknown): v is InboundItem =>
    typeof v === "object" &&
    v !== null &&
    typeof (v as InboundItem).siteProductId === "string" &&
    typeof (v as InboundItem).quantity === "number" &&
    Number.isFinite((v as InboundItem).quantity) &&
    (v as InboundItem).quantity >= MIN_QUANTITY &&
    (v as InboundItem).quantity <= MAX_QUANTITY &&
    typeof (v as InboundItem).unitPrice === "number" &&
    Number.isFinite((v as InboundItem).unitPrice) &&
    (v as InboundItem).unitPrice >= 0 &&
    (v as InboundItem).unitPrice <= MAX_UNIT_PRICE &&
    ((v as InboundItem).variationId === undefined || typeof (v as InboundItem).variationId === "string") &&
    ((v as InboundItem).title === undefined || typeof (v as InboundItem).title === "string");

  if (
    !isValidSite(site) ||
    typeof siteOrderId !== "string" ||
    !siteOrderId.trim() ||
    !Array.isArray(items) ||
    items.length === 0 ||
    !items.every(isInboundItem)
  ) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Order-level amounts are optional (POS derives them from the items when
  // omitted), but when sent they must be real, non-negative money -- a
  // negative discount or total would otherwise inflate/deflate a "paid" order
  // and the revenue reports built on it.
  const isValidAmount = (v: unknown) =>
    v === undefined ||
    v === null ||
    (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_ORDER_AMOUNT);
  if (
    !isValidAmount(body.subtotal) ||
    !isValidAmount(body.discount) ||
    !isValidAmount(body.deliveryFee) ||
    !isValidAmount(body.total)
  ) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  // Absent / null / "" means "method unknown" and is stored as NULL; a
  // non-empty value that isn't one of ours used to be silently dropped to
  // NULL too, leaving a "paid" order with no method -- reject it instead.
  const rawPaymentMethod = body.paymentMethod;
  if (
    rawPaymentMethod !== undefined &&
    rawPaymentMethod !== null &&
    rawPaymentMethod !== "" &&
    !VALID_PAYMENT_METHODS.includes(rawPaymentMethod as PaymentMethod)
  ) {
    return NextResponse.json({ error: "Invalid paymentMethod" }, { status: 400 });
  }
  const paymentMethod = rawPaymentMethod ? (rawPaymentMethod as PaymentMethod) : null;

  let deliveryAt: string | null = null;
  if (typeof body.deliveryAt === "string" && body.deliveryAt.trim()) {
    const parsed = new Date(body.deliveryAt);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Invalid deliveryAt" }, { status: 400 });
    }
    deliveryAt = parsed.toISOString();
  }

  const phone = normalizePhone(customerPhone);
  const name = typeof customerName === "string" ? customerName.trim() : "";

  // create_online_order() recomputes subtotal/total from the lines and ignores
  // the storefront's own figures; log when they disagreed so a storefront bug
  // doesn't go unnoticed.
  const itemsSubtotal = (items as InboundItem[]).reduce(
    (sum, i) => sum + round2(round2(i.unitPrice) * round2(i.quantity)),
    0
  );
  const expectedTotal = Math.max(itemsSubtotal - (body.discount ?? 0) + (body.deliveryFee ?? 0), 0);
  if (
    (typeof body.subtotal === "number" && Math.abs(body.subtotal - itemsSubtotal) > 0.01) ||
    (typeof body.total === "number" && Math.abs(body.total - expectedTotal) > 0.01)
  ) {
    console.warn("order-sync: storefront totals differ from its items; POS recomputed", {
      site,
      siteOrderId,
      sent: { subtotal: body.subtotal, total: body.total },
      recomputed: { subtotal: round2(itemsSubtotal), total: round2(expectedTotal) },
    });
  }

  const { data: brand, error: brandError } = await supabaseAdmin
    .from("brands")
    .select("id")
    .eq("slug", site)
    .single();
  if (brandError || !brand) {
    return NextResponse.json({ error: "No matching POS brand for this site" }, { status: 500 });
  }

  const { data: orderId, error: rpcError } = await supabaseAdmin.rpc("create_online_order", {
    p_brand_id: brand.id,
    p_site: site,
    p_site_order_id: siteOrderId,
    p_items: items as InboundItem[],
    // No name and no usable phone -> a readable placeholder instead of a
    // blank customer on the invoice. (Name-less with a phone keeps working as
    // before: create_online_order() names the customer by their number.)
    p_customer_name: name || (phone ? null : "Website customer"),
    p_customer_phone: phone,
    p_customer_email: customerEmail ?? null,
    p_customer_address: typeof body.customerAddress === "string" ? body.customerAddress.trim() || null : null,
    p_subtotal: body.subtotal ?? null,
    p_discount: body.discount ?? 0,
    p_delivery_fee: body.deliveryFee ?? 0,
    p_total: body.total ?? null,
    p_payment_method: paymentMethod,
    p_delivery_at: deliveryAt,
  });
  if (rpcError) {
    // SQLSTATE class 22 (data exception, e.g. numeric overflow) and 23514
    // (check violation, e.g. a quantity that rounds to 0) mean the payload
    // itself was bad in a way the checks above can't foresee -- the caller's
    // fault, so 400 rather than a 500 that reads like a POS outage.
    if (rpcError.code?.startsWith("22") || rpcError.code === "23514") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  // A customer this order just created has no "customer since" date, so the CRM counted them in
  // "New customers" (by the day they were created) but its customer list, which filters on that
  // date, left them out. Fill it in with the same day the count uses. Best effort -- it must
  // never fail an order that's already been taken.
  try {
    const { data: placed } = await supabaseAdmin.from("orders").select("customer_id").eq("id", orderId).maybeSingle();
    if (placed?.customer_id) {
      const { data: customer } = await supabaseAdmin
        .from("customers")
        .select("created_at, customer_since")
        .eq("id", placed.customer_id)
        .maybeSingle();
      if (customer && !customer.customer_since) {
        await supabaseAdmin
          .from("customers")
          .update({ customer_since: ppDay(customer.created_at) })
          .eq("id", placed.customer_id);
      }
    }
  } catch (e) {
    console.error("order-sync: couldn't set customer_since", e);
  }

  // Without this, a brand-new online order's stock decrement is correct in
  // the database immediately but POS's Stock/Orders pages keep serving their
  // stale pre-order render until something unrelated happens to revalidate
  // them -- same gap as order-status-sync's cancel/un-cancel path.
  revalidatePath(`/invoice/${orderId}`);
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/stock");
  revalidatePath("/sales");

  return NextResponse.json({ ok: true, orderId });
}
