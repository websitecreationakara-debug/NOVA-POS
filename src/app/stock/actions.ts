"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function adjustStockAction(input: {
  productId: string;
  delta: number;
  reason: string;
}): Promise<{ quantity: number }> {
  const { productId, delta, reason } = input;

  const { data, error } = await supabaseAdmin.rpc("adjust_stock", {
    p_product_id: productId,
    p_delta: delta,
    p_reason: reason,
    p_created_by: null,
  });

  if (error || data === null) {
    throw error ?? new Error("Failed to adjust stock");
  }

  revalidatePath("/stock");
  revalidatePath("/sales");
  return { quantity: data };
}

export async function setLowStockThresholdAction(input: {
  productId: string;
  threshold: number;
}): Promise<void> {
  const { productId, threshold } = input;
  if (threshold < 0) {
    throw new Error("Threshold cannot be negative");
  }

  const { error } = await supabaseAdmin
    .from("stock_levels")
    .update({ low_stock_threshold: threshold, updated_at: new Date().toISOString() })
    .eq("product_id", productId);

  if (error) throw error;

  revalidatePath("/stock");
  revalidatePath("/sales");
}
