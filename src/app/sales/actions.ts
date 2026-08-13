"use server";

import { supabaseAdmin } from "@/lib/supabase/server";
import type { PaymentMethod } from "@/types/database";

export interface CartLine {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

export interface ChargeResult {
  orderId: string;
  total: number;
}

export async function chargeOrder(input: {
  brandId: string;
  lines: CartLine[];
  paymentMethod: PaymentMethod;
  paymentReference?: string;
}): Promise<ChargeResult> {
  const { brandId, lines, paymentMethod, paymentReference } = input;

  if (lines.length === 0) {
    throw new Error("Cart is empty");
  }

  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const total = subtotal;

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .insert({
      brand_id: brandId,
      customer_id: null,
      created_by: null,
      status: "paid",
      subtotal,
      discount: 0,
      tax: 0,
      total,
      payment_method: paymentMethod,
      payment_reference: paymentReference || null,
      paid_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (orderError || !order) {
    throw orderError ?? new Error("Failed to create order");
  }

  const items = lines.map((l) => ({
    order_id: order.id,
    product_id: l.productId,
    quantity: l.quantity,
    unit_price: l.unitPrice,
    line_total: l.unitPrice * l.quantity,
  }));

  const { error: itemsError } = await supabaseAdmin.from("order_items").insert(items);
  if (itemsError) {
    // Best-effort cleanup so a failed charge doesn't leave an empty paid order behind.
    await supabaseAdmin.from("orders").delete().eq("id", order.id);
    throw itemsError;
  }

  return { orderId: order.id, total };
}
