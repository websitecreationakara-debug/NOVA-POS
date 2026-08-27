import { supabaseAdmin } from "@/lib/supabase/server";

// POS is the source of truth for stock on the ~28 products that also exist on a
// live storefront (see product_site_links, Phase 7). This pushes a stock change
// out to the matching site so both sides agree, without blocking the caller if
// the site is briefly unreachable.
const SITE_BASE_URL: Record<string, string> = {
  "bosba-premium-foods": "https://bosbapremiumfoods.com",
  "bosba-drink-snack": "https://bosbadrinksnack.com",
  "sora-sake": "https://sorasake.wine",
};

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
