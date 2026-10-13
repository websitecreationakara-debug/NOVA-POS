import { supabaseAdmin } from "@/lib/supabase/server";
import { configuredCatalogs, getCatalog } from "./catalogs";
import {
  createWebsiteCategory,
  createWebsiteProduct,
  deleteWebsiteProduct,
  getWebsiteProduct,
  listWebsiteCategories,
} from "./client";
import type { WebsiteCatalogId, WebsiteCategory, WebsiteProductVariation, WebsiteProductWrite } from "./types";
import type { ProductSiteLink } from "@/types/database";

export type MoveProductResult = { newId: string; warnings: string[] };

// Only BOSBA Drink & Snack stores a second "flavor" axis on a size; the others
// have just the one label, so flavor is folded into it when moving there.
const FLAVOR_CATALOG: WebsiteCatalogId = "bosba_drink_snack";

type DestVariation = { weight: string; flavor: string | null };

function destVariation(to: WebsiteCatalogId, v: WebsiteProductVariation, index: number): DestVariation {
  const weight = v.weight?.trim() ?? "";
  const flavor = v.flavor?.trim() ?? "";
  if (to === FLAVOR_CATALOG) {
    return weight ? { weight, flavor: flavor || null } : { weight: flavor || `Option ${index + 1}`, flavor: null };
  }
  return { weight: [weight, flavor].filter(Boolean).join(" · ") || `Option ${index + 1}`, flavor: null };
}

const variationKey = (v: DestVariation) => `${v.weight}|${v.flavor ?? ""}`;

// A storefront's categories -- its live list, or the hardcoded label list when
// the categories endpoint isn't deployed.
async function categoriesOf(catalogId: WebsiteCatalogId): Promise<WebsiteCategory[]> {
  const live = await listWebsiteCategories(catalogId).catch(() => []);
  if (live.length > 0) return live;
  return (getCatalog(catalogId).categories ?? []).map((c) => ({
    id: c.id,
    name: c.label,
    slug: "",
    parent_id: null,
    image_url: null,
  }));
}

// The destination category with the same name as the source product's (its
// parent too), created on the destination when it doesn't have one yet. null
// when the product has no category or the destination can't take a new one.
async function mapCategory(
  from: WebsiteCatalogId,
  to: WebsiteCatalogId,
  categoryId: string | null,
  warnings: string[]
): Promise<string | null> {
  if (!categoryId) return null;
  const [fromCats, toCats] = await Promise.all([categoriesOf(from), categoriesOf(to)]);
  const byId = new Map(fromCats.map((c) => [c.id, c]));
  const norm = (s: string) => s.trim().toLowerCase();

  async function mapOne(id: string, depth: number): Promise<string | null> {
    const cat = byId.get(id);
    if (!cat) return null;
    const existing = toCats.find((c) => norm(c.name) === norm(cat.name));
    if (existing) return existing.id;
    const parentId = cat.parent_id && depth < 3 ? await mapOne(cat.parent_id, depth + 1) : null;
    try {
      const created = await createWebsiteCategory(to, { name: cat.name, parent_id: parentId });
      toCats.push(created);
      return created.id;
    } catch {
      return null;
    }
  }

  const mapped = await mapOne(categoryId, 0);
  if (!mapped) {
    warnings.push("The category couldn't be matched on the other website, so the product has no category there yet.");
  }
  return mapped;
}

function imageUrls(images: unknown[] | undefined): string[] {
  return (images ?? []).flatMap((i) => {
    if (typeof i === "string") return [i];
    const url = (i as { url?: unknown } | null)?.url;
    return typeof url === "string" ? [url] : [];
  });
}

// Moves a product (with all its sizes) from one business's website to another's:
// recreates it on the destination, re-points everything POS keeps about it (the
// POS products, their site links, purchase costs) to the new site ids and
// business, then removes it from the source website. Nothing is deleted from the
// source until the destination copy and the POS re-pointing have succeeded.
export async function moveWebsiteProduct(input: {
  from: WebsiteCatalogId;
  to: WebsiteCatalogId;
  productId: string;
}): Promise<MoveProductResult> {
  const { from, to, productId } = input;
  if (from === to) throw new Error("Pick a different business to move it to.");
  const configured = new Set(configuredCatalogs().map((c) => c.id));
  if (!configured.has(from) || !configured.has(to)) {
    throw new Error("Both businesses' websites need to be connected to move a product.");
  }
  const warnings: string[] = [];

  const src = await getWebsiteProduct(from, productId);
  if (Array.isArray(src.tabs) && src.tabs.length > 0) {
    throw new Error(
      `“${src.title}” has ${src.tabs.length} info tab(s) the other website can't store, so moving it would lose them. Remove the tabs first, or leave it where it is.`
    );
  }

  const sizes = src.variations ?? [];
  const destSizes = sizes.map((v, i) => destVariation(to, v, i));
  const categoryId = await mapCategory(from, to, src.category_id, warnings);

  const write: WebsiteProductWrite = {
    title: src.title,
    description: src.description,
    price: src.price,
    sale_price: src.sale_price,
    category_id: categoryId,
    stock: src.stock,
    status: src.status,
    image_url: src.image_url,
    badge: src.badge,
    rating: src.rating,
    weight: src.weight,
    taste_notes: src.taste_notes ?? null,
    pcs: src.pcs,
    type: sizes.length > 0 ? "variable" : "simple",
    featured: src.featured,
    pre_order: src.pre_order ?? false,
    video_url: src.video_url,
    images: imageUrls(src.images),
    variations: sizes.map((v, i) => ({
      ...destSizes[i],
      price: v.price,
      sale_price: v.sale_price,
      image_url: v.image_url,
      stock: v.stock,
      pcs: v.pcs,
    })),
  };
  const created = await createWebsiteProduct(to, write);
  const dst = await getWebsiteProduct(to, created.id);

  // Which new size each old size became (matched on its label; same-label sizes
  // are paired in order).
  const queues = new Map<string, string[]>();
  for (const v of dst.variations ?? []) {
    const key = variationKey({ weight: v.weight?.trim() ?? "", flavor: v.flavor?.trim() || null });
    queues.set(key, [...(queues.get(key) ?? []), v.id]);
  }
  const sizeMap = new Map<string, string>();
  sizes.forEach((v, i) => {
    const next = queues.get(variationKey(destSizes[i]))?.shift();
    if (next) sizeMap.set(v.id, next);
  });
  if (sizeMap.size < sizes.length) {
    await deleteWebsiteProduct(to, created.id).catch(() => undefined);
    throw new Error(
      "The other website didn't keep all the sizes, so nothing was moved. (Its website may not be updated yet to accept sizes when a product is created.)"
    );
  }

  try {
    await repointPos(from, to, src.id, dst.id, sizeMap, warnings);
  } catch (e) {
    await deleteWebsiteProduct(to, created.id).catch(() => undefined);
    throw e;
  }

  try {
    await deleteWebsiteProduct(from, src.id);
  } catch (e) {
    warnings.push(
      `It's on the new website, but removing it from the old one failed (${e instanceof Error ? e.message : "unknown error"}) -- delete it there by hand.`
    );
  }
  return { newId: dst.id, warnings };
}

async function repointPos(
  from: WebsiteCatalogId,
  to: WebsiteCatalogId,
  oldId: string,
  newId: string,
  sizeMap: Map<string, string>,
  warnings: string[]
): Promise<void> {
  const fromSite = getCatalog(from).brandSlug as ProductSiteLink["site"];
  const toSite = getCatalog(to).brandSlug as ProductSiteLink["site"];

  const { data: brand, error: brandErr } = await supabaseAdmin
    .from("brands")
    .select("id")
    .eq("slug", toSite)
    .single();
  if (brandErr || !brand) throw new Error("No POS business found for the destination website.");

  const { data: links, error: linksErr } = await supabaseAdmin
    .from("product_site_links")
    .select("id, product_id, variation_id")
    .eq("site", fromSite)
    .eq("site_product_id", oldId);
  if (linksErr) throw new Error(linksErr.message);
  const moving = (links ?? []).flatMap((l) => {
    const variationId = l.variation_id === "" ? "" : (sizeMap.get(l.variation_id) ?? null);
    return variationId === null ? [] : [{ ...l, newVariationId: variationId }];
  });
  if ((links ?? []).length > moving.length) {
    warnings.push("Some POS items linked to sizes that no longer exist were left as they were.");
  }
  const movingProductIds = new Set(moving.map((l) => l.product_id));

  // The destination website tells POS about a brand-new simple product, which
  // makes a second POS product + link for it. Drop that one: the existing POS
  // product (with its history, costs and sets) takes the link instead.
  const { data: autoLinks } = await supabaseAdmin
    .from("product_site_links")
    .select("id, product_id")
    .eq("site", toSite)
    .eq("site_product_id", newId);
  for (const auto of autoLinks ?? []) {
    if (movingProductIds.has(auto.product_id)) continue;
    await supabaseAdmin.from("product_site_links").delete().eq("id", auto.id);
    const { error } = await supabaseAdmin.from("products").delete().eq("id", auto.product_id);
    if (error) await supabaseAdmin.from("products").update({ is_active: false }).eq("id", auto.product_id);
  }

  for (const l of moving) {
    const { error } = await supabaseAdmin
      .from("product_site_links")
      .update({ site: toSite, site_product_id: newId, variation_id: l.newVariationId })
      .eq("id", l.id);
    if (error) throw new Error(error.message);
  }

  // The POS products now belong to the destination business. Their POS
  // category is the old business's, so it's cleared; a SKU the new business
  // already uses is dropped (it's unique per business).
  for (const productId of movingProductIds) {
    const patch = { brand_id: brand.id, category_id: null };
    const { error } = await supabaseAdmin.from("products").update(patch).eq("id", productId);
    if (error) {
      const retry = await supabaseAdmin.from("products").update({ ...patch, sku: null }).eq("id", productId);
      if (retry.error) throw new Error(retry.error.message);
    }
  }

  const { data: costs, error: costsErr } = await supabaseAdmin
    .from("website_product_purchase_costs")
    .select("id, variation_id")
    .eq("site", fromSite)
    .eq("site_product_id", oldId);
  if (costsErr) throw new Error(costsErr.message);
  for (const c of costs ?? []) {
    const variationId = c.variation_id === "" ? "" : sizeMap.get(c.variation_id);
    if (variationId === undefined) continue;
    const { error } = await supabaseAdmin
      .from("website_product_purchase_costs")
      .update({ site: toSite, site_product_id: newId, variation_id: variationId })
      .eq("id", c.id);
    if (error) throw new Error(error.message);
  }
}
