import { supabaseAdmin } from "@/lib/supabase/server";
import { catalogForBrandSlug } from "@/lib/websiteProducts/catalogs";
import { updateWebsiteProductVariation } from "@/lib/websiteProducts/client";
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

const SITE_LABEL: Record<ProductSiteLink["site"], string> = {
  "bosba-premium-foods": "BOSBA Premium Foods",
  "bosba-drink-snack": "BOSBA Drink & Snack",
  "sora-sake": "sorasake.wine",
};

export type StockSyncFailure = { site: ProductSiteLink["site"]; label: string; reason: string };

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
      // This manual Stock-page link flow only ever offers simple (non-
      // variable) candidates -- see the "variable" guard in StockClient's
      // applyLink -- so this is always the simple-product row.
      variation_id: "",
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

export async function pushStockToSites(productIds: string[]): Promise<StockSyncFailure[]> {
  if (productIds.length === 0) return [];

  const { data: links, error } = await supabaseAdmin
    .from("product_site_links")
    .select("product_id, site, site_product_id, variation_id")
    .in("product_id", productIds);
  if (error || !links || links.length === 0) return [];

  const { data: stockRows } = await supabaseAdmin
    .from("stock_levels")
    .select("product_id, quantity")
    .in(
      "product_id",
      links.map((l) => l.product_id)
    );
  const stockByProduct = new Map((stockRows ?? []).map((r) => [r.product_id, r.quantity]));

  // A "variable" site product keeps its real stock on the variation row, not a
  // single field on the parent -- so one size of it is pushed through the
  // catalog's own PATCH .../:id/variations/:variationId endpoint (same call the
  // Stock page uses), reached with that catalog's API key. The flat
  // /api/stock-sync hook the simple products use can't reach a variation, so a
  // sale of a size-variant product (most of BOSBA Premium Foods and
  // sorasake.wine) used to leave the storefront's displayed stock untouched.
  const variationLinks = links.filter((l) => l.variation_id);
  const simpleLinks = links.filter((l) => !l.variation_id);

  const variationResults = await Promise.all(
    variationLinks.map(async (link): Promise<StockSyncFailure | null> => {
      const stock = stockByProduct.get(link.product_id);
      if (stock === undefined) return null;
      const catalog = catalogForBrandSlug(link.site);
      if (!catalog) {
        console.error(
          `no configured storefront catalog for ${link.site} -- skipping variation stock push`
        );
        return {
          site: link.site,
          label: SITE_LABEL[link.site],
          reason: "storefront catalog API is not configured",
        };
      }
      try {
        await updateWebsiteProductVariation(
          catalog.id,
          link.site_product_id,
          link.variation_id,
          { stock: Math.max(0, stock) }
        );
        return null;
      } catch (e) {
        console.error(
          `variation stock push failed for ${link.site} product ${link.site_product_id} ` +
            `variation ${link.variation_id}`,
          e
        );
        return {
          site: link.site,
          label: SITE_LABEL[link.site],
          reason: e instanceof Error ? e.message : "network error",
        };
      }
    })
  );

  const simpleResults = await pushSimpleLinkStock(simpleLinks, stockByProduct);

  return [...variationResults, ...simpleResults].filter(
    (r): r is StockSyncFailure => r !== null
  );
}

async function pushSimpleLinkStock(
  links: { product_id: string; site: ProductSiteLink["site"]; site_product_id: string }[],
  stockByProduct: Map<string, number>
): Promise<(StockSyncFailure | null)[]> {
  if (links.length === 0) return [];

  const secret = process.env.STOCK_SYNC_SECRET;
  if (!secret) {
    // Without this, every push below is a silent no-op -- the POS's own
    // stock_levels row is still correct, but the storefront never hears
    // about it, with nothing in the logs to explain why.
    console.error(
      "STOCK_SYNC_SECRET is not set -- skipping stock push to",
      [...new Set(links.map((l) => l.site))].join(", ")
    );
    return [...new Set(links.map((l) => l.site))].map((site) => ({
      site,
      label: SITE_LABEL[site],
      reason: "STOCK_SYNC_SECRET is not configured",
    }));
  }

  return Promise.all(
    links.map(async (link): Promise<StockSyncFailure | null> => {
      const baseUrl = SITE_BASE_URL[link.site];
      const stock = stockByProduct.get(link.product_id);
      if (!baseUrl || stock === undefined) return null;
      try {
        const res = await fetch(`${baseUrl}/api/stock-sync`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${secret}`,
          },
          body: JSON.stringify({ productId: link.site_product_id, stock: Math.max(0, stock) }),
          signal: AbortSignal.timeout(8000),
        });
        // fetch() only rejects on network failure -- a 4xx/5xx response
        // still resolves "successfully" and was previously ignored here,
        // so a rejected/broken sync looked identical to a working one.
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.error(
            `stock-sync push rejected by ${link.site} for product ${link.site_product_id} ` +
              `(HTTP ${res.status}): ${body.slice(0, 300)}`
          );
          return { site: link.site, label: SITE_LABEL[link.site], reason: `HTTP ${res.status}` };
        }
        return null;
      } catch (e) {
        console.error(`stock-sync push failed for ${link.site} product ${link.site_product_id}`, e);
        return {
          site: link.site,
          label: SITE_LABEL[link.site],
          reason: e instanceof Error ? e.message : "network error",
        };
      }
    })
  );
}
