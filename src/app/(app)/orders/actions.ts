"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { pushStockToSites } from "@/lib/site-sync";
import type { FulfillmentStatus } from "@/types/database";

export type DueDelivery = {
  id: string;
  invoiceNumber: string | null;
  customerName: string | null;
  brandName: string;
  deliveryAt: string;
  overdue: boolean;
};

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

export async function updateFulfillmentStatusAction(
  orderId: string,
  status: FulfillmentStatus
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("orders")
    .update({ fulfillment_status: status })
    .eq("id", orderId);

  if (error) throw error;
  revalidatePath(`/invoice/${orderId}`);
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
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
