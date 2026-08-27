"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { pushStockToSites } from "@/lib/site-sync";
import type { FulfillmentStatus } from "@/types/database";

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

// Deletes an order and restores the stock it consumed (see delete_order()) --
// used for voiding a mistaken/test order, not routine order management.
export async function deleteOrderAction(orderId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc("delete_order", { p_order_id: orderId });
  if (error) throw error;

  revalidatePath("/orders");
  revalidatePath("/stock");
  revalidatePath("/sales");
  await pushStockToSites(data ?? []);
}
