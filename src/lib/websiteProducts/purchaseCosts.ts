import { supabaseAdmin } from "@/lib/supabase/server";
import type { ProductSiteLink } from "@/types/database";

// Manually-entered purchase-cost inputs for one storefront item -- see
// migration 0027 (website_product_purchase_costs) and 0032
// (total_override). Purchase Cost is always derived (see
// derivePurchaseCost); Total is derived too unless totalOverride is set --
// some products never get an Original Cost / Total Cost 10%, so Total needs
// to be enterable on its own.
export type PurchaseCostFields = {
  originalCost: number | null;
  totalCost10pct: number | null;
  extraMoney: number | null;
  totalOverride: number | null;
};

export const EMPTY_PURCHASE_COSTS: PurchaseCostFields = {
  originalCost: null,
  totalCost10pct: null,
  extraMoney: null,
  totalOverride: null,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Purchase Cost = average of Original Cost and Total Cost 10% (both manual
// inputs); Total = Purchase Cost + Extra Money, unless totalOverride is set,
// in which case it wins outright -- lets Total be entered even when Original
// Cost / Total Cost 10% never get filled in for a product. Null (not 0) the
// moment an input it depends on is missing, so an incomplete row reads as
// "not entered yet" rather than a wrong number.
export function derivePurchaseCost(f: PurchaseCostFields): {
  purchaseCost: number | null;
  total: number | null;
} {
  const { originalCost, totalCost10pct, extraMoney, totalOverride } = f;
  const purchaseCost =
    originalCost === null || totalCost10pct === null ? null : round2((originalCost + totalCost10pct) / 2);
  const derivedTotal =
    purchaseCost === null ? null : extraMoney === null ? purchaseCost : round2(purchaseCost + extraMoney);
  const total = totalOverride ?? derivedTotal;
  return { purchaseCost, total };
}

// Same composite key shape as posEntryKey in WebsiteProductsPanel/SalesClient
// ("" variationId for a simple product) -- kept independent since this module
// has no reason to import a client component.
export function purchaseCostKey(siteProductId: string, variationId: string): string {
  return `${siteProductId}::${variationId}`;
}

export async function getWebsitePurchaseCosts(
  site: ProductSiteLink["site"]
): Promise<Record<string, PurchaseCostFields>> {
  const { data, error } = await supabaseAdmin
    .from("website_product_purchase_costs")
    .select("site_product_id, variation_id, original_cost, total_cost_10pct, extra_money, total_override")
    .eq("site", site);
  if (error) throw error;

  const out: Record<string, PurchaseCostFields> = {};
  for (const row of data ?? []) {
    out[purchaseCostKey(row.site_product_id, row.variation_id)] = {
      originalCost: row.original_cost,
      totalCost10pct: row.total_cost_10pct,
      extraMoney: row.extra_money,
      totalOverride: row.total_override,
    };
  }
  return out;
}

// A product's effective stock cost for Cost Control Sets: the storefront
// listing's purchase-cost Total when the product is linked to one and that
// Total is fully entered, otherwise the product's own cost_price. Mirrors
// the "null means unknown" discipline elsewhere in this file.
export async function getEffectiveProductCost(productId: string): Promise<number | null> {
  const { data: product, error: productErr } = await supabaseAdmin
    .from("products")
    .select("cost_price")
    .eq("id", productId)
    .single();
  if (productErr || !product) throw productErr ?? new Error("Product not found");

  const { data: link } = await supabaseAdmin
    .from("product_site_links")
    .select("site, site_product_id, variation_id")
    .eq("product_id", productId)
    .limit(1)
    .maybeSingle();
  if (!link) return product.cost_price;

  const { data: costRow } = await supabaseAdmin
    .from("website_product_purchase_costs")
    .select("original_cost, total_cost_10pct, extra_money, total_override")
    .eq("site", link.site)
    .eq("site_product_id", link.site_product_id)
    .eq("variation_id", link.variation_id)
    .maybeSingle();
  if (!costRow) return product.cost_price;

  const { total } = derivePurchaseCost({
    originalCost: costRow.original_cost,
    totalCost10pct: costRow.total_cost_10pct,
    extraMoney: costRow.extra_money,
    totalOverride: costRow.total_override,
  });
  return total ?? product.cost_price;
}

// Upserts only the fields provided -- e.g. `{ original_cost: 5 }` leaves an
// existing row's total_cost_10pct/extra_money/total_override untouched
// (PostgREST's upsert only SETs the columns present in the payload on
// conflict).
export async function setWebsitePurchaseCost(
  site: ProductSiteLink["site"],
  siteProductId: string,
  variationId: string,
  fields: Partial<{
    original_cost: number | null;
    total_cost_10pct: number | null;
    extra_money: number | null;
    total_override: number | null;
  }>
): Promise<void> {
  const { error } = await supabaseAdmin.from("website_product_purchase_costs").upsert(
    {
      site,
      site_product_id: siteProductId,
      variation_id: variationId,
      ...fields,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "site,site_product_id,variation_id" }
  );
  if (error) throw error;
}
