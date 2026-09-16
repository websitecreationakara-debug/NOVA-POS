"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { pushStockToSites, searchSiteProducts, linkProductToSite, type SiteProductCandidate } from "@/lib/site-sync";
import { requireStockAccess } from "@/lib/stockAccess";
import { computeLineCogs, computeRecipeUnitCost } from "@/lib/cogs";
import type { ProductSiteLink, StockAdjustmentCategory } from "@/types/database";

// Order lines never had a cost recorded because cost tracking didn't exist
// yet at the time they were sold (cogs IS NULL) get priced retroactively
// once the product's cost price is set -- same direct/recipe pricing
// charge_order() and updateOrderAction use. Lines that already have a
// recorded cogs are left untouched: a later cost-price change still can't
// rewrite an already-priced sale.
async function backfillOrderItemCogs(productId: string): Promise<void> {
  const { data: recipeRows, error: recipeErr } = await supabaseAdmin
    .from("recipe_items")
    .select("quantity, products!recipe_items_ingredient_product_id_fkey(cost_price)")
    .eq("product_id", productId);
  if (recipeErr) throw recipeErr;

  let unitCost: number | null;
  let costSource: "direct" | "recipe";
  if (recipeRows && recipeRows.length > 0) {
    costSource = "recipe";
    unitCost = computeRecipeUnitCost(
      recipeRows.map((r) => ({
        quantity: r.quantity,
        costPrice: (r.products as { cost_price: number | null } | null)?.cost_price ?? null,
      }))
    );
  } else {
    costSource = "direct";
    const { data: product, error: productErr } = await supabaseAdmin
      .from("products")
      .select("cost_price")
      .eq("id", productId)
      .single();
    if (productErr) throw productErr;
    unitCost = product?.cost_price ?? null;
  }
  if (unitCost === null) return;

  const { data: unpriced, error: unpricedErr } = await supabaseAdmin
    .from("order_items")
    .select("id, quantity")
    .eq("product_id", productId)
    .is("cogs", null);
  if (unpricedErr) throw unpricedErr;
  if (!unpriced || unpriced.length === 0) return;

  await Promise.all(
    unpriced.map((item) =>
      supabaseAdmin
        .from("order_items")
        .update({ unit_cost: unitCost, cogs: computeLineCogs(unitCost, item.quantity), cost_source: costSource })
        .eq("id", item.id)
    )
  );
}

export async function adjustStockAction(input: {
  productId: string;
  delta: number;
  reason?: string;
  category?: StockAdjustmentCategory;
}): Promise<{ quantity: number }> {
  const { productId, delta, reason, category } = input;
  const user = await requireStockAccess();

  const { data, error } = await supabaseAdmin.rpc("adjust_stock", {
    p_product_id: productId,
    p_delta: delta,
    p_reason: reason ?? null,
    p_created_by: user?.id ?? null,
    p_category: category ?? "other",
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
  await requireStockAccess();
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
  await requireStockAccess();
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
  await requireStockAccess();
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
  await requireStockAccess();
  const { productId, price } = input;
  if (Number.isNaN(price) || price < 0) {
    throw new Error("Price cannot be negative");
  }

  const { error } = await supabaseAdmin.from("products").update({ price }).eq("id", productId);

  if (error) throw error;

  revalidatePath("/stock");
  revalidatePath("/sales");
  revalidatePath("/accountance");
}

// null clears the cost price back to "unknown" -- COGS/margin reporting
// treats that as a warning, never as $0.
export async function setProductCostAction(input: {
  productId: string;
  costPrice: number | null;
}): Promise<void> {
  await requireStockAccess();
  const { productId, costPrice } = input;
  if (costPrice !== null && (Number.isNaN(costPrice) || costPrice < 0)) {
    throw new Error("Cost price cannot be negative");
  }

  const { error } = await supabaseAdmin
    .from("products")
    .update({ cost_price: costPrice })
    .eq("id", productId);

  if (error) throw error;

  if (costPrice !== null) await backfillOrderItemCogs(productId);

  revalidatePath("/stock");
  revalidatePath("/sales");
  revalidatePath("/accountance");
}

// null clears the weight back to "unknown" -- Cost Control Set lines can't
// offer kg/g Scale conversion for this product until it's set.
export async function setProductWeightAction(input: {
  productId: string;
  weightGrams: number | null;
}): Promise<void> {
  await requireStockAccess();
  const { productId, weightGrams } = input;
  if (weightGrams !== null && (Number.isNaN(weightGrams) || weightGrams <= 0)) {
    throw new Error("Weight must be greater than zero");
  }

  const { error } = await supabaseAdmin
    .from("products")
    .update({ weight_grams: weightGrams })
    .eq("id", productId);

  if (error) throw error;

  revalidatePath("/stock");
  revalidatePath("/marketing");
}

export async function setProductIsIngredientAction(input: {
  productId: string;
  isIngredient: boolean;
}): Promise<void> {
  await requireStockAccess();
  const { productId, isIngredient } = input;

  const { error } = await supabaseAdmin
    .from("products")
    .update({ is_ingredient: isIngredient })
    .eq("id", productId);

  if (error) throw error;

  revalidatePath("/stock");
  revalidatePath("/sales");
}

export type RecipeItemRow = {
  id: string;
  ingredientProductId: string;
  ingredientName: string;
  quantity: number;
};

export async function getRecipeItemsAction(productId: string): Promise<RecipeItemRow[]> {
  await requireStockAccess();
  const { data, error } = await supabaseAdmin
    .from("recipe_items")
    .select("id, ingredient_product_id, quantity, products!recipe_items_ingredient_product_id_fkey(name)")
    .eq("product_id", productId)
    .order("created_at");

  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    ingredientProductId: r.ingredient_product_id,
    ingredientName: (r.products as { name: string } | null)?.name ?? "—",
    quantity: r.quantity,
  }));
}

export async function addRecipeItemAction(input: {
  productId: string;
  ingredientProductId: string;
  quantity: number;
}): Promise<void> {
  await requireStockAccess();
  const { productId, ingredientProductId, quantity } = input;
  if (productId === ingredientProductId) {
    throw new Error("A product can't be an ingredient of itself");
  }
  if (Number.isNaN(quantity) || quantity <= 0) {
    throw new Error("Quantity must be greater than zero");
  }

  const { error } = await supabaseAdmin
    .from("recipe_items")
    .upsert(
      { product_id: productId, ingredient_product_id: ingredientProductId, quantity },
      { onConflict: "product_id,ingredient_product_id" }
    );

  if (error) throw error;

  revalidatePath("/stock");
  revalidatePath("/sales");
}

export async function removeRecipeItemAction(input: { recipeItemId: string }): Promise<void> {
  await requireStockAccess();
  const { error } = await supabaseAdmin.from("recipe_items").delete().eq("id", input.recipeItemId);

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
  await requireStockAccess();
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
  await requireStockAccess();
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
  await requireStockAccess();
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
  await requireStockAccess();
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
  await requireStockAccess();
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
  await requireStockAccess();
  const { error } = await supabaseAdmin.from("categories").delete().eq("id", input.categoryId);

  if (error) throw error;

  revalidatePath("/stock");
  revalidatePath("/sales");
}

export async function renameProductAction(input: { productId: string; name: string }): Promise<void> {
  await requireStockAccess();
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
  await requireStockAccess();
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
