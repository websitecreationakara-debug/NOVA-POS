"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/auth-server";
import { pushStockToSites, searchSiteProducts, linkProductToSite, type SiteProductCandidate } from "@/lib/site-sync";
import type { ProductSiteLink } from "@/types/database";

export async function adjustStockAction(input: {
  productId: string;
  delta: number;
  reason?: string;
}): Promise<{ quantity: number }> {
  const { productId, delta, reason } = input;
  const user = await getSessionUser();

  const { data, error } = await supabaseAdmin.rpc("adjust_stock", {
    p_product_id: productId,
    p_delta: delta,
    p_reason: reason ?? null,
    p_created_by: user?.id ?? null,
  });

  if (error || data === null) {
    throw error ?? new Error("Failed to adjust stock");
  }

  revalidatePath("/stock");
  revalidatePath("/sales");
  await pushStockToSites([productId]);
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

export async function removeProductImageAction(input: { productId: string }): Promise<void> {
  const { productId } = input;

  const { data: product, error: fetchError } = await supabaseAdmin
    .from("products")
    .select("image_url")
    .eq("id", productId)
    .single();
  if (fetchError) throw fetchError;

  const { error: updateError } = await supabaseAdmin
    .from("products")
    .update({ image_url: null })
    .eq("id", productId);
  if (updateError) throw updateError;

  const path = product?.image_url?.split("/product-images/")[1];
  if (path) {
    // best-effort: don't fail the removal if the storage object is already gone
    await supabaseAdmin.storage.from("product-images").remove([path]);
  }

  revalidatePath("/stock");
  revalidatePath("/sales");
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

export async function setProductPriceAction(input: {
  productId: string;
  price: number;
}): Promise<void> {
  const { productId, price } = input;
  if (Number.isNaN(price) || price < 0) {
    throw new Error("Price cannot be negative");
  }

  const { error } = await supabaseAdmin.from("products").update({ price }).eq("id", productId);

  if (error) throw error;

  revalidatePath("/stock");
  revalidatePath("/sales");
}

const VALID_SITES: ProductSiteLink["site"][] = [
  "bosba-premium-foods",
  "bosba-drink-snack",
  "sora-sake",
];

export async function searchSiteProductForLinkAction(input: {
  site: string;
  query: string;
}): Promise<SiteProductCandidate[]> {
  const { site, query } = input;
  if (!VALID_SITES.includes(site as ProductSiteLink["site"])) return [];
  return searchSiteProducts(site as ProductSiteLink["site"], query);
}

export async function linkProductToSiteAction(input: {
  productId: string;
  site: string;
  siteProductId: string;
  matchedName: string;
  siteStock: number | null;
}): Promise<void> {
  const { productId, site, siteProductId, matchedName, siteStock } = input;
  if (!VALID_SITES.includes(site as ProductSiteLink["site"])) {
    throw new Error("Invalid site");
  }
  await linkProductToSite(
    productId,
    site as ProductSiteLink["site"],
    siteProductId,
    matchedName,
    siteStock
  );

  revalidatePath("/stock");
  revalidatePath("/sales");
}

// Soft delete: hides the product from Stock/Sales instead of a hard DELETE,
// since past orders, stock adjustments, and site links may still reference
// it -- a real DELETE would either fail on those foreign keys or silently
// erase order history.
export async function deactivateProductAction(input: { productId: string }): Promise<void> {
  const { error } = await supabaseAdmin
    .from("products")
    .update({ is_active: false })
    .eq("id", input.productId);

  if (error) throw error;

  revalidatePath("/stock");
  revalidatePath("/sales");
}

export async function setProductCategoryAction(input: {
  productId: string;
  categoryId: string | null;
}): Promise<void> {
  const { productId, categoryId } = input;

  const { error } = await supabaseAdmin
    .from("products")
    .update({ category_id: categoryId })
    .eq("id", productId);

  if (error) throw error;

  revalidatePath("/stock");
  revalidatePath("/sales");
}

export async function createCategoryAction(input: {
  brandId: string;
  name: string;
}): Promise<{ id: string }> {
  const { brandId, name } = input;
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Category name is required");
  }

  const { data: maxRow } = await supabaseAdmin
    .from("categories")
    .select("sort_order")
    .eq("brand_id", brandId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabaseAdmin
    .from("categories")
    .insert({ brand_id: brandId, name: trimmed, sort_order: (maxRow?.sort_order ?? -1) + 1 })
    .select("id")
    .single();

  if (error) {
    // categories_brand_id_name_key unique constraint
    if (error.code === "23505") throw new Error("A category with this name already exists");
    throw error;
  }
  if (!data) throw new Error("Failed to create category");

  revalidatePath("/stock");
  revalidatePath("/sales");
  return { id: data.id };
}

// Products in a deleted category fall back to "No category" (the
// products_category_id_fkey FK is ON DELETE SET NULL) rather than being
// deleted themselves or blocking the delete.
export async function deleteCategoryAction(input: { categoryId: string }): Promise<void> {
  const { error } = await supabaseAdmin.from("categories").delete().eq("id", input.categoryId);

  if (error) throw error;

  revalidatePath("/stock");
  revalidatePath("/sales");
}

export async function renameProductAction(input: { productId: string; name: string }): Promise<void> {
  const { productId, name } = input;
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Name cannot be empty");
  }

  const { error } = await supabaseAdmin
    .from("products")
    .update({ name: trimmed })
    .eq("id", productId);

  if (error) throw error;

  revalidatePath("/stock");
  revalidatePath("/sales");
}

export async function createProductAction(input: {
  brandId: string;
  categoryId: string | null;
  name: string;
  sku: string | null;
  price: number;
  unit: string;
}): Promise<{ id: string }> {
  const { brandId, categoryId, name, sku, price, unit } = input;
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Name is required");
  }
  if (Number.isNaN(price) || price < 0) {
    throw new Error("Price cannot be negative");
  }
  const trimmedUnit = unit.trim() || "pcs";

  const { data, error } = await supabaseAdmin
    .from("products")
    .insert({
      brand_id: brandId,
      category_id: categoryId,
      name: trimmedName,
      sku: sku?.trim() || null,
      price,
      unit: trimmedUnit,
      image_url: null,
      is_active: true,
    })
    .select("id")
    .single();

  if (error || !data) throw error ?? new Error("Failed to create product");

  revalidatePath("/stock");
  revalidatePath("/sales");
  return { id: data.id };
}
