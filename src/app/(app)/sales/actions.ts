"use server";

import { supabaseAdmin } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/auth-server";
import type { PaymentMethod } from "@/types/database";

export interface CartLine {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

export interface ChargeResult {
  orderId: string;
  invoiceNumber: string | null;
  total: number;
  lines: CartLine[];
}

export async function chargeOrder(input: {
  brandId: string;
  lines: CartLine[];
  paymentMethod: PaymentMethod;
  paymentReference?: string;
  customerName?: string;
  customerPhone?: string;
}): Promise<ChargeResult> {
  const { brandId, lines, paymentMethod, paymentReference, customerName, customerPhone } = input;

  if (lines.length === 0) {
    throw new Error("Cart is empty");
  }

  const total = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const user = await getSessionUser();

  // charge_order() runs the order insert, order_items insert, and stock
  // decrement as one DB transaction — see supabase/migrations/0003.
  const { data: orderId, error } = await supabaseAdmin.rpc("charge_order", {
    p_brand_id: brandId,
    p_customer_id: null,
    p_created_by: user?.id ?? null,
    p_payment_method: paymentMethod,
    p_payment_reference: paymentReference || null,
    p_items: lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    })),
    p_customer_name: customerName || null,
    p_customer_phone: customerPhone || null,
  });

  if (error || !orderId) {
    throw error ?? new Error("Failed to create order");
  }

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("invoice_number")
    .eq("id", orderId)
    .single();

  return { orderId, invoiceNumber: order?.invoice_number ?? null, total, lines };
}
