"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/auth-server";

export async function adjustStockAction(input: {
  productId: string;
  delta: number;
  reason: string;
}): Promise<{ quantity: number }> {
  const { productId, delta, reason } = input;
  const user = await getSessionUser();

  const { data, error } = await supabaseAdmin.rpc("adjust_stock", {
    p_product_id: productId,
    p_delta: delta,
    p_reason: reason,
    p_created_by: user?.id ?? null,
  });

  if (error || data === null) {
    throw error ?? new Error("Failed to adjust stock");
  }

  revalidatePath("/stock");
  revalidatePath("/sales");
  return { quantity: data };
}

export async function uploadProductImageAction(formData: FormData): Promise<{ imageUrl: string }> {
  const productId = formData.get("productId");
  const file = formData.get("file");

  if (typeof productId !== "string" || !productId) {
    throw new Error("Missing product");
  }
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose an image file");
  }
  if (!file.type.startsWith("image/")) {
    throw new Error("File must be an image");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Image must be under 5MB");
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${productId}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from("product-images")
    .upload(path, file, { contentType: file.type, upsert: true });
  if (uploadError) throw uploadError;

  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from("product-images").getPublicUrl(path);

  const { error: updateError } = await supabaseAdmin
    .from("products")
    .update({ image_url: publicUrl })
    .eq("id", productId);
  if (updateError) throw updateError;

  revalidatePath("/stock");
  revalidatePath("/sales");
  return { imageUrl: publicUrl };
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
