"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCatalog } from "@/lib/websiteProducts/catalogs";
import type { WebsiteCatalogId } from "@/lib/websiteProducts/types";
import type { ProductSiteLink } from "@/types/database";

export type LinkedPosProduct = {
  id: string;
  name: string;
  price: number;
  unit: string;
};

type EmbeddedProduct = {
  id: string;
  name: string;
  price: number;
  unit: string;
  is_active: boolean;
};

function toLinked(p: EmbeddedProduct): LinkedPosProduct {
  return { id: p.id, name: p.name, price: p.price, unit: p.unit };
}

async function findExistingLink(
  site: ProductSiteLink["site"],
  siteProductId: string
): Promise<EmbeddedProduct | null> {
  const { data } = await supabaseAdmin
    .from("product_site_links")
    .select("products(id, name, price, unit, is_active)")
    .eq("site", site)
    .eq("site_product_id", siteProductId)
    .maybeSingle();
  return (data?.products as unknown as EmbeddedProduct | undefined) ?? null;
}

// Tapping a website product on the Sales > Website tab that isn't linked to a
// POS product yet: create the POS product (in the storefront's brand), seed its
// stock from the site's current count, and record the product_site_links row --
// the same result as linking by hand in Stock. Idempotent: a repeat tap (or a
// concurrent cashier) returns the product that already got linked.
export async function ensurePosProductForSiteProduct(input: {
  catalogId: WebsiteCatalogId;
  siteProductId: string;
  title: string;
  price: number;
  imageUrl: string | null;
  stock: number | null;
}): Promise<LinkedPosProduct> {
  const { catalogId, siteProductId, title, price, imageUrl, stock } = input;
  const catalog = getCatalog(catalogId);
  const site = catalog.brandSlug as ProductSiteLink["site"];

  const existing = await findExistingLink(site, siteProductId);
  if (existing) {
    if (!existing.is_active) {
      await supabaseAdmin.from("products").update({ is_active: true }).eq("id", existing.id);
    }
    return toLinked(existing);
  }

  const { data: brand, error: brandErr } = await supabaseAdmin
    .from("brands")
    .select("id")
    .eq("slug", catalog.brandSlug)
    .single();
  if (brandErr || !brand) throw brandErr ?? new Error(`No brand for catalog ${catalogId}`);

  const name = title.trim() || "Untitled website product";
  const { data: created, error: createErr } = await supabaseAdmin
    .from("products")
    .insert({
      brand_id: brand.id,
      category_id: null,
      name,
      sku: null,
      price: Number.isFinite(price) && price >= 0 ? price : 0,
      unit: "pcs",
      image_url: imageUrl,
      is_active: true,
    })
    .select("id, name, price, unit")
    .single();
  if (createErr || !created) throw createErr ?? new Error("Failed to create product");

  // The products insert trigger seeds stock_levels at 0; set the site's real
  // count if we have one.
  if (stock != null) {
    await supabaseAdmin
      .from("stock_levels")
      .update({ quantity: Math.max(0, stock), updated_at: new Date().toISOString() })
      .eq("product_id", created.id);
  }

  const { error: linkErr } = await supabaseAdmin.from("product_site_links").insert({
    product_id: created.id,
    site,
    site_product_id: siteProductId,
    matched_name: name,
    match_confidence: "exact",
  });

  if (linkErr) {
    // Another cashier linked the same site product between our check and this
    // insert (unique (site, site_product_id)). Park the row we just made and
    // hand back the one that won the race.
    await supabaseAdmin.from("products").update({ is_active: false }).eq("id", created.id);
    const raced = await findExistingLink(site, siteProductId);
    if (raced) return toLinked(raced);
    throw linkErr;
  }

  revalidatePath("/stock");
  revalidatePath("/sales");
  return { id: created.id, name: created.name, price: created.price, unit: created.unit };
}
