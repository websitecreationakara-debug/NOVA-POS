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
  lines: CartLine[];
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

  const total = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

  // charge_order() runs the order insert, order_items insert, and stock
  // decrement as one DB transaction — see supabase/migrations/0003.
  const { data: orderId, error } = await supabaseAdmin.rpc("charge_order", {
    p_brand_id: brandId,
    p_customer_id: null,
    p_created_by: null,
    p_payment_method: paymentMethod,
    p_payment_reference: paymentReference || null,
    p_items: lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    })),
  });

  if (error || !orderId) {
    throw error ?? new Error("Failed to create order");
  }

  return { orderId, total, lines };
}
