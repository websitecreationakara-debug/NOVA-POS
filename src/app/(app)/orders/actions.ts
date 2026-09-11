"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { pushOrderStatusToSite, pushStockToSites } from "@/lib/site-sync";
import type { FulfillmentStatus, PaymentMethod, ProductSiteLink } from "@/types/database";

export type DueDelivery = {
  id: string;
  invoiceNumber: string | null;
  customerName: string | null;
  brandName: string;
  deliveryAt: string;
  overdue: boolean;
};

// A cheap "has anything changed" fingerprint for the live-update watcher
// (see LiveOrdersWatcher): id + fulfillment_status for the most recent
// orders. Polled every few seconds and diffed against the previous poll --
// any difference (a new order, or a status flip) triggers a router.refresh()
// so a website order (created by /api/order-sync, or status-updated by
// /api/order-status-sync -- neither of which goes through this browser, so
// nothing here would otherwise know to refresh) shows up without anyone
// having to reload the page. Capped at the most recent 100 -- an older order
// changing status while nobody's watching it live isn't worth the extra
// payload on every poll.
export async function getRecentOrderActivityAction(): Promise<
  { id: string; fulfillmentStatus: FulfillmentStatus }[]
> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id, fulfillment_status")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((o) => ({ id: o.id, fulfillmentStatus: o.fulfillment_status }));
}

// Orders whose customer-requested delivery time is within the next 2 hours
// (or already past) and that aren't finished yet -- what the alert bell polls.
// Returns [] if the delivery_at column isn't there yet (migration 0020), so a
// missing migration doesn't blow up the app shell.
export async function getDueDeliveries(): Promise<DueDelivery[]> {
  const cutoff = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  try {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("id, invoice_number, customer_name, delivery_at, fulfillment_status, brands(name)")
      .eq("status", "paid")
      .not("delivery_at", "is", null)
      .lte("delivery_at", cutoff)
      .order("delivery_at", { ascending: true })
      .limit(50);
    if (error) throw error;

    const now = Date.now();
    const settled = new Set(["delivered", "complete", "cancelled"]);
    return (data ?? [])
      .filter(
        (o): o is typeof o & { delivery_at: string } =>
          o.delivery_at != null && !settled.has(o.fulfillment_status)
      )
      .map((o) => ({
        id: o.id,
        invoiceNumber: o.invoice_number,
        customerName: o.customer_name,
        brandName: (o.brands as { name: string } | null)?.name ?? "—",
        deliveryAt: o.delivery_at,
        overdue: new Date(o.delivery_at).getTime() < now,
      }));
  } catch {
    return [];
  }
}

export type OrderItemInput = { productId: string; quantity: number; unitPrice: number };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type OrderEditInput = {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  brandId: string;
  items: OrderItemInput[];
  // Staff enter a % and a flat "minus" separately; both fold into the
  // order's single `discount` dollar amount (same as checkout, migration 0012).
  discountPercent: number;
  minusAmount: number;
  deliveryFee: number;
  // Customer-requested delivery date & time as an ISO string. "" / undefined
  // clears it (ASAP / same day).
  deliveryAt?: string;
  // "" clears it (unpaid/unknown); undefined leaves it be.
  paymentMethod?: PaymentMethod | "";
  // Free-text note / description. "" clears it; undefined leaves it be.
  note?: string;
};

// One save for everything editable on the order detail page: the customer's
// phone/address, the business it belongs to, the discount / minus / delivery
// figures, and the line items (change quantity or price, drop a line, add
// more products). Stock is moved by the net per-product difference, money is
// recomputed from scratch, and the new counts are pushed to any linked
// storefront. Ordered writes, not one transaction -- same trade-off as the
// post-charge updates in chargeOrder().
export async function updateOrderAction(
  orderId: string,
  input: OrderEditInput
): Promise<void> {
  const clean = input.items
    .map((i) => ({
      productId: i.productId,
      quantity: round2(Number(i.quantity)),
      unitPrice: round2(Number(i.unitPrice)),
    }))
    .filter((i) => i.productId && i.quantity > 0 && i.unitPrice >= 0);

  if (clean.length === 0) {
    throw new Error("An order needs at least one product.");
  }
  if (!input.brandId) {
    throw new Error("Pick a business for the order.");
  }

  const [{ data: order, error: orderErr }, { data: existing, error: itemsErr }] = await Promise.all([
    supabaseAdmin.from("orders").select("id, customer_id").eq("id", orderId).maybeSingle(),
    supabaseAdmin.from("order_items").select("product_id, quantity").eq("order_id", orderId),
  ]);
  if (orderErr) throw orderErr;
  if (itemsErr) throw itemsErr;
  if (!order) throw new Error("Order not found.");

  // Net stock movement per product: what the old lines consumed minus what
  // the new lines consume. Positive => hand stock back; negative => take more.
  const delta = new Map<string, number>();
  for (const row of existing ?? []) {
    delta.set(row.product_id, (delta.get(row.product_id) ?? 0) + Number(row.quantity));
  }
  for (const it of clean) {
    delta.set(it.productId, (delta.get(it.productId) ?? 0) - it.quantity);
  }

  const { error: delErr } = await supabaseAdmin
    .from("order_items")
    .delete()
    .eq("order_id", orderId);
  if (delErr) throw delErr;

  const { error: insErr } = await supabaseAdmin.from("order_items").insert(
    clean.map((i) => ({
      order_id: orderId,
      product_id: i.productId,
      quantity: i.quantity,
      unit_price: i.unitPrice,
      line_total: round2(i.quantity * i.unitPrice),
    }))
  );
  if (insErr) throw insErr;

  const subtotal = round2(clean.reduce((s, i) => s + i.quantity * i.unitPrice, 0));
  const pct = Math.min(100, Math.max(0, Number(input.discountPercent) || 0));
  const minus = Math.max(0, round2(Number(input.minusAmount) || 0));
  const deliveryFee = Math.max(0, round2(Number(input.deliveryFee) || 0));
  const discount = Math.min(subtotal, round2(subtotal * (pct / 100) + minus));
  const total = Math.max(0, round2(subtotal - discount + deliveryFee));

  const phone = input.customerPhone.trim();
  const name = input.customerName.trim();
  const address = input.customerAddress.trim();

  // A blank string clears the requested delivery time; anything unparseable
  // is left untouched rather than crashing the save.
  let deliveryAt: string | null | undefined;
  if (input.deliveryAt === "") {
    deliveryAt = null;
  } else if (input.deliveryAt) {
    const parsed = new Date(input.deliveryAt);
    if (!Number.isNaN(parsed.getTime())) deliveryAt = parsed.toISOString();
  }

  const paymentMethod: PaymentMethod | null | undefined =
    input.paymentMethod === "" ? null : input.paymentMethod;

  const { error: updErr } = await supabaseAdmin
    .from("orders")
    .update({
      brand_id: input.brandId,
      customer_phone: phone || null,
      customer_name: name || null,
      subtotal,
      discount,
      delivery_fee: deliveryFee,
      total,
      ...(deliveryAt !== undefined ? { delivery_at: deliveryAt } : {}),
      ...(paymentMethod !== undefined ? { payment_method: paymentMethod } : {}),
    })
    .eq("id", orderId);
  if (updErr) throw updErr;

  // Address is only stored on the customer record (see getInvoice), so it
  // has to be written there. Keep the customer's phone in step too, but only
  // when no other customer already owns that number (customers.phone is
  // unique -- migration 0011).
  if (order.customer_id) {
    const patch: { address: string | null; phone?: string } = { address: address || null };
    if (phone) {
      const { data: clash } = await supabaseAdmin
        .from("customers")
        .select("id")
        .eq("phone", phone)
        .neq("id", order.customer_id)
        .maybeSingle();
      if (!clash) patch.phone = phone;
    }
    await supabaseAdmin.from("customers").update(patch).eq("id", order.customer_id);
  }

  for (const [productId, move] of delta) {
    if (move === 0) continue;
    const { data: sl } = await supabaseAdmin
      .from("stock_levels")
      .select("quantity")
      .eq("product_id", productId)
      .maybeSingle();
    if (sl) {
      await supabaseAdmin
        .from("stock_levels")
        .update({ quantity: Number(sl.quantity) + move, updated_at: new Date().toISOString() })
        .eq("product_id", productId);
    } else {
      await supabaseAdmin.from("stock_levels").insert({
        product_id: productId,
        quantity: move,
        low_stock_threshold: 0,
        updated_at: new Date().toISOString(),
      });
    }
  }

  // Note lives on migration 0021; a project that hasn't run it yet just
  // skips this rather than failing the whole save (42703 = undefined column,
  // PGRST204 = column missing from PostgREST's schema cache).
  if (input.note !== undefined) {
    const { error: noteErr } = await supabaseAdmin
      .from("orders")
      .update({ note: input.note.trim() || null })
      .eq("id", orderId);
    if (noteErr && noteErr.code !== "42703" && noteErr.code !== "PGRST204") throw noteErr;
  }

  revalidatePath(`/invoice/${orderId}`);
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/stock");
  revalidatePath("/sales");
  await pushStockToSites([...delta.keys()]);
}

export async function updateFulfillmentStatusAction(
  orderId: string,
  status: FulfillmentStatus
): Promise<void> {
  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .update({ fulfillment_status: status })
    .eq("id", orderId)
    .select("channel, site, site_order_id")
    .single();

  if (error) throw error;
  revalidatePath(`/invoice/${orderId}`);
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");

  // Mirror of /api/order-status-sync (the website -> POS direction): for an
  // order that came from a storefront, push this status change back out so
  // that storefront's own admin view shows the same thing instead of staying
  // frozen at whatever it started as. Best-effort -- a push failure here
  // shouldn't undo the status change staff just made in POS.
  if (order?.channel === "online" && order.site && order.site_order_id) {
    const site = order.site as ProductSiteLink["site"];
    const siteOrderId = order.site_order_id;
    const result = await pushOrderStatusToSite(site, siteOrderId, status);
    if (!result.ok) {
      console.error(`Failed to push order status to ${site}: ${result.reason}`);
    }
  }
}

// Deletes an invoice/order and restores the stock it consumed (see
// delete_order() in supabase/migrations/0016) -- for voiding a mistaken or
// test order, not routine order management.
export async function deleteOrderAction(orderId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc("delete_order", { p_order_id: orderId });
  if (error) throw error;

  revalidatePath(`/invoice/${orderId}`);
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/stock");
  revalidatePath("/sales");
  await pushStockToSites(data ?? []);
}
