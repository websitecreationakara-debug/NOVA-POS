import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { FulfillmentStatus, ProductSiteLink } from "@/types/database";

const VALID_SITES: ProductSiteLink["site"][] = [
  "bosba-premium-foods",
  "bosba-drink-snack",
  "sora-sake",
];

// Each storefront's own order.status values -> the matching POS
// fulfillment_status. "awaiting_payment" isn't listed -- an order sitting
// unpaid never reached POS in the first place (see /api/order-sync), so
// there's nothing there yet to update. "shipped" has no exact POS
// counterpart; "delivered" is the closest state POS has for "on its way /
// handed off".
const STATUS_MAP: Record<string, FulfillmentStatus> = {
  pending: "new_order",
  processing: "processing",
  shipped: "delivered",
  delivered: "delivered",
  completed: "complete",
  complete: "complete",
  cancelled: "cancelled",
};

// Inbound side of order status sync: a storefront calls this whenever staff
// change an order's status there (cancel, ship, complete, ...), so POS's copy
// of that order -- created by /api/order-sync at checkout -- stays in sync
// instead of being frozen at "New Order" forever. Matches the POS order by
// (site, site_order_id), same key create_online_order() stamped it with. An
// order POS never received (nothing on it was linkable -- see order-sync)
// simply has nothing to update; that's not an error.
export async function POST(request: NextRequest) {
  const secret = process.env.STOCK_SYNC_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { site?: string; siteOrderId?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { site, siteOrderId, status } = body;
  const isValidSite = (s: unknown): s is ProductSiteLink["site"] =>
    typeof s === "string" && VALID_SITES.includes(s as ProductSiteLink["site"]);

  if (!isValidSite(site) || typeof siteOrderId !== "string" || !siteOrderId.trim()) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const mapped = typeof status === "string" ? STATUS_MAP[status] : undefined;
  if (!mapped) {
    return NextResponse.json({ error: `Unrecognized status: ${status}` }, { status: 400 });
  }

  const { data: order, error: findError } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("site", site)
    .eq("site_order_id", siteOrderId)
    .maybeSingle();
  if (findError) {
    return NextResponse.json({ error: findError.message }, { status: 500 });
  }
  if (!order) {
    // Nothing on this order was ever linkable, so POS never got a copy of it
    // to update -- not an error, just nothing to do.
    return NextResponse.json({ ok: true, skipped: true });
  }

  const { error: updateError } = await supabaseAdmin
    .from("orders")
    .update({ fulfillment_status: mapped })
    .eq("id", order.id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, orderId: order.id, status: mapped });
}
