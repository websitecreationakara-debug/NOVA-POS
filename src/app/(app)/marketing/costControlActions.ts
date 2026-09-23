"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { requireMarketingAccess } from "./actions";
import {
  computeLineTotal,
  computeMargin,
  computeSetPricing,
  computeSetTotalCost,
  countItemsMissingCost,
  type SetPricing,
} from "@/lib/costControl";
import { getEffectiveProductCost, syncSetItemCostsForProduct } from "@/lib/websiteProducts/purchaseCosts";
import { ensurePosProductForSiteProduct } from "@/app/(app)/sales/websiteActions";
import { catalogForBrandSlug } from "@/lib/websiteProducts/catalogs";
import { createWebsiteProduct, deleteWebsiteProduct, updateWebsiteProduct } from "@/lib/websiteProducts/client";
import type { WebsiteCatalogId } from "@/lib/websiteProducts/types";
import type { ProductSiteLink, SetStatus } from "@/types/database";

// Cost Control's Set item search (see getStockPickerItems) can surface a
// website catalog item that has no POS product yet -- this creates that
// link on the fly, same as the first price/stock edit on Stock already
// does, so addSetItemAction below has a real productId to attach to.
export async function linkStockPickerItemAction(input: {
  catalogId: WebsiteCatalogId;
  siteProductId: string;
  variationId: string | null;
  title: string;
  price: number;
  imageUrl: string | null;
  stock: number | null;
}): Promise<{ productId: string }> {
  await requireMarketingAccess();
  const linked = await ensurePosProductForSiteProduct(input);
  return { productId: linked.id };
}

export type SetSummary = {
  id: string;
  code: string;
  name: string;
  status: SetStatus;
  itemCount: number;
  totalCost: number | null;
  itemsMissingCost: number;
  suggestedSellPrice: number | null;
  marginPct: number | null;
  updatedAt: string;
  // Pricing model manual inputs (see migration 0031) plus every derived
  // field, computed fresh from these + totalCost (this set's "Set Cost").
  targetMarkupPct: number | null;
  laborCost: number | null;
  competitorName: string | null;
  competitorBasePrice: number | null;
  pricing: SetPricing;
};

type SetItemCostRow = { amount: number; unit_cost: number | null };

export async function listSetsAction(brandId: string): Promise<SetSummary[]> {
  await requireMarketingAccess();
  const { data, error } = await supabaseAdmin
    .from("sets")
    .select("*, set_items(amount, unit_cost)")
    .eq("brand_id", brandId);
  if (error) throw new Error(error.message);

  // Set ID smaller-to-bigger (A1, A1.1, A2, A7.1, A8.1, A8.2, B1, ...) --
  // `numeric: true` makes the digit runs compare by value instead of
  // lexically, so "A2" sorts before "A10" instead of after it.
  const sorted = [...(data ?? [])].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" })
  );

  return sorted.map((s) => {
    const items = (s.set_items as SetItemCostRow[] | null) ?? [];
    const itemCosts = items.map((i) => ({ amount: i.amount, unitCost: i.unit_cost }));
    const totalCost = computeSetTotalCost(itemCosts);
    const { marginPct } = computeMargin(totalCost, s.suggested_sell_price);
    const pricing = computeSetPricing({
      setCost: totalCost,
      targetMarkupPct: s.target_markup_pct,
      laborCost: s.labor_cost,
      competitorBasePrice: s.competitor_base_price,
    });
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      status: s.status,
      itemCount: items.length,
      totalCost,
      itemsMissingCost: countItemsMissingCost(itemCosts),
      suggestedSellPrice: s.suggested_sell_price,
      marginPct,
      updatedAt: s.updated_at,
      targetMarkupPct: s.target_markup_pct,
      laborCost: s.labor_cost,
      competitorName: s.competitor_name,
      competitorBasePrice: s.competitor_base_price,
      pricing,
    };
  });
}

export type SetItemDetail = {
  id: string;
  productId: string;
  productName: string;
  productImageUrl: string | null;
  // The product's own Stock unit -- distinct from `unit` below (this line's
  // chosen Scale) -- used with productName/productWeightGrams to work out
  // how many grams the product's cost basis represents, so changing Scale
  // to kg/g can rescale baseCostPerUnit correctly. See productWeightGrams
  // in costControl.ts.
  productUnit: string;
  // The product's explicit Stock weight (grams per unit), if set -- takes
  // priority over guessing from productUnit/productName.
  productWeightGrams: number | null;
  // The product's cost for one native pack/unit, fetched fresh each read
  // (not the possibly stale/rescaled unit_cost below) -- the reference
  // computeUnitCostForScale rescales from when Scale changes.
  baseCostPerUnit: number | null;
  amount: number;
  unit: string;
  unitCost: number | null;
  lineTotal: number | null;
};

export type SetDetail = {
  id: string;
  brandId: string;
  code: string;
  name: string;
  status: SetStatus;
  suggestedSellPrice: number | null;
  items: SetItemDetail[];
  totalCost: number | null;
  itemsMissingCost: number;
  marginPct: number | null;
  targetMarkupPct: number | null;
  laborCost: number | null;
  competitorName: string | null;
  competitorBasePrice: number | null;
  pricing: SetPricing;
};

type SetItemDetailRow = {
  id: string;
  product_id: string;
  amount: number;
  unit: string;
  unit_cost: number | null;
  sort_order: number;
  products: { name: string; image_url: string | null; unit: string; weight_grams: number | null } | null;
};

export async function getSetAction(setId: string): Promise<SetDetail | null> {
  await requireMarketingAccess();
  const { data: set, error } = await supabaseAdmin
    .from("sets")
    .select(
      "*, set_items(id, product_id, amount, unit, unit_cost, sort_order, products(name, image_url, unit, weight_grams))"
    )
    .eq("id", setId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!set) return null;

  const rawItems = ((set.set_items as SetItemDetailRow[] | null) ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);
  const baseCosts = await Promise.all(rawItems.map((i) => getEffectiveProductCost(i.product_id)));
  const items: SetItemDetail[] = rawItems.map((i, idx) => ({
    id: i.id,
    productId: i.product_id,
    productName: i.products?.name ?? "—",
    productImageUrl: i.products?.image_url ?? null,
    productUnit: i.products?.unit ?? "",
    productWeightGrams: i.products?.weight_grams ?? null,
    baseCostPerUnit: baseCosts[idx],
    amount: i.amount,
    unit: i.unit,
    unitCost: i.unit_cost,
    lineTotal: computeLineTotal({ amount: i.amount, unitCost: i.unit_cost }),
  }));
  const itemCosts = items.map((i) => ({ amount: i.amount, unitCost: i.unitCost }));
  const totalCost = computeSetTotalCost(itemCosts);
  const { marginPct } = computeMargin(totalCost, set.suggested_sell_price);
  const pricing = computeSetPricing({
    setCost: totalCost,
    targetMarkupPct: set.target_markup_pct,
    laborCost: set.labor_cost,
    competitorBasePrice: set.competitor_base_price,
  });

  return {
    id: set.id,
    brandId: set.brand_id,
    code: set.code,
    name: set.name,
    status: set.status,
    suggestedSellPrice: set.suggested_sell_price,
    items,
    totalCost,
    itemsMissingCost: countItemsMissingCost(itemCosts),
    marginPct,
    targetMarkupPct: set.target_markup_pct,
    laborCost: set.labor_cost,
    competitorName: set.competitor_name,
    competitorBasePrice: set.competitor_base_price,
    pricing,
  };
}

export async function createSetAction(input: {
  brandId: string;
  code: string;
  name: string;
}): Promise<{ id: string }> {
  await requireMarketingAccess();
  const code = input.code.trim();
  const name = input.name.trim();
  if (!code) throw new Error("Set ID is required");
  if (!name) throw new Error("Set name is required");

  const { data, error } = await supabaseAdmin
    .from("sets")
    .insert({ brand_id: input.brandId, code, name })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") throw new Error(`Set ID "${code}" is already in use`);
    throw new Error(error?.message ?? "Failed to create set");
  }

  revalidatePath("/marketing");
  return { id: data.id };
}

// The Set's listed sell price when it goes live: prefers the pricing
// model's actual Sale Price (Base Price minus the purchase/processing fee),
// falling back through Recommend, the plain suggested_sell_price field, and
// finally Total Cost -- so a Set with none of the pricing inputs filled in
// yet still lists at *something* other than $0.
function resolveSetSellPrice(
  set: {
    suggested_sell_price: number | null;
    target_markup_pct: number | null;
    labor_cost: number | null;
    competitor_base_price: number | null;
  },
  totalCost: number | null
): number {
  const pricing = computeSetPricing({
    setCost: totalCost,
    targetMarkupPct: set.target_markup_pct,
    laborCost: set.labor_cost,
    competitorBasePrice: set.competitor_base_price,
  });
  return pricing.salePrice ?? pricing.recommend ?? set.suggested_sell_price ?? totalCost ?? 0;
}

// Pushes a Set's listing to its brand's storefront, if one is configured --
// creates it as an unpublished draft the first time (staff review/publish it
// from Stock > Website Products, same as any other new listing), or just
// refreshes title/price on an already-linked one. No-ops quietly if the
// brand has no storefront wired up. Never called for its own sake -- always
// via activateSetListing/deactivateSetListing, which catch its errors.
async function pushSetToWebsite(brandId: string, productId: string, title: string, price: number): Promise<void> {
  const { data: brand } = await supabaseAdmin.from("brands").select("slug").eq("id", brandId).single();
  const catalog = brand ? catalogForBrandSlug(brand.slug) : null;
  if (!catalog) return;
  const site = catalog.brandSlug as ProductSiteLink["site"];

  const { data: link } = await supabaseAdmin
    .from("product_site_links")
    .select("site_product_id")
    .eq("product_id", productId)
    .eq("site", site)
    .eq("variation_id", "")
    .maybeSingle();

  if (link) {
    await updateWebsiteProduct(catalog.id, link.site_product_id, { title, price });
    return;
  }

  const created = await createWebsiteProduct(catalog.id, { title, price, status: "draft" });

  // The storefront calls POS's own /api/product-sync webhook the instant it
  // sees a new product appear on it -- including this one -- which can beat
  // us here and plant its own throwaway POS product + link for the same
  // site_product_id first. Check for that before writing: if it won the
  // race, remember its product_id so it can be deactivated below instead of
  // being left behind as a duplicate.
  const { data: raced } = await supabaseAdmin
    .from("product_site_links")
    .select("product_id")
    .eq("site", site)
    .eq("site_product_id", created.id)
    .eq("variation_id", "")
    .maybeSingle();

  // onConflict targets the site's own uniqueness (site, site_product_id,
  // variation_id), not ours -- so this always lands as the row for this
  // site_product_id, overwriting the webhook's product_id with ours if it
  // got here first (never checking this upsert's error before was exactly
  // how it went un-noticed).
  const { error: linkErr } = await supabaseAdmin.from("product_site_links").upsert(
    {
      product_id: productId,
      site,
      site_product_id: created.id,
      variation_id: "",
      matched_name: title,
      match_confidence: "exact",
    },
    { onConflict: "site,site_product_id,variation_id" }
  );
  if (linkErr) throw new Error(linkErr.message);

  if (raced && raced.product_id !== productId) {
    await supabaseAdmin.from("products").update({ is_active: false }).eq("id", raced.product_id);
  }
}

// Makes an Active Set a real sellable listing: creates (first time) or
// reactivates its own `products` row -- so it shows up in Stock -- then
// best-effort pushes it to the storefront (see pushSetToWebsite). The POS
// side is not best-effort: a failure here throws, since it's the whole
// point of switching a Set to Active, not a side convenience.
async function activateSetListing(setId: string): Promise<void> {
  const { data: set, error } = await supabaseAdmin
    .from("sets")
    .select("*, set_items(amount, unit_cost)")
    .eq("id", setId)
    .single();
  if (error || !set) throw new Error(error?.message ?? "Set not found");

  const items = (set.set_items as SetItemCostRow[] | null) ?? [];
  const totalCost = computeSetTotalCost(items.map((i) => ({ amount: i.amount, unitCost: i.unit_cost })));
  const price = resolveSetSellPrice(set, totalCost);

  let productId = set.linked_product_id;
  if (productId) {
    const { error: updateErr } = await supabaseAdmin
      .from("products")
      .update({ name: set.name, price, is_active: true })
      .eq("id", productId);
    if (updateErr) throw new Error(updateErr.message);
  } else {
    const { data: product, error: createErr } = await supabaseAdmin
      .from("products")
      .insert({
        brand_id: set.brand_id,
        category_id: null,
        name: set.name,
        sku: set.code,
        price,
        unit: "pcs",
        image_url: null,
        is_active: true,
      })
      .select("id")
      .single();
    if (createErr || !product) throw new Error(createErr?.message ?? "Failed to create Set product");
    productId = product.id;
    const { error: linkErr } = await supabaseAdmin
      .from("sets")
      .update({ linked_product_id: productId })
      .eq("id", setId);
    if (linkErr) throw new Error(linkErr.message);
  }

  await pushSetToWebsite(set.brand_id, productId, set.name, price).catch((e) => {
    console.error(`Set ${setId} website push failed`, e);
  });
}

// Reverses activateSetListing: hides the Set's product from Stock
// (is_active: false, not deleted -- it may carry stock/order history) and
// deletes its website listing outright, if it has one -- not just
// unpublished, so it's gone from Stock > Website Products too, not sitting
// there with a Draft badge. Reactivating later creates a fresh listing (see
// pushSetToWebsite) rather than restoring this one. Website side is
// best-effort, same reasoning as activateSetListing.
async function deactivateSetListing(setId: string): Promise<void> {
  const { data: set, error } = await supabaseAdmin
    .from("sets")
    .select("linked_product_id, brand_id")
    .eq("id", setId)
    .single();
  if (error) throw new Error(error.message);
  if (!set || !set.linked_product_id) return;

  const { error: updateErr } = await supabaseAdmin
    .from("products")
    .update({ is_active: false })
    .eq("id", set.linked_product_id);
  if (updateErr) throw new Error(updateErr.message);

  try {
    const { data: brand } = await supabaseAdmin.from("brands").select("slug").eq("id", set.brand_id).single();
    const catalog = brand ? catalogForBrandSlug(brand.slug) : null;
    if (!catalog) return;
    const { data: link } = await supabaseAdmin
      .from("product_site_links")
      .select("id, site_product_id")
      .eq("product_id", set.linked_product_id)
      .eq("site", catalog.brandSlug as ProductSiteLink["site"])
      .eq("variation_id", "")
      .maybeSingle();
    if (link) {
      await deleteWebsiteProduct(catalog.id, link.site_product_id);
      await supabaseAdmin.from("product_site_links").delete().eq("id", link.id);
    }
  } catch (e) {
    console.error(`Set ${setId} website delete failed`, e);
  }
}

export async function updateSetAction(
  setId: string,
  input: Partial<{
    code: string;
    name: string;
    status: SetStatus;
    suggestedSellPrice: number | null;
    targetMarkupPct: number | null;
    laborCost: number | null;
    competitorName: string | null;
    competitorBasePrice: number | null;
  }>
): Promise<void> {
  await requireMarketingAccess();
  const fields: {
    updated_at: string;
    code?: string;
    name?: string;
    status?: SetStatus;
    suggested_sell_price?: number | null;
    target_markup_pct?: number | null;
    labor_cost?: number | null;
    competitor_name?: string | null;
    competitor_base_price?: number | null;
  } = { updated_at: new Date().toISOString() };
  if (input.code !== undefined) {
    const code = input.code.trim();
    if (!code) throw new Error("Set ID is required");
    fields.code = code;
  }
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("Set name is required");
    fields.name = name;
  }
  if (input.status !== undefined) fields.status = input.status;
  if (input.suggestedSellPrice !== undefined) fields.suggested_sell_price = input.suggestedSellPrice;
  if (input.targetMarkupPct !== undefined) fields.target_markup_pct = input.targetMarkupPct;
  if (input.laborCost !== undefined) fields.labor_cost = input.laborCost;
  if (input.competitorName !== undefined) fields.competitor_name = input.competitorName?.trim() || null;
  if (input.competitorBasePrice !== undefined) fields.competitor_base_price = input.competitorBasePrice;

  const { error } = await supabaseAdmin.from("sets").update(fields).eq("id", setId);
  if (error) {
    if (error.code === "23505") throw new Error(`Set ID "${input.code}" is already in use`);
    throw new Error(error.message);
  }

  // Status is the switch that makes a Set show up in Stock and (as a draft,
  // pending review) on the website -- see activateSetListing's comment.
  if (input.status === "active") {
    await activateSetListing(setId);
    revalidatePath("/stock");
    revalidatePath("/sales");
  } else if (input.status === "draft") {
    await deactivateSetListing(setId);
    revalidatePath("/stock");
    revalidatePath("/sales");
  }

  revalidatePath("/marketing");
}

export async function deleteSetAction(setId: string): Promise<void> {
  await requireMarketingAccess();
  // Best-effort: hide the Set's product/website listing before it's gone --
  // never blocks the delete itself if that cleanup fails.
  await deactivateSetListing(setId).catch((e) => console.error(`deactivateSetListing failed for set ${setId}`, e));
  revalidatePath("/stock");
  revalidatePath("/sales");
  const { error } = await supabaseAdmin.from("sets").delete().eq("id", setId);
  if (error) throw new Error(error.message);
  revalidatePath("/marketing");
}

// New code/name required from the caller (a small form on the confirm step)
// rather than guessed server-side. Clones every line item's current
// amount/unit/cost snapshot as-is.
export async function duplicateSetAction(
  setId: string,
  newCode: string,
  newName: string
): Promise<{ id: string }> {
  await requireMarketingAccess();
  const code = newCode.trim();
  const name = newName.trim();
  if (!code) throw new Error("Set ID is required");
  if (!name) throw new Error("Set name is required");

  const { data: original, error: fetchErr } = await supabaseAdmin
    .from("sets")
    .select(
      "brand_id, suggested_sell_price, target_markup_pct, labor_cost, competitor_name, competitor_base_price, set_items(product_id, amount, unit, unit_cost, sort_order)"
    )
    .eq("id", setId)
    .single();
  if (fetchErr || !original) throw new Error(fetchErr?.message ?? "Set not found");

  const { data: created, error: createErr } = await supabaseAdmin
    .from("sets")
    .insert({
      brand_id: original.brand_id,
      code,
      name,
      suggested_sell_price: original.suggested_sell_price,
      target_markup_pct: original.target_markup_pct,
      labor_cost: original.labor_cost,
      competitor_name: original.competitor_name,
      competitor_base_price: original.competitor_base_price,
    })
    .select("id")
    .single();
  if (createErr || !created) {
    if (createErr?.code === "23505") throw new Error(`Set ID "${code}" is already in use`);
    throw new Error(createErr?.message ?? "Failed to duplicate set");
  }

  type ClonedItem = {
    product_id: string;
    amount: number;
    unit: string;
    unit_cost: number | null;
    sort_order: number;
  };
  const items = (original.set_items as ClonedItem[] | null) ?? [];
  if (items.length > 0) {
    const { error: itemsErr } = await supabaseAdmin.from("set_items").insert(
      items.map((i) => ({
        set_id: created.id,
        product_id: i.product_id,
        amount: i.amount,
        unit: i.unit,
        unit_cost: i.unit_cost,
        sort_order: i.sort_order,
      }))
    );
    if (itemsErr) throw new Error(itemsErr.message);
  }

  revalidatePath("/marketing");
  return { id: created.id };
}

// Adding a product auto-fills unit/unit_cost from Stock right now -- the
// core UX point of the Set Builder (no re-typing a product's own cost).
// unit_cost prefers the product's linked storefront listing Total (Website
// Products panel) over its plain cost_price -- see getEffectiveProductCost.
export async function addSetItemAction(input: {
  setId: string;
  productId: string;
  amount: number;
}): Promise<void> {
  await requireMarketingAccess();
  if (Number.isNaN(input.amount) || input.amount <= 0) {
    throw new Error("Amount must be greater than zero");
  }

  const { data: product, error: prodErr } = await supabaseAdmin
    .from("products")
    .select("unit")
    .eq("id", input.productId)
    .single();
  if (prodErr || !product) throw new Error(prodErr?.message ?? "Product not found");
  const unitCost = await getEffectiveProductCost(input.productId);

  const { count } = await supabaseAdmin
    .from("set_items")
    .select("id", { count: "exact", head: true })
    .eq("set_id", input.setId);

  const { error } = await supabaseAdmin.from("set_items").insert({
    set_id: input.setId,
    product_id: input.productId,
    amount: input.amount,
    unit: product.unit,
    unit_cost: unitCost,
    sort_order: count ?? 0,
  });
  if (error) {
    if (error.code === "23505") {
      throw new Error("That product is already in this set -- edit its amount instead");
    }
    throw new Error(error.message);
  }

  await supabaseAdmin.from("sets").update({ updated_at: new Date().toISOString() }).eq("id", input.setId);
  revalidatePath("/marketing");
}

// "Manual" set items -- extras that aren't really Stock-tracked (garnish,
// sauce, fried garlic, ...) but still need a per-unit cost. Creates a real,
// lightweight product (brand-scoped, no image/category/storefront link) with
// the given cost_price, then adds it to this set. Because it's a real
// product it's reusable -- it shows up in the Items search for any set in
// this brand from now on, exactly like a Stock product does.
export async function addManualSetItemAction(input: {
  setId: string;
  brandId: string;
  name: string;
  amount: number;
  unitCost: number;
}): Promise<void> {
  await requireMarketingAccess();
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");
  if (Number.isNaN(input.amount) || input.amount <= 0) {
    throw new Error("Amount must be greater than zero");
  }
  if (Number.isNaN(input.unitCost) || input.unitCost < 0) {
    throw new Error("Price cannot be negative");
  }

  const { data: product, error: productErr } = await supabaseAdmin
    .from("products")
    .insert({
      brand_id: input.brandId,
      category_id: null,
      name,
      sku: null,
      price: 0,
      cost_price: input.unitCost,
      unit: "pcs",
      image_url: null,
      is_active: true,
    })
    .select("id, unit")
    .single();
  if (productErr || !product) throw productErr ?? new Error("Failed to create item");

  const { count } = await supabaseAdmin
    .from("set_items")
    .select("id", { count: "exact", head: true })
    .eq("set_id", input.setId);

  const { error } = await supabaseAdmin.from("set_items").insert({
    set_id: input.setId,
    product_id: product.id,
    amount: input.amount,
    unit: product.unit,
    unit_cost: input.unitCost,
    sort_order: count ?? 0,
  });
  if (error) throw new Error(error.message);

  await supabaseAdmin.from("sets").update({ updated_at: new Date().toISOString() }).eq("id", input.setId);
  revalidatePath("/marketing");
  revalidatePath("/stock");
}

// A set line's Unit Cost can drift from its product's price over time (the
// user's own words: "the price some time it increase or decrease"). Called
// alongside updateSetItemAction (which already updates the line's own
// unit_cost) to also update the underlying product's cost_price -- then
// pushes that new cost into every *other* set using this same item too (see
// syncSetItemCostsForProduct), so it's not just the next new addition that
// picks it up. Only meaningful for a non-weight-scale line (see
// CostControlClient) -- a weight-scale line's Unit Cost is derived instead
// (computeUnitCostForScale).
export async function syncManualItemProductCostAction(productId: string, unitCost: number): Promise<void> {
  await requireMarketingAccess();
  if (Number.isNaN(unitCost) || unitCost < 0) {
    throw new Error("Price cannot be negative");
  }

  const { error } = await supabaseAdmin.from("products").update({ cost_price: unitCost }).eq("id", productId);
  if (error) throw new Error(error.message);

  await syncSetItemCostsForProduct(productId);

  revalidatePath("/marketing");
  revalidatePath("/stock");
}

export async function updateSetItemAction(
  itemId: string,
  input: Partial<{ amount: number; unit: string; unitCost: number | null }>
): Promise<void> {
  await requireMarketingAccess();
  const fields: { amount?: number; unit?: string; unit_cost?: number | null } = {};
  if (input.amount !== undefined) {
    if (Number.isNaN(input.amount) || input.amount <= 0) {
      throw new Error("Amount must be greater than zero");
    }
    fields.amount = input.amount;
  }
  if (input.unit !== undefined) {
    const unit = input.unit.trim();
    if (!unit) throw new Error("Unit is required");
    fields.unit = unit;
  }
  if (input.unitCost !== undefined) fields.unit_cost = input.unitCost;
  if (Object.keys(fields).length === 0) return;

  const { data: item, error } = await supabaseAdmin
    .from("set_items")
    .update(fields)
    .eq("id", itemId)
    .select("set_id")
    .single();
  if (error || !item) throw new Error(error?.message ?? "Failed to update item");

  await supabaseAdmin.from("sets").update({ updated_at: new Date().toISOString() }).eq("id", item.set_id);
  revalidatePath("/marketing");
}

export async function removeSetItemAction(itemId: string): Promise<void> {
  await requireMarketingAccess();
  const { data: item, error: fetchErr } = await supabaseAdmin
    .from("set_items")
    .select("set_id")
    .eq("id", itemId)
    .single();
  if (fetchErr || !item) throw new Error(fetchErr?.message ?? "Item not found");

  const { error } = await supabaseAdmin.from("set_items").delete().eq("id", itemId);
  if (error) throw new Error(error.message);

  await supabaseAdmin.from("sets").update({ updated_at: new Date().toISOString() }).eq("id", item.set_id);
  revalidatePath("/marketing");
}
