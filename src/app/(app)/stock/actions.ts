"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { pushStockToSites, searchSiteProducts, linkProductToSite, type SiteProductCandidate } from "@/lib/site-sync";
import { requireFullStockAccess, requireStockAccess } from "@/lib/stockAccess";
import { computeLineCogs, computeRecipeUnitCost } from "@/lib/cogs";
import { ALL_BUSINESSES_ID } from "@/lib/supabase/queries";
import { COUNTED_FULFILLMENT_STATUSES } from "@/lib/orderStatus";
import { ppDayEnd, ppDayStart } from "@/lib/phnomPenhTime";
import {
  derivePurchaseCost,
  getEffectiveProductCost,
  setWebsitePurchaseCost,
  syncSetItemCostsForProduct,
  writeCost10pctToStock,
  writeCostToStockTotal,
} from "@/lib/websiteProducts/purchaseCosts";
import type { ProductSiteLink, StockAdjustmentCategory } from "@/types/database";
import { ensurePosProductForSiteProduct } from "@/app/(app)/sales/websiteActions";
import { getWebsiteProduct } from "@/lib/websiteProducts/client";
import type { WebsiteCatalogId } from "@/lib/websiteProducts/types";

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

// The Margin Report's Unit Cost is the cost recorded on the sold lines (see
// getMarginReport), so a cost typed there overwrites the recorded cost on the
// lines the report is showing (the backfill above only touches lines with no cost
// at all); sales outside the brand/date range keep their recorded cost. Lines are
// the ones the report reads (dated by list_at, scoped by the product's business).
// It corrects what those sales cost only: the product's Total Cost 10% and Total in
// Stock, and its own cost, are left alone. The lines are marked cost_source "report"
// (migration 0079), which is how the report keeps showing the typed cost.
export async function setMarginUnitCostAction(input: {
  productId: string;
  unitCost: number;
  brandId: string;
  fromDate: string;
  toDate: string;
}): Promise<void> {
  await requireStockAccess();
  const { productId, unitCost, ...range } = input;
  if (Number.isNaN(unitCost) || unitCost < 0) {
    throw new Error("Unit cost cannot be negative");
  }

  const items: { id: string; quantity: number }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let query = supabaseAdmin
      .from("order_items")
      .select("id, quantity, products!inner(brand_id), orders!inner(status, list_at, fulfillment_status)")
      .eq("product_id", productId)
      .eq("orders.status", "paid")
      .in("orders.fulfillment_status", COUNTED_FULFILLMENT_STATUSES)
      .gte("orders.list_at", ppDayStart(range.fromDate))
      .lte("orders.list_at", ppDayEnd(range.toDate));
    if (range.brandId !== ALL_BUSINESSES_ID) query = query.eq("products.brand_id", range.brandId);
    const { data, error } = await query.order("id").range(from, from + PAGE - 1);
    if (error) throw error;
    for (const item of data ?? []) items.push({ id: item.id, quantity: Number(item.quantity) });
    if (!data || data.length < PAGE) break;
  }

  const results = await Promise.all(
    items.map((item) =>
      supabaseAdmin
        .from("order_items")
        .update({ unit_cost: unitCost, cogs: computeLineCogs(unitCost, item.quantity), cost_source: "report" })
        .eq("id", item.id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    if (failed.error.code === "23514") {
      throw new Error("Apply migration 0079_margin_report_unit_cost_override.sql in Supabase first, then try again.");
    }
    throw failed.error;
  }

  revalidatePath("/accountance");
  revalidatePath(`/accountance/margin/${productId}`);
}

// Edits one "N sold at $X" group of the Margin Report: the product's sold lines
// that the report shows as sold at `fromCost` are re-priced at `toCost`; its other
// groups, and sales outside the business/date range, keep the cost they were made
// at. Lines are matched the way the report groups them (the recorded unit cost, else
// cogs / quantity, to the cent) over the same lines it reads (paid, counted
// statuses, dated by list_at, scoped by the product's business). Unlike
// setMarginUnitCostAction this leaves the product's current cost in Stock alone --
// it corrects what past sales cost, not what the product costs now.
export async function setMarginSoldAtCostAction(input: {
  productId: string;
  fromCost: number;
  toCost: number;
  brandId: string;
  fromDate: string;
  toDate: string;
}): Promise<{ updated: number }> {
  await requireFullStockAccess();
  const { productId, brandId, fromDate, toDate } = input;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const fromCost = round2(input.fromCost);
  const toCost = round2(input.toCost);
  if (Number.isNaN(fromCost) || Number.isNaN(toCost) || toCost < 0) {
    throw new Error("Cost cannot be negative");
  }
  if (fromCost === toCost) return { updated: 0 };

  const matching: { id: string; quantity: number }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let query = supabaseAdmin
      .from("order_items")
      .select("id, quantity, cogs, unit_cost, products!inner(brand_id), orders!inner(status, list_at, paid_at, fulfillment_status)")
      .eq("product_id", productId)
      .eq("orders.status", "paid")
      .in("orders.fulfillment_status", COUNTED_FULFILLMENT_STATUSES)
      .gte("orders.list_at", ppDayStart(fromDate))
      .lte("orders.list_at", ppDayEnd(toDate));
    if (brandId !== ALL_BUSINESSES_ID) query = query.eq("products.brand_id", brandId);
    const { data, error } = await query.order("id").range(from, from + PAGE - 1);
    if (error) throw error;
    for (const item of data ?? []) {
      const quantity = Number(item.quantity);
      const lineCost =
        item.unit_cost !== null
          ? round2(Number(item.unit_cost))
          : item.cogs !== null && quantity
            ? round2(Number(item.cogs) / quantity)
            : null;
      if (lineCost === fromCost) matching.push({ id: item.id, quantity });
    }
    if (!data || data.length < PAGE) break;
  }
  if (matching.length === 0) {
    throw new Error("Those sales changed since the page loaded -- refresh and try again.");
  }

  const results = await Promise.all(
    matching.map((item) =>
      supabaseAdmin
        .from("order_items")
        .update({ unit_cost: toCost, cogs: computeLineCogs(toCost, item.quantity), cost_source: "direct" })
        .eq("id", item.id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;

  revalidatePath("/accountance");
  revalidatePath(`/accountance/margin/${productId}`);
  return { updated: matching.length };
}

export async function adjustStockAction(input: {
  productId: string;
  delta: number;
  reason?: string;
  category?: StockAdjustmentCategory;
  // Backdates the logged stock_adjustments row (ISO timestamp) -- e.g.
  // Accountance's "Add waste item" form lets someone log today a waste event
  // that actually happened on an earlier day. Omit for "now" (the default).
  createdAt?: string;
}): Promise<{ quantity: number }> {
  const { productId, delta, reason, category, createdAt } = input;
  const user = await requireStockAccess();

  // Falls back to a website item's Purchase Cost Total (Stock page), then to
  // the product's own cost_price -- see getEffectiveProductCost. If neither
  // was ever recorded, falls back once more to the product's regular selling
  // price so waste/promotion still gets *some* dollar value instead of
  // always snapshotting $0 for an item nobody ever entered a cost for.
  let costPriceOverride = await getEffectiveProductCost(productId).catch(() => null);
  if (costPriceOverride === null) {
    const { data: product } = await supabaseAdmin
      .from("products")
      .select("price")
      .eq("id", productId)
      .single();
    costPriceOverride = product?.price ?? null;
  }

  const { data, error } = await supabaseAdmin.rpc("adjust_stock", {
    p_product_id: productId,
    p_delta: delta,
    p_reason: reason ?? null,
    p_created_by: user?.id ?? null,
    p_category: category ?? "other",
    p_cost_price_override: costPriceOverride,
    p_created_at: createdAt ?? null,
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

  // Keep Stock's Website tab in step: its Total column is a separate store
  // (website_product_purchase_costs), so a cost set here -- e.g. from the
  // Margin Report's Unit Cost -- would otherwise leave Total blank or stale
  // for a linked product, and that Total wins in getEffectiveProductCost.
  await writeCostToStockTotal(productId, costPrice);
  // ...and Total Cost 10%, which the Margin Report's Unit Cost is taken from.
  if (costPrice !== null) await writeCost10pctToStock(productId, costPrice);

  // A Set item's Unit Cost only wins over this when the product also has a
  // fully-entered Purchase Cost Total (see getEffectiveProductCost) --
  // otherwise this new cost_price is exactly what should show there now.
  await syncSetItemCostsForProduct(productId);

  revalidatePath("/stock");
  revalidatePath("/sales");
  revalidatePath("/accountance");
  revalidatePath("/marketing");
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

// A cheap "has anything changed" fingerprint for LiveOrdersWatcher, which
// piggybacks this onto its existing order-activity poll so a brand-new (or
// renamed/reordered/deleted) category shows up in an already-open Sales tab
// without a manual reload -- categories are passed down as server-rendered
// props, so nothing else tells an already-mounted page to re-fetch them.
export async function getCategoriesFingerprintAction(): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("categories")
    .select("id, brand_id, name, sort_order")
    .order("brand_id")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((c) => `${c.id}:${c.brand_id}:${c.name}:${c.sort_order}`).join("|");
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
    // Renaming is how staff confirm an auto-created website product is real,
    // so it also clears its "review" flag.
    .update({ name: trimmed, auto_created: false })
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

// A product sold only at the POS and never on the website (migration 0083). It has no
// website link, so Stock's website list doesn't show it -- the "+ POS-only product"
// dialog manages it -- and Sales offers it under "POS only".
export async function createPosOnlyProductAction(input: {
  brandId: string;
  name: string;
  price: number;
  unit: string;
  stock: number;
}): Promise<{ id: string }> {
  await requireStockAccess();
  // The name may be left blank and typed in the row afterwards; Sales doesn't offer the
  // product until it has one.
  const name = input.name.trim();
  if (!Number.isFinite(input.price) || input.price < 0) throw new Error("Price cannot be negative");
  if (!Number.isFinite(input.stock) || input.stock < 0) throw new Error("Stock cannot be negative");

  const { data, error } = await supabaseAdmin
    .from("products")
    .insert({
      brand_id: input.brandId,
      category_id: null,
      name,
      sku: null,
      price: input.price,
      unit: input.unit.trim() || "pcs",
      image_url: null,
      is_active: true,
      pos_only: true,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(
      error?.message.includes("pos_only")
        ? "Run migration 0083 (products.pos_only) first, then try again."
        : (error?.message ?? "Failed to create product")
    );
  }

  if (input.stock > 0) await adjustStockAction({ productId: data.id, delta: input.stock, reason: "Initial stock" });

  revalidatePath("/stock");
  revalidatePath("/sales");
  return { id: data.id };
}

// The Original Cost / Total Cost 10% / Extra Cost / Total columns of a POS-only product.
// They are kept the way a website product's are (website_product_purchase_costs, keyed by
// "pos:<product id>" under the product's business), and the resulting Total is written to
// products.cost_price -- which is where COGS and the Margin Report read a product that has
// no website listing, so the cost works everywhere without further wiring.
export async function setPosOnlyCostAction(input: {
  productId: string;
  fields: Partial<{
    original_cost: number | null;
    total_cost_10pct: number | null;
    extra_money: number | null;
    total_override: number | null;
  }>;
}): Promise<void> {
  await requireStockAccess();
  const { productId, fields } = input;
  for (const v of Object.values(fields)) {
    if (v !== null && v !== undefined && (!Number.isFinite(v) || v < 0)) throw new Error("Cost cannot be negative");
  }

  const { data: product, error } = await supabaseAdmin
    .from("products")
    .select("pos_only, brands!inner(slug)")
    .eq("id", productId)
    .single();
  if (error || !product) throw error ?? new Error("Product not found");
  if (!product.pos_only) throw new Error("This product is on the website -- edit its costs there");
  const site = (product.brands as unknown as { slug: string }).slug as ProductSiteLink["site"];
  const siteProductId = `pos:${productId}`;

  await setWebsitePurchaseCost(site, siteProductId, "", fields);
  const { data: row } = await supabaseAdmin
    .from("website_product_purchase_costs")
    .select("original_cost, total_cost_10pct, extra_money, total_override")
    .eq("site", site)
    .eq("site_product_id", siteProductId)
    .eq("variation_id", "")
    .maybeSingle();
  const { total } = derivePurchaseCost({
    originalCost: row?.original_cost ?? null,
    totalCost10pct: row?.total_cost_10pct ?? null,
    extraMoney: row?.extra_money ?? null,
    totalOverride: row?.total_override ?? null,
  });
  const { error: updateError } = await supabaseAdmin.from("products").update({ cost_price: total }).eq("id", productId);
  if (updateError) throw updateError;

  revalidatePath("/stock");
  revalidatePath("/marketing");
  revalidatePath("/accountance");
}

// The pencil (Edit) box of a POS-only product: its name, Khmer name, scale (unit), Khmer
// scale and weight -- the same fields the website table's Edit box saves on the linked
// POS product.
export async function setPosOnlyDetailsAction(input: {
  productId: string;
  name: string;
  nameKm: string;
  unit: string;
  unitKm: string;
  weightGrams: number | null;
}): Promise<void> {
  await requireStockAccess();
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");
  const unit = input.unit.trim();
  if (!unit) throw new Error("Pick a scale (pcs, kg or g)");
  if (input.weightGrams !== null && !(input.weightGrams > 0)) throw new Error("Weight must be greater than zero");

  const { error } = await supabaseAdmin
    .from("products")
    .update({
      name,
      name_km: input.nameKm.trim() || null,
      unit,
      unit_km: input.unitKm.trim() || null,
      weight_grams: input.weightGrams,
      auto_created: false,
    })
    .eq("id", input.productId)
    .eq("pos_only", true);
  if (error) throw error;

  revalidatePath("/stock");
  revalidatePath("/sales");
  revalidatePath("/marketing");
}

// Gives a POS-only product the picture of another product in its business (picked in the
// Edit box's "Choose from products"). The picture file is shared, not copied. The product
// takes that product's name and Khmer name with it, when they are given.
export async function setPosOnlyImageUrlAction(input: {
  productId: string;
  imageUrl: string;
  name?: string;
  nameKm?: string | null;
}): Promise<void> {
  await requireStockAccess();
  const imageUrl = input.imageUrl.trim();
  if (!/^https?:\/\//i.test(imageUrl)) throw new Error("Not a picture address");
  const patch: { image_url: string; name?: string; name_km?: string | null } = { image_url: imageUrl };
  const name = input.name?.trim();
  if (name) {
    patch.name = name;
    patch.name_km = input.nameKm?.trim() || null;
  }
  const { error } = await supabaseAdmin
    .from("products")
    .update(patch)
    .eq("id", input.productId)
    .eq("pos_only", true);
  if (error) throw error;

  revalidatePath("/stock");
  revalidatePath("/sales");
}

// Makes a POS-only product follow the stock of a website product -- or, for a product with
// sizes, of all its sizes added together (siteVariationId null). The POS-only product takes
// the total now; from then on the database keeps the two in step both ways (migration 0084):
// selling it, cancelling an order or editing its stock moves the source's stock the same
// amount, and any change to the source (a website order, a stock edit) shows on it.
// Each size is linked to its POS product on the way (created if it has none yet).
export async function setPosOnlyStockSourceAction(input: {
  productId: string;
  catalogId: WebsiteCatalogId;
  siteProductId: string;
  siteVariationId: string | null;
  name: string;
}): Promise<{ quantity: number }> {
  await requireStockAccess();
  const { productId, catalogId, siteProductId, siteVariationId } = input;

  const site = await getWebsiteProduct(catalogId, siteProductId);
  const sizes = site.variations ?? [];
  const isVariable = (site.type === "variable" || site.type === "variant") && sizes.length > 0;
  const targets: { variationId: string | null; title: string; price: number; imageUrl: string | null; stock: number | null }[] =
    siteVariationId
      ? sizes
          .filter((v) => v.id === siteVariationId)
          .map((v) => ({
            variationId: v.id,
            title: v.weight ? `${site.title} (${v.weight})` : site.title,
            price: v.price,
            imageUrl: v.image_url ?? site.image_url,
            stock: v.stock,
          }))
      : isVariable
        ? sizes.map((v) => ({
            variationId: v.id,
            title: v.weight ? `${site.title} (${v.weight})` : site.title,
            price: v.price,
            imageUrl: v.image_url ?? site.image_url,
            stock: v.stock,
          }))
        : [{ variationId: null, title: site.title, price: site.price, imageUrl: site.image_url, stock: site.stock }];
  if (targets.length === 0) throw new Error("That size isn't on the website any more");

  // Nothing on the website counts this product's stock ("—"): the POS-only product is not
  // counted either, rather than copying the 0 / -1 the POS keeps for it.
  if (targets.every((t) => t.stock === null)) {
    const { error: untrackedError } = await supabaseAdmin.rpc("set_pos_only_untracked", {
      p_product_id: productId,
      p_name: input.name,
    });
    if (untrackedError) {
      throw new Error(
        untrackedError.message.includes("set_pos_only_untracked") || untrackedError.message.includes("stock_untracked")
          ? "Run migration 0086 first, then try again."
          : untrackedError.message
      );
    }
    revalidatePath("/stock");
    revalidatePath("/sales");
    return { quantity: 0 };
  }

  const sourceIds: string[] = [];
  for (const t of targets) {
    const linked = await ensurePosProductForSiteProduct({
      catalogId,
      siteProductId,
      variationId: t.variationId,
      title: t.title,
      price: t.price,
      imageUrl: t.imageUrl,
      stock: t.stock,
    });
    sourceIds.push(linked.id);
  }

  const { data, error } = await supabaseAdmin.rpc("link_pos_only_stock", {
    p_product_id: productId,
    p_source_ids: sourceIds,
    p_name: input.name,
  });
  if (error) {
    throw new Error(
      error.message.includes("link_pos_only_stock") || error.message.includes("stock_source")
        ? "Run migration 0084 first, then try again."
        : error.message
    );
  }

  // following a counted product again: no longer "not tracked" (ignored before migration 0085)
  await supabaseAdmin.from("products").update({ stock_untracked: false }).eq("id", productId);

  revalidatePath("/stock");
  revalidatePath("/sales");
  return { quantity: Number(data ?? 0) };
}

// Stops a POS-only product following other products' stock; it keeps the number it has now.
export async function unlinkPosOnlyStockAction(input: { productId: string }): Promise<void> {
  await requireStockAccess();
  const { error } = await supabaseAdmin
    .from("products")
    .update({ stock_source_ids: null, stock_source_name: null })
    .eq("id", input.productId)
    .eq("pos_only", true);
  if (error) throw error;
  // counted again, from the number it has now (ignored before migration 0085)
  await supabaseAdmin.from("products").update({ stock_untracked: false }).eq("id", input.productId);

  revalidatePath("/stock");
  revalidatePath("/sales");
}
