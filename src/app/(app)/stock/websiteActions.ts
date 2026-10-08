"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ensurePosProductForSiteProduct } from "@/app/(app)/sales/websiteActions";
import { getCatalog } from "@/lib/websiteProducts/catalogs";
import {
  createWebsiteAddon,
  createWebsiteCategory,
  createWebsiteProduct,
  deleteWebsiteAddon,
  deleteWebsiteProduct,
  deleteWebsiteProductVariation,
  listSellableWebsiteProducts,
  listWebsiteCategories,
  listWebsiteProducts,
  updateWebsiteAddon,
  getWebsiteProduct,
  updateWebsiteProduct,
  updateWebsiteProductVariation,
} from "@/lib/websiteProducts/client";
import { setWebsitePurchaseCost, syncSetItemCostsForProduct } from "@/lib/websiteProducts/purchaseCosts";
import type {
  WebsiteAddon,
  WebsiteAddonWrite,
  WebsiteCatalogId,
  WebsiteCategory,
  WebsiteCategoryWrite,
  WebsiteProduct,
  WebsiteProductWrite,
} from "@/lib/websiteProducts/types";
import type { ProductSiteLink, StockAdjustmentCategory } from "@/types/database";
import { requireStockAccess } from "@/lib/stockAccess";
import { isStockUntracked } from "@/lib/websiteProducts/stockTracking";
import { adjustStockAction, setProductPriceAction } from "./actions";

// A product whose website stock is blank ("—") is untracked, and the automatic stock pushes
// (sales, cancellations) deliberately leave it alone. But a number typed on the Stock page is a
// deliberate choice to start counting it, so that one is written to the website too -- otherwise
// the POS count changes while the Stock page keeps showing "—", as if the edit hadn't worked.
async function siteStockIsUntracked(
  catalogId: WebsiteCatalogId,
  siteProductId: string,
  variationId: string
): Promise<boolean> {
  const site = await getWebsiteProduct(catalogId, siteProductId).catch(() => null);
  return !!site && isStockUntracked(site, variationId);
}

// Setting a product back to "—" (unlimited) writes only the website, so the POS count stayed at
// whatever had been added -- and Accounting's stock figures still counted that add. A stock
// that's left over is taken back out here (and logged like any Stock page edit), which also
// cancels the earlier add in Inventory Purchased. Only a positive count is cleared: an
// unlimited product's POS count otherwise just drifts below 0 as it sells.
async function clearPosStockForUnlimited(
  productId: string,
  options: { category?: StockAdjustmentCategory; reason?: string; createdAt?: string }
): Promise<void> {
  const { data: live } = await supabaseAdmin
    .from("stock_levels")
    .select("quantity")
    .eq("product_id", productId)
    .maybeSingle();
  const quantity = live?.quantity ?? 0;
  if (quantity > 0) {
    await adjustStockAction({
      productId,
      delta: -quantity,
      reason: options.reason ?? "Stock page edit",
      category: options.category,
      createdAt: options.createdAt,
    });
  }
}

// Upload an image chosen from the user's computer to the public product-images
// bucket and hand back its URL, which then goes into a website product's
// image_url. Same bucket the POS catalog uses (migration 0010).
export async function uploadWebsiteImageAction(formData: FormData): Promise<{ url: string }> {
  await requireStockAccess();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image file");
  if (!file.type.startsWith("image/")) throw new Error("File must be an image");
  if (file.size > 5 * 1024 * 1024) throw new Error("Image must be under 5MB");

  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `website/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from("product-images")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);

  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from("product-images").getPublicUrl(path);
  return { url: publicUrl };
}

export async function listWebsiteProductsAction(
  catalogId: WebsiteCatalogId
): Promise<WebsiteProduct[]> {
  await requireStockAccess();
  return listWebsiteProducts(catalogId);
}

// The storefront's live category list (empty if it has no categories endpoint
// deployed yet) -- see listWebsiteCategories for the fallback behavior.
export async function listWebsiteCategoriesAction(
  catalogId: WebsiteCatalogId
): Promise<WebsiteCategory[]> {
  await requireStockAccess();
  return listWebsiteCategories(catalogId);
}

// Creates the category on the storefront itself, so it's available there too
// -- not just a POS-local label.
export async function createWebsiteCategoryAction(
  catalogId: WebsiteCatalogId,
  input: WebsiteCategoryWrite
): Promise<WebsiteCategory> {
  await requireStockAccess();
  const category = await createWebsiteCategory(catalogId, input);
  revalidatePath("/stock");
  return category;
}

// Sales' grid only -- see listSellableWebsiteProducts for why this merges in
// add-ons and Stock's product panel doesn't.
export async function listSellableWebsiteProductsAction(
  catalogId: WebsiteCatalogId
): Promise<WebsiteProduct[]> {
  await requireStockAccess();
  const { products } = await listSellableWebsiteProducts(catalogId);
  return products;
}

export async function createWebsiteAddonAction(
  catalogId: WebsiteCatalogId,
  input: WebsiteAddonWrite
): Promise<WebsiteAddon> {
  await requireStockAccess();
  const addon = await createWebsiteAddon(catalogId, input);
  revalidatePath("/stock");
  revalidatePath("/sales");
  return addon;
}

export async function updateWebsiteAddonAction(
  catalogId: WebsiteCatalogId,
  id: string,
  input: { price?: number; stock?: number | null; status?: WebsiteAddon["status"] }
): Promise<WebsiteAddon> {
  await requireStockAccess();
  const addon = await updateWebsiteAddon(catalogId, id, input);
  revalidatePath("/stock");
  revalidatePath("/sales");
  return addon;
}

export async function deleteWebsiteAddonAction(
  catalogId: WebsiteCatalogId,
  id: string
): Promise<void> {
  await requireStockAccess();
  await deleteWebsiteAddon(catalogId, id);
  revalidatePath("/stock");
  revalidatePath("/sales");
}

// Product table's Original Cost / Total Cost 10% / Extra Money columns --
// purely an internal purchasing record (what staff paid to acquire the
// stock), stored in POS's own database and never sent to the storefront.
export async function setWebsitePurchaseCostAction(
  catalogId: WebsiteCatalogId,
  siteProductId: string,
  variationId: string,
  fields: Partial<{
    original_cost: number | null;
    total_cost_10pct: number | null;
    extra_money: number | null;
    total_override: number | null;
  }>
): Promise<void> {
  await requireStockAccess();
  const site = getCatalog(catalogId).brandSlug as ProductSiteLink["site"];
  await setWebsitePurchaseCost(site, siteProductId, variationId, fields);

  // If this item is already linked to a POS product, push its new Total
  // straight into any Set that uses it (see syncSetItemCostsForProduct) --
  // otherwise Cost Control keeps showing the Unit Cost/Line Total from
  // whenever the line was last added or edited by hand.
  const { data: link } = await supabaseAdmin
    .from("product_site_links")
    .select("product_id")
    .eq("site", site)
    .eq("site_product_id", siteProductId)
    .eq("variation_id", variationId)
    .maybeSingle();
  if (link) await syncSetItemCostsForProduct(link.product_id);

  revalidatePath("/stock");
  revalidatePath("/marketing");
}

export async function createWebsiteProductAction(
  catalogId: WebsiteCatalogId,
  input: WebsiteProductWrite
): Promise<{ id: string }> {
  await requireStockAccess();
  const result = await createWebsiteProduct(catalogId, input);
  // Auto-links a POS product immediately, same as the first price/stock edit
  // already does for an existing product (see setSimpleProductPriceAction's
  // comment) -- otherwise a brand-new product has zero rows in POS's own
  // `products` table and can't be found in Cost Control's Set item search
  // until someone happens to re-save its price or stock once. Best-effort:
  // a hiccup here shouldn't block the product from being created.
  await ensurePosProductForSiteProduct({
    catalogId,
    siteProductId: result.id,
    variationId: "",
    title: input.title,
    price: input.price ?? 0,
    imageUrl: input.image_url ?? null,
    stock: input.stock ?? null,
  }).catch(() => null);
  revalidatePath("/stock");
  return result;
}

export async function updateWebsiteProductAction(
  catalogId: WebsiteCatalogId,
  id: string,
  input: Partial<WebsiteProductWrite>
): Promise<void> {
  await requireStockAccess();
  await updateWebsiteProduct(catalogId, id, input);
  revalidatePath("/stock");
}

// The storefront now has a real endpoint for a single variation
// (PATCH /api/products/:id/variations/:variationId -- see server.ts in the
// BOSBA Drink & Snack repo), so this writes the website first -- the source
// of truth for this size's price -- and only mirrors into POS's own linked
// product (the same record Sales creates the first time someone sells that
// size, see ensurePosProductForSiteProduct) once that succeeds. If the
// website write fails (e.g. a catalog that hasn't added the route yet), the
// whole action throws and POS's own data is left untouched, so the two never
// drift apart silently.
export async function setVariationPriceAction(input: {
  catalogId: WebsiteCatalogId;
  siteProductId: string;
  variationId: string;
  title: string;
  imageUrl: string | null;
  alreadyLinked: boolean;
  // Only used to seed stock if this is the first edit and no POS product
  // exists for this size yet.
  seedStock: number | null;
  price: number;
}): Promise<void> {
  await requireStockAccess();
  await updateWebsiteProductVariation(input.catalogId, input.siteProductId, input.variationId, {
    price: input.price,
  });

  const linked = await ensurePosProductForSiteProduct({
    catalogId: input.catalogId,
    siteProductId: input.siteProductId,
    variationId: input.variationId,
    title: input.title,
    price: input.price,
    imageUrl: input.imageUrl,
    stock: input.seedStock,
  });
  // ensurePosProductForSiteProduct only sets price at creation time -- if the
  // link already existed (at a different price), apply the new price now.
  if (input.alreadyLinked) {
    await setProductPriceAction({ productId: linked.id, price: input.price });
  }
}

export async function setVariationStockAction(input: {
  catalogId: WebsiteCatalogId;
  siteProductId: string;
  variationId: string;
  title: string;
  imageUrl: string | null;
  alreadyLinked: boolean;
  // Only used to seed price if this is the first edit and no POS product
  // exists for this size yet.
  seedPrice: number;
  // The POS product's stock right now (0 if not yet linked) -- used to turn
  // the typed absolute value into the delta adjustStockAction expects.
  currentStock: number;
  // null = unlimited stock -- written straight to the storefront with no POS
  // delta (nothing meaningful to decrement toward), same as an add-on's
  // blank Stock box.
  stock: number | null;
  // Accountance's "Add waste item" reuses this same sync (patch the
  // storefront + mirror into POS) tagged "waste" instead of a plain edit --
  // both default to the Stock page's own values so every other caller is
  // unaffected.
  category?: StockAdjustmentCategory;
  reason?: string;
  createdAt?: string;
}): Promise<void> {
  await requireStockAccess();

  const linked = await ensurePosProductForSiteProduct({
    catalogId: input.catalogId,
    siteProductId: input.siteProductId,
    variationId: input.variationId,
    title: input.title,
    price: input.seedPrice,
    imageUrl: input.imageUrl,
    stock: input.stock,
  });
  // ensurePosProductForSiteProduct seeds stock directly at creation time (to
  // the target value already) -- only need an explicit adjustment if the
  // link already existed.
  if (input.alreadyLinked && input.stock !== null) {
    // Read the live quantity instead of trusting input.currentStock -- see
    // setSimpleProductStockAction's comment on why a stale client-supplied
    // value silently re-drifts POS and the storefront apart.
    const { data: live } = await supabaseAdmin
      .from("stock_levels")
      .select("quantity")
      .eq("product_id", linked.id)
      .maybeSingle();
    const currentStock = live?.quantity ?? 0;
    const delta = input.stock - currentStock;
    const untracked = await siteStockIsUntracked(input.catalogId, input.siteProductId, input.variationId);
    if (delta !== 0) {
      // adjustStockAction pushes the resulting POS quantity straight back out
      // to the storefront (see pushStockToSites -- POS is the source of
      // truth for stock). Also PATCHing the storefront directly here, with
      // the same target value, sent it two writes for one edit -- harmless
      // if the storefront's endpoint really replaces the count, but at least
      // one live catalog's endpoint doesn't: it adds the given number instead
      // of setting it, so two writes of the same value doubled its stock.
      await adjustStockAction({
        productId: linked.id,
        delta,
        reason: input.reason ?? "Stock page edit",
        category: input.category,
        createdAt: input.createdAt,
      });
    }
    // That push skips an untracked ("—") size, so write the typed number to it directly.
    if (untracked) {
      await updateWebsiteProductVariation(input.catalogId, input.siteProductId, input.variationId, {
        stock: input.stock,
      });
    }
    return;
  }

  // Not yet linked (nothing else pushes to the storefront for a brand-new
  // link) or left "unlimited" (null, no POS delta to compute) -- write it
  // directly here, the one and only time.
  if (input.alreadyLinked && input.stock === null) {
    await clearPosStockForUnlimited(linked.id, input);
  }
  await updateWebsiteProductVariation(input.catalogId, input.siteProductId, input.variationId, {
    stock: input.stock,
  });
}

// Same as setVariationPriceAction/setVariationStockAction but for a simple
// (non-variable) product's own price/stock -- these used to only patch the
// storefront listing, so a simple product with no sales/manual link yet
// never got a POS product created for it and could never show up in a Cost
// Control Set's product search. variationId "" is the same composite-key
// convention a simple product's own link already uses (see
// ensurePosProductForSiteProduct).
export async function setSimpleProductPriceAction(input: {
  catalogId: WebsiteCatalogId;
  siteProductId: string;
  title: string;
  imageUrl: string | null;
  alreadyLinked: boolean;
  seedStock: number | null;
  price: number;
}): Promise<void> {
  await requireStockAccess();
  await updateWebsiteProduct(input.catalogId, input.siteProductId, { price: input.price });

  const linked = await ensurePosProductForSiteProduct({
    catalogId: input.catalogId,
    siteProductId: input.siteProductId,
    variationId: "",
    title: input.title,
    price: input.price,
    imageUrl: input.imageUrl,
    stock: input.seedStock,
  });
  if (input.alreadyLinked) {
    await setProductPriceAction({ productId: linked.id, price: input.price });
  }
}

// Edit button on a Website Products row: the product's Khmer name, its scale
// (unit: pcs / kg / g) and that scale in Khmer, which live on the linked POS product -- the website's
// own catalog has no field for either. Creates + links the POS product first
// if this row has never been sold or edited (same as the price/stock edits
// above). `posName` also brings the POS name in line with a title edited in the
// same save. variationId "" is a simple product, as elsewhere.
export async function setProductDetailsAction(input: {
  catalogId: WebsiteCatalogId;
  siteProductId: string;
  variationId: string;
  // Title used if the POS product has to be created now.
  title: string;
  price: number;
  imageUrl: string | null;
  seedStock: number | null;
  posName: string;
  nameKm: string;
  unit: string;
  // The scale written in Khmer (e.g. "ចំណែក" for pcs).
  unitKm: string;
}): Promise<void> {
  await requireStockAccess();
  const unit = input.unit.trim().toLowerCase();
  if (!unit) throw new Error("Pick a scale (pcs, kg or g)");
  const posName = input.posName.trim();
  if (!posName) throw new Error("Name is required");

  const linked = await ensurePosProductForSiteProduct({
    catalogId: input.catalogId,
    siteProductId: input.siteProductId,
    variationId: input.variationId,
    title: input.title,
    price: input.price,
    imageUrl: input.imageUrl,
    stock: input.seedStock,
  });
  const { error } = await supabaseAdmin
    .from("products")
    .update({
      name: posName,
      name_km: input.nameKm.trim() || null,
      unit,
      unit_km: input.unitKm.trim() || null,
    })
    .eq("id", linked.id);
  if (error) throw new Error(error.message);

  revalidatePath("/stock");
  revalidatePath("/sales");
}

// Changes -- or removes (imageUrl null) -- a Stock row's picture. A simple product's image is the product's own
// image_url on the website. One size of a "variable" product has its own image
// (the row shows `variation.image_url ?? product.image_url`), written through
// the variation's sub-route -- and checked on the way back, so a storefront that
// ignores an image on a single size says so instead of reporting a save that
// never happened. The linked POS product's own image is kept in step so
// everything that reads it (Cost Control, ...) shows the same picture.
export async function setProductImageAction(input: {
  catalogId: WebsiteCatalogId;
  siteProductId: string;
  variationId: string;
  imageUrl: string | null;
}): Promise<void> {
  await requireStockAccess();
  const imageUrl = input.imageUrl?.trim() || null;

  if (!input.variationId) {
    await updateWebsiteProduct(input.catalogId, input.siteProductId, { image_url: imageUrl });
    // The product PATCH answers with nothing, so read the product back to be sure
    // the website really took the new picture (or cleared it).
    const fresh = await getWebsiteProduct(input.catalogId, input.siteProductId);
    const path = (u: string | null | undefined) => u?.replace(/^https?:\/\/[^/]+/, "") || null;
    if (path(fresh.image_url) !== path(imageUrl)) {
      throw new Error(
        imageUrl
          ? "The website didn't accept the new image -- the picture was not changed."
          : "The website didn't remove the image -- the picture was not changed."
      );
    }
  } else {
    const updated = await updateWebsiteProductVariation(
      input.catalogId,
      input.siteProductId,
      input.variationId,
      { image_url: imageUrl }
    );
    const saved = updated?.variations?.find((v) => v.id === input.variationId)?.image_url ?? null;
    if (saved !== imageUrl) {
      throw new Error(
        imageUrl
          ? "The website didn't accept a new image for this size -- the picture was not changed."
          : "The website didn't remove the image for this size -- the picture was not changed."
      );
    }
  }

  const site = getCatalog(input.catalogId).brandSlug as ProductSiteLink["site"];
  const { data: link } = await supabaseAdmin
    .from("product_site_links")
    .select("product_id")
    .eq("site", site)
    .eq("site_product_id", input.siteProductId)
    .eq("variation_id", input.variationId)
    .maybeSingle();
  if (link) await supabaseAdmin.from("products").update({ image_url: imageUrl }).eq("id", link.product_id);

  revalidatePath("/stock");
  revalidatePath("/sales");
  revalidatePath("/marketing");
}

// The Edit box on an addon row: the English name and picture go to the
// storefront's add-on table (checked on the way back, so a storefront that
// ignores one says so instead of reporting a save that never happened); the
// Khmer name, scale and Khmer scale live on the linked POS product, created on
// the fly if this addon has none yet -- the same split setProductDetailsAction
// makes for a product.
export async function setAddonDetailsAction(input: {
  catalogId: WebsiteCatalogId;
  addonId: string;
  currentTitle: string;
  title: string;
  // The new picture's URL, only when one was uploaded.
  imageUrl: string | null;
  // True to take the picture off (the addon is left with no image).
  removeImage?: boolean;
  currentImageUrl: string | null;
  price: number;
  stock: number | null;
  nameKm: string;
  unit: string;
  unitKm: string;
}): Promise<void> {
  await requireStockAccess();
  const title = input.title.trim();
  if (!title) throw new Error("Name is required");
  const unit = input.unit.trim().toLowerCase();
  if (!unit) throw new Error("Pick a scale (pcs, kg or g)");

  const changes: { title?: string; image_url?: string | null } = {};
  if (title !== input.currentTitle.trim()) changes.title = title;
  if (input.imageUrl) changes.image_url = input.imageUrl;
  else if (input.removeImage) changes.image_url = null;
  if (Object.keys(changes).length > 0) {
    const updated = await updateWebsiteAddon(input.catalogId, input.addonId, changes);
    // A field the storefront echoes back that isn't what we sent was ignored.
    const path = (u: string | null | undefined) => u?.replace(/^https?:\/\/[^/]+/, "");
    if (changes.title && updated?.title !== undefined && updated.title !== changes.title) {
      throw new Error("The website didn't accept the new name -- nothing was changed.");
    }
    if (
      changes.image_url !== undefined &&
      updated?.image_url !== undefined &&
      path(updated.image_url) !== path(changes.image_url)
    ) {
      throw new Error(
        changes.image_url
          ? "The website didn't accept the new image -- nothing was changed."
          : "The website didn't remove the image -- nothing was changed."
      );
    }
  }

  const linked = await ensurePosProductForSiteProduct({
    catalogId: input.catalogId,
    siteProductId: input.addonId,
    variationId: "",
    title,
    price: input.price,
    imageUrl: input.removeImage ? null : (input.imageUrl ?? input.currentImageUrl),
    stock: input.stock,
  });
  const { error } = await supabaseAdmin
    .from("products")
    .update({
      name: title,
      name_km: input.nameKm.trim() || null,
      unit,
      unit_km: input.unitKm.trim() || null,
      ...(input.imageUrl ? { image_url: input.imageUrl } : input.removeImage ? { image_url: null } : {}),
    })
    .eq("id", linked.id);
  if (error) throw new Error(error.message);

  revalidatePath("/stock");
  revalidatePath("/sales");
  revalidatePath("/marketing");
}

export async function setSimpleProductStockAction(input: {
  catalogId: WebsiteCatalogId;
  siteProductId: string;
  title: string;
  imageUrl: string | null;
  alreadyLinked: boolean;
  seedPrice: number;
  currentStock: number;
  // null = unlimited stock -- see setVariationStockAction's comment.
  stock: number | null;
  category?: StockAdjustmentCategory;
  reason?: string;
  createdAt?: string;
}): Promise<void> {
  await requireStockAccess();

  const linked = await ensurePosProductForSiteProduct({
    catalogId: input.catalogId,
    siteProductId: input.siteProductId,
    variationId: "",
    title: input.title,
    price: input.seedPrice,
    imageUrl: input.imageUrl,
    stock: input.stock,
  });
  if (input.alreadyLinked && input.stock !== null) {
    // Read the live quantity instead of trusting input.currentStock (whatever
    // the browser had loaded) -- an online sale (or any other write) landing
    // between page-load and this save would otherwise make the delta below
    // land on the wrong number, silently drifting POS and the storefront
    // apart again right after they'd just been reconciled.
    const { data: live } = await supabaseAdmin
      .from("stock_levels")
      .select("quantity")
      .eq("product_id", linked.id)
      .maybeSingle();
    const currentStock = live?.quantity ?? 0;
    const delta = input.stock - currentStock;
    const untracked = await siteStockIsUntracked(input.catalogId, input.siteProductId, "");
    if (delta !== 0) {
      // See setVariationStockAction's comment -- adjustStockAction's own
      // pushStockToSites is the single write to the storefront here; a
      // second direct write of the same value duplicated it, which at least
      // one catalog's API applies as an increment rather than a replace.
      await adjustStockAction({
        productId: linked.id,
        delta,
        reason: input.reason ?? "Stock page edit",
        category: input.category,
        createdAt: input.createdAt,
      });
    }
    // That push skips an untracked ("—") product, so write the typed number to it directly.
    if (untracked) {
      await updateWebsiteProduct(input.catalogId, input.siteProductId, { stock: input.stock });
    }
    return;
  }

  if (input.alreadyLinked && input.stock === null) {
    await clearPosStockForUnlimited(linked.id, input);
  }
  await updateWebsiteProduct(input.catalogId, input.siteProductId, { stock: input.stock });
}

export async function deleteWebsiteProductAction(
  catalogId: WebsiteCatalogId,
  id: string
): Promise<void> {
  await requireStockAccess();
  await deleteWebsiteProduct(catalogId, id);
  revalidatePath("/stock");
}

// Removes just one size of a "variable" product; the product and its other
// sizes stay on the site. Deleting the last remaining size is left to the
// storefront to handle (it keeps an empty variable product).
export async function deleteWebsiteProductVariationAction(
  catalogId: WebsiteCatalogId,
  productId: string,
  variationId: string
): Promise<void> {
  await requireStockAccess();
  await deleteWebsiteProductVariation(catalogId, productId, variationId);
  revalidatePath("/stock");
}
