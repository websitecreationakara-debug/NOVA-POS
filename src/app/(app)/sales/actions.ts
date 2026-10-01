"use server";

import { supabaseAdmin } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/auth-server";
import { pushStockToSites } from "@/lib/site-sync";
import type { OrderSource, PaymentMethod } from "@/types/database";

export interface CartLine {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  // Custom size sold ("100g" of a 350g pack) -- quantity then holds the
  // fraction of a unit. listPrice is the full-size price that was in effect,
  // kept client-side so the size can be changed again.
  sizeLabel?: string | null;
  listPrice?: number;
  // Shown in the cart instead of `name` when set: the product's Khmer name, and
  // its scale (unit) with the Khmer wording. `name` stays the English name --
  // that's what the weight lookup and everything saved on the order use.
  nameKm?: string | null;
  unit?: string;
  unitKm?: string | null;
}

export interface ChargeResult {
  orderId: string;
  invoiceNumber: string | null;
  total: number;
  lines: CartLine[];
  // Set when the sale saved fine but pushing the new stock count out to a
  // linked storefront failed -- the cashier needs to know that site's
  // displayed stock is now stale until it's fixed or synced manually.
  stockSyncWarning: string | null;
}

export interface CustomerSuggestion {
  id: string;
  name: string;
  phone: string;
  photoUrl: string | null;
  address: string | null;
}

// This is an online-sale POS, not a mart checkout -- every order belongs to
// an identifiable customer, and phone number is how staff recognize a
// returning one (customers.phone has a unique index, see migration 0011).
// Staff type a few digits and pick from matches, AppSheet-style, instead of
// needing the full number before anything happens.
export async function searchCustomersByPhone(prefix: string): Promise<CustomerSuggestion[]> {
  const trimmed = prefix.trim();
  if (trimmed.length < 1) return [];

  const { data, error } = await supabaseAdmin
    .from("customers")
    .select("id, name, phone, photo_url, address")
    .not("phone", "is", null)
    .ilike("phone", `${trimmed}%`)
    .order("name")
    .limit(8);
  if (error) throw error;

  return (data ?? [])
    .filter((c): c is typeof c & { phone: string } => c.phone !== null)
    .map((c) => ({ id: c.id, name: c.name, phone: c.phone, photoUrl: c.photo_url, address: c.address }));
}

// Same idea as searchCustomersByPhone, but by name -- lets staff who only
// remember the customer's name (not their number) find them the same way.
export async function searchCustomersByName(prefix: string): Promise<CustomerSuggestion[]> {
  const trimmed = prefix.trim();
  if (trimmed.length < 1) return [];

  const { data, error } = await supabaseAdmin
    .from("customers")
    .select("id, name, phone, photo_url, address")
    .not("phone", "is", null)
    .ilike("name", `%${trimmed}%`)
    .order("name")
    .limit(8);
  if (error) throw error;

  return (data ?? [])
    .filter((c): c is typeof c & { phone: string } => c.phone !== null)
    .map((c) => ({ id: c.id, name: c.name, phone: c.phone, photoUrl: c.photo_url, address: c.address }));
}

async function getOrCreateCustomerId(phone: string, name: string, address?: string): Promise<string> {
  const { data: existing, error: findError } = await supabaseAdmin
    .from("customers")
    .select("id, address")
    .eq("phone", phone)
    .maybeSingle();
  if (findError) throw findError;

  if (existing) {
    // Fill in the address if the customer didn't have one yet, but never
    // blank out an address that's already on file just because staff left
    // the field empty at checkout.
    const trimmedAddress = address?.trim();
    if (trimmedAddress && trimmedAddress !== existing.address) {
      const { error: updateError } = await supabaseAdmin
        .from("customers")
        .update({ address: trimmedAddress })
        .eq("id", existing.id);
      if (updateError) throw updateError;
    }
    return existing.id;
  }

  if (!name) {
    throw new Error("Customer name is required to add a new customer");
  }

  const { data: created, error: insertError } = await supabaseAdmin
    .from("customers")
    .insert({ name, phone, address: address?.trim() || null })
    .select("id")
    .single();
  if (insertError) throw insertError;

  return created.id;
}

export async function chargeOrder(input: {
  brandId: string;
  lines: CartLine[];
  paymentMethod: PaymentMethod;
  paymentReference?: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  discount?: number;
  deliveryFee?: number;
  // Customer-requested delivery date & time as an ISO string. Omit for
  // ASAP / same day.
  deliveryAt?: string;
  // Free-text note / description for the order.
  note?: string;
  // How the order was placed -- in_store (default), telegram, or meta.
  orderSource?: OrderSource;
}): Promise<ChargeResult> {
  const {
    brandId,
    lines,
    paymentMethod,
    paymentReference,
    customerName,
    customerPhone,
    customerAddress,
    discount,
    deliveryFee,
    deliveryAt,
    note,
    orderSource,
  } = input;

  if (lines.length === 0) {
    throw new Error("Cart is empty");
  }
  // Prices are editable in the cart, so don't trust them blindly.
  if (lines.some((l) => !Number.isFinite(l.unitPrice) || l.unitPrice < 0)) {
    throw new Error("Item prices must be zero or more");
  }

  const phone = customerPhone.trim();
  const name = customerName.trim();
  if (!phone) {
    throw new Error("Customer phone number is required");
  }

  const user = await getSessionUser();
  const customerId = await getOrCreateCustomerId(phone, name, customerAddress);

  // charge_order() runs the order insert, order_items insert, and stock
  // decrement as one DB transaction — see supabase/migrations/0003 and
  // 0012 (discount/delivery_fee). It also clamps the final total at 0.
  const { data: orderId, error } = await supabaseAdmin.rpc("charge_order", {
    p_brand_id: brandId,
    p_customer_id: customerId,
    p_created_by: user?.id ?? null,
    p_payment_method: paymentMethod,
    p_payment_reference: paymentReference || null,
    p_items: lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    })),
    p_customer_name: name || null,
    p_customer_phone: phone,
    p_discount: discount ?? 0,
    p_delivery_fee: deliveryFee ?? 0,
  });

  if (error || !orderId) {
    throw error ?? new Error("Failed to create order");
  }

  // The order + stock decrement are already committed by charge_order() above,
  // so from here on nothing may throw -- a failure past this point loses the
  // whole sale for the cashier and risks a re-charge. Surface it as a warning
  // instead.
  const warnings: string[] = [];

  // Custom sizes ("100g" of a 350g pack) -- charge_order() has no field for
  // them, so stamp each label on its line now. A cart holds one line per
  // product, so (order, product) picks the line.
  for (const l of lines) {
    const sizeLabel = l.sizeLabel?.trim();
    if (!sizeLabel) continue;
    const { error: sizeError } = await supabaseAdmin
      .from("order_items")
      .update({ size_label: sizeLabel })
      .eq("order_id", orderId)
      .eq("product_id", l.productId);
    if (sizeError) {
      warnings.push(
        `Order saved, but the "${sizeLabel}" size on ${l.name} didn't. Run the size_label migration, then set it on the order. (${sizeError.message})`
      );
    }
  }

  // charge_order() doesn't take a delivery time -- stamp it on afterwards so
  // the RPC signature stays put. Parse it here so a malformed value can't
  // reach the column.
  if (deliveryAt) {
    const parsed = new Date(deliveryAt);
    if (Number.isNaN(parsed.getTime())) {
      warnings.push("Delivery date/time was invalid and wasn't saved.");
    } else {
      const { error: dateError } = await supabaseAdmin
        .from("orders")
        .update({ delivery_at: parsed.toISOString() })
        .eq("id", orderId);
      if (dateError) {
        warnings.push(
          `Order saved, but the delivery time didn't. Run the delivery_at migration, then set it on the order. (${dateError.message})`
        );
      }
    }
  }

  // Same deal for order_source (migration 0037) -- stamp it on, warn if the
  // column isn't there yet rather than losing the sale. "in_store" is
  // already the column default, so skip the write when that's all we'd set.
  if (orderSource && orderSource !== "in_store") {
    const { error: sourceError } = await supabaseAdmin
      .from("orders")
      .update({ order_source: orderSource })
      .eq("id", orderId);
    if (sourceError) {
      warnings.push(
        `Order saved, but "Order via" didn't. Run the order_source migration (0037), then set it on the order. (${sourceError.message})`
      );
    }
  }

  // Same deal for the note (migration 0021) -- stamp it on, warn if the
  // column isn't there yet rather than losing the sale.
  if (note?.trim()) {
    const { error: noteError } = await supabaseAdmin
      .from("orders")
      .update({ note: note.trim() })
      .eq("id", orderId);
    if (noteError) {
      warnings.push(
        `Order saved, but the note didn't. Run the order note migration (0021), then add it on the order. (${noteError.message})`
      );
    }
  }

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("invoice_number, total")
    .eq("id", orderId)
    .single();

  const syncFailures = await pushStockToSites(lines.map((l) => l.productId));
  if (syncFailures.length > 0) {
    warnings.push(
      `Stock wasn't synced to ${[...new Set(syncFailures.map((f) => f.label))].join(", ")} -- update it there manually.`
    );
  }

  return {
    orderId,
    invoiceNumber: order?.invoice_number ?? null,
    total: order?.total ?? 0,
    lines,
    stockSyncWarning: warnings.length > 0 ? warnings.join(" ") : null,
  };
}
