import { supabaseAdmin } from "@/lib/supabase/server";
import type { ProductSiteLink } from "@/types/database";

// POS is the source of truth for stock on the ~28 products that also exist on a
// live storefront (see product_site_links, Phase 7). This pushes a stock change
// out to the matching site so both sides agree, without blocking the caller if
// the site is briefly unreachable.
export const SITE_BASE_URL: Record<ProductSiteLink["site"], string> = {
  "bosba-premium-foods": "https://bosbapremiumfoods.com",
  "bosba-drink-snack": "https://bosbadrinksnack.com",
  "sora-sake": "https://sorasake.wine",
};

export type SiteProductCandidate = {
  id: string;
  title: string;
  stock: number | null;
  type: string;
};

// Search a linked site's real catalog by name -- used when linking a POS
// product to its website counterpart, so staff pick from real results
// instead of needing to know/guess the site's internal product id.
export async function searchSiteProducts(
  site: ProductSiteLink["site"],
  query: string
): Promise<SiteProductCandidate[]> {
  const secret = process.env.STOCK_SYNC_SECRET;
  const baseUrl = SITE_BASE_URL[site];
  if (!secret || !baseUrl || !query.trim()) return [];

  try {
    const res = await fetch(`${baseUrl}/api/product-search?q=${encodeURIComponent(query.trim())}`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: SiteProductCandidate[] };
    return data.results ?? [];
  } catch (e) {
    console.error(`product-search failed against ${site}`, e);
    return [];
  }
}

// Links a POS product to a specific product on one of the storefronts and
// immediately backfills POS's stock with the site's real current count --
// otherwise the link would sit at whatever stale number POS already had.
export async function linkProductToSite(
  productId: string,
  site: ProductSiteLink["site"],
  siteProductId: string,
  matchedName: string,
  siteStock: number | null
): Promise<void> {
  const { error } = await supabaseAdmin.from("product_site_links").upsert(
    {
      product_id: productId,
      site,
      site_product_id: siteProductId,
      matched_name: matchedName,
      match_confidence: "exact",
    },
    { onConflict: "product_id,site" }
  );
  if (error) throw error;

  if (siteStock != null) {
    const { error: stockError } = await supabaseAdmin
      .from("stock_levels")
      .update({ quantity: Math.max(0, siteStock), updated_at: new Date().toISOString() })
      .eq("product_id", productId);
    if (stockError) throw stockError;
  }
}

export async function pushStockToSites(productIds: string[]): Promise<void> {
  if (productIds.length === 0) return;

  const { data: links, error } = await supabaseAdmin
    .from("product_site_links")
    .select("product_id, site, site_product_id")
    .in("product_id", productIds);
  if (error || !links || links.length === 0) return;

  const { data: stockRows } = await supabaseAdmin
    .from("stock_levels")
    .select("product_id, quantity")
    .in(
      "product_id",
      links.map((l) => l.product_id)
    );
  const stockByProduct = new Map((stockRows ?? []).map((r) => [r.product_id, r.quantity]));

  const secret = process.env.STOCK_SYNC_SECRET;
  if (!secret) return;

  await Promise.all(
    links.map(async (link) => {
      const baseUrl = SITE_BASE_URL[link.site];
      const stock = stockByProduct.get(link.product_id);
      if (!baseUrl || stock === undefined) return;
      try {
        await fetch(`${baseUrl}/api/stock-sync`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${secret}`,
          },
          body: JSON.stringify({ productId: link.site_product_id, stock: Math.max(0, stock) }),
          signal: AbortSignal.timeout(8000),
        });
      } catch (e) {
        console.error(`stock-sync push failed for ${link.site} product ${link.site_product_id}`, e);
      }
    })
  );
}
