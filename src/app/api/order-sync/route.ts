import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { PaymentMethod, ProductSiteLink } from "@/types/database";

const VALID_SITES: ProductSiteLink["site"][] = [
  "bosba-premium-foods",
  "bosba-drink-snack",
  "sora-sake",
];
const VALID_PAYMENT_METHODS: PaymentMethod[] = ["cash", "bank_qr"];

type InboundItem = { siteProductId: string; quantity: number; unitPrice: number };

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
    (v as InboundItem).quantity > 0 &&
    typeof (v as InboundItem).unitPrice === "number" &&
    Number.isFinite((v as InboundItem).unitPrice) &&
    (v as InboundItem).unitPrice >= 0;

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

  const paymentMethod =
    typeof body.paymentMethod === "string" &&
    VALID_PAYMENT_METHODS.includes(body.paymentMethod as PaymentMethod)
      ? (body.paymentMethod as PaymentMethod)
      : null;

  let deliveryAt: string | null = null;
  if (typeof body.deliveryAt === "string" && body.deliveryAt.trim()) {
    const parsed = new Date(body.deliveryAt);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Invalid deliveryAt" }, { status: 400 });
    }
    deliveryAt = parsed.toISOString();
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
    p_customer_name: customerName ?? null,
    p_customer_phone: customerPhone ?? null,
    p_customer_email: customerEmail ?? null,
    p_subtotal: body.subtotal ?? null,
    p_discount: body.discount ?? 0,
    p_delivery_fee: body.deliveryFee ?? 0,
    p_total: body.total ?? null,
    p_payment_method: paymentMethod,
    p_delivery_at: deliveryAt,
  });
  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, orderId });
}
