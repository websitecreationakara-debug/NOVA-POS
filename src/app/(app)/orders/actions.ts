"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
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
