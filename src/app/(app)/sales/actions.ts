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

export interface CustomerSuggestion {
  id: string;
  name: string;
  phone: string;
  photoUrl: string | null;
}

// This is an online-sale POS, not a mart checkout -- every order belongs to
// an identifiable customer, and phone number is how staff recognize a
// returning one (customers.phone has a unique index, see migration 0011).
// Staff type a few digits and pick from matches, AppSheet-style, instead of
// needing the full number before anything happens.
export async function searchCustomersByPhone(prefix: string): Promise<CustomerSuggestion[]> {
  const trimmed = prefix.trim();
  if (trimmed.length < 3) return [];

  const { data, error } = await supabaseAdmin
    .from("customers")
    .select("id, name, phone, photo_url")
    .not("phone", "is", null)
    .ilike("phone", `${trimmed}%`)
    .order("name")
    .limit(8);
  if (error) throw error;

  return (data ?? [])
    .filter((c): c is typeof c & { phone: string } => c.phone !== null)
    .map((c) => ({ id: c.id, name: c.name, phone: c.phone, photoUrl: c.photo_url }));
}

async function getOrCreateCustomerId(phone: string, name: string): Promise<string> {
  const { data: existing, error: findError } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing.id;

  if (!name) {
    throw new Error("Customer name is required to add a new customer");
  }

  const { data: created, error: insertError } = await supabaseAdmin
    .from("customers")
    .insert({ name, phone })
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
}): Promise<ChargeResult> {
  const { brandId, lines, paymentMethod, paymentReference, customerName, customerPhone } = input;

  if (lines.length === 0) {
    throw new Error("Cart is empty");
  }

  const phone = customerPhone.trim();
  const name = customerName.trim();
  if (!phone) {
    throw new Error("Customer phone number is required");
  }

  const total = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const user = await getSessionUser();
  const customerId = await getOrCreateCustomerId(phone, name);

  // charge_order() runs the order insert, order_items insert, and stock
  // decrement as one DB transaction — see supabase/migrations/0003.
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
