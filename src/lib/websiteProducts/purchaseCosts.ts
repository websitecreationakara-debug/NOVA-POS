import { supabaseAdmin } from "@/lib/supabase/server";
import {
  computeSetPricing,
  computeSetTotalCost,
  computeUnitCostForScale,
  productWeightGrams,
} from "@/lib/costControl";
import { catalogForBrandSlug } from "./catalogs";
import { getWebsiteProduct } from "./client";
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

// A product's effective stock cost for Cost Control Sets: when the product
// is itself a Set's listing (Marketing > Cost Control activates a Set as a
// sellable `products` row -- see activateSetListing), that Set's own Total
// Cost (ingredients + Cost/Purchase + Labor, same as the Sets table's Total
// Cost column); otherwise the storefront listing's purchase-cost Total when
// the product is linked to one and that Total is fully entered; otherwise
// the product's own cost_price. Mirrors the "null means unknown" discipline
// elsewhere in this file.
export async function getEffectiveProductCost(productId: string): Promise<number | null> {
  const { data: set } = await supabaseAdmin
    .from("sets")
    .select("target_markup_pct, labor_cost, competitor_base_price, set_items(amount, unit_cost)")
    .eq("linked_product_id", productId)
    .maybeSingle();
  if (set) {
    const setCost = computeSetTotalCost(
      (set.set_items as { amount: number; unit_cost: number | null }[]).map((i) => ({
        amount: i.amount,
        unitCost: i.unit_cost,
      }))
    );
    return computeSetPricing({
      setCost,
      targetMarkupPct: set.target_markup_pct,
      laborCost: set.labor_cost,
      competitorBasePrice: set.competitor_base_price,
    }).totalCost;
  }

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

// getEffectiveProductCost for many products at once -- the same rules, but a
// handful of queries in total instead of up to four PER product (a year of sales
// touches hundreds of products). Keep the two in step: a Set listing's own Total
// Cost, else the storefront listing's purchase-cost Total, else cost_price. A
// product that can't be found comes back null (callers treat the single-product
// version's thrown error the same way).
export async function getEffectiveProductCosts(productIds: string[]): Promise<Map<string, number | null>> {
  const ids = [...new Set(productIds)];
  const out = new Map<string, number | null>(ids.map((id) => [id, null]));
  // In chunks: hundreds of ids in one .in() make the request URL too long.
  const CHUNK = 150;
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));

  type SetRow = {
    linked_product_id: string;
    target_markup_pct: number | null;
    labor_cost: number | null;
    competitor_base_price: number | null;
    set_items: { amount: number; unit_cost: number | null }[];
  };
  const [setPages, productPages, linkPages] = await Promise.all([
    Promise.all(
      chunks.map((c) =>
        supabaseAdmin
          .from("sets")
          .select("linked_product_id, target_markup_pct, labor_cost, competitor_base_price, set_items(amount, unit_cost)")
          .in("linked_product_id", c)
      )
    ),
    Promise.all(chunks.map((c) => supabaseAdmin.from("products").select("id, cost_price").in("id", c))),
    Promise.all(
      chunks.map((c) =>
        supabaseAdmin.from("product_site_links").select("product_id, site, site_product_id, variation_id").in("product_id", c)
      )
    ),
  ]);

  // A product with exactly one linked Set is priced as that Set (two Sets on one
  // product is ambiguous, so it falls through like the single-product version).
  const setsByProduct = new Map<string, SetRow[]>();
  for (const page of setPages) {
    if (page.error) throw page.error;
    for (const row of (page.data ?? []) as unknown as SetRow[]) {
      setsByProduct.set(row.linked_product_id, [...(setsByProduct.get(row.linked_product_id) ?? []), row]);
    }
  }
  const costPrice = new Map<string, number | null>();
  for (const page of productPages) {
    if (page.error) throw page.error;
    for (const p of page.data ?? []) costPrice.set(p.id, p.cost_price);
  }
  const linkByProduct = new Map<string, { site: string; site_product_id: string; variation_id: string }>();
  for (const page of linkPages) {
    if (page.error) throw page.error;
    for (const l of page.data ?? []) if (!linkByProduct.has(l.product_id)) linkByProduct.set(l.product_id, l);
  }

  // Purchase-cost rows for the linked storefront items (one per site + item + variation).
  const spIds = [...new Set([...linkByProduct.values()].map((l) => l.site_product_id))];
  const costRows = new Map<
    string,
    { original_cost: number | null; total_cost_10pct: number | null; extra_money: number | null; total_override: number | null }
  >();
  const costPages = await Promise.all(
    Array.from({ length: Math.ceil(spIds.length / CHUNK) }, (_, i) =>
      supabaseAdmin
        .from("website_product_purchase_costs")
        .select("site, site_product_id, variation_id, original_cost, total_cost_10pct, extra_money, total_override")
        .in("site_product_id", spIds.slice(i * CHUNK, (i + 1) * CHUNK))
    )
  );
  for (const page of costPages) {
    if (page.error) throw page.error;
    for (const r of page.data ?? []) costRows.set(`${r.site}|${r.site_product_id}|${r.variation_id}`, r);
  }

  for (const id of ids) {
    const sets = setsByProduct.get(id) ?? [];
    if (sets.length === 1) {
      const set = sets[0];
      const setCost = computeSetTotalCost(set.set_items.map((i) => ({ amount: i.amount, unitCost: i.unit_cost })));
      out.set(
        id,
        computeSetPricing({
          setCost,
          targetMarkupPct: set.target_markup_pct,
          laborCost: set.labor_cost,
          competitorBasePrice: set.competitor_base_price,
        }).totalCost
      );
      continue;
    }
    if (!costPrice.has(id)) continue; // product not found -> null
    const base = costPrice.get(id) ?? null;
    const link = linkByProduct.get(id);
    const row = link ? costRows.get(`${link.site}|${link.site_product_id}|${link.variation_id}`) : undefined;
    if (!row) {
      out.set(id, base);
      continue;
    }
    const { total } = derivePurchaseCost({
      originalCost: row.original_cost,
      totalCost10pct: row.total_cost_10pct,
      extraMoney: row.extra_money,
      totalOverride: row.total_override,
    });
    out.set(id, total ?? base);
  }
  return out;
}

// What a Set line is priced at, per native pack/unit: the product's Purchase
// Cost in Stock (the average of Original Cost and Total Cost 10%). When a
// product has no Purchase Cost entered, it falls back to its Total (a typed
// Total, or Purchase Cost + Extra Cost), then its own cost_price -- so it
// isn't left blank. A product with no website listing (a manual Set extra:
// Sauce, Fried Garlic, ...) just uses its cost_price. `fromStock` says
// whether the price comes from a Stock listing -- such a line isn't
// hand-editable in the Set builder, since the cost lives in Stock.
export async function getSetItemPricing(
  productId: string
): Promise<{ base: number | null; fromStock: boolean }> {
  const { data: product } = await supabaseAdmin
    .from("products")
    .select("cost_price")
    .eq("id", productId)
    .maybeSingle();
  if (!product) return { base: null, fromStock: false };

  const { data: link } = await supabaseAdmin
    .from("product_site_links")
    .select("site, site_product_id, variation_id")
    .eq("product_id", productId)
    .limit(1)
    .maybeSingle();
  if (!link) return { base: product.cost_price, fromStock: false };

  const { data: costRow } = await supabaseAdmin
    .from("website_product_purchase_costs")
    .select("original_cost, total_cost_10pct, extra_money, total_override")
    .eq("site", link.site)
    .eq("site_product_id", link.site_product_id)
    .eq("variation_id", link.variation_id)
    .maybeSingle();
  const { purchaseCost, total } = derivePurchaseCost({
    originalCost: costRow?.original_cost ?? null,
    totalCost10pct: costRow?.total_cost_10pct ?? null,
    extraMoney: costRow?.extra_money ?? null,
    totalOverride: costRow?.total_override ?? null,
  });
  return { base: purchaseCost ?? total ?? product.cost_price, fromStock: true };
}

// Pushes a product's current Set price (see getSetItemPricing) into every Set
// line item that uses it, so a change to its Purchase Cost in Stock shows up
// in Cost Control's Unit Cost / Line Total immediately -- not just the next
// time someone happens to re-add or re-price that line by hand. Best-effort:
// called after the real change already succeeded, so a hiccup here shouldn't
// fail that.
//
// Each line gets the cost for its own Scale: a pcs/box/... line takes the
// product's cost as-is, but a g/kg line is priced per gram/kilo (the product's
// cost divided by its pack weight) -- writing the whole-pack cost into it
// would multiply the line's cost by the pack weight. A g/kg line whose pack
// weight can't be worked out is left as it was rather than blanked.
export async function syncSetItemCostsForProduct(productId: string): Promise<void> {
  const baseCost = await getSetItemPricing(productId)
    .then((p) => p.base)
    .catch(() => null);

  const { data: lines } = await supabaseAdmin.from("set_items").select("id, unit").eq("product_id", productId);
  if (!lines || lines.length === 0) return;

  const isWeightScale = (unit: string) => ["kg", "g"].includes(unit.trim().toLowerCase());
  const weightGrams =
    baseCost !== null && lines.some((l) => isWeightScale(l.unit)) ? await resolveProductWeightGrams(productId) : null;

  const idsByCost = new Map<number | null, string[]>();
  for (const line of lines) {
    const cost = baseCost === null ? null : computeUnitCostForScale(baseCost, weightGrams, line.unit);
    if (baseCost !== null && cost === null) continue; // weight scale, weight unknown
    const ids = idsByCost.get(cost) ?? [];
    ids.push(line.id);
    idsByCost.set(cost, ids);
  }
  await Promise.all(
    [...idsByCost].map(([cost, ids]) => supabaseAdmin.from("set_items").update({ unit_cost: cost }).in("id", ids))
  );
}

// The product's pack weight the way Cost Control reads it: its own Stock
// weight, a weight in its unit or name, then the weight written on its
// website listing ("250g/pkt"). Best-effort -- a storefront hiccup just means
// the listing's weight isn't used.
async function resolveProductWeightGrams(productId: string): Promise<number | null> {
  const { data: product } = await supabaseAdmin
    .from("products")
    .select("name, unit, weight_grams")
    .eq("id", productId)
    .single();
  if (!product) return null;

  let siteWeightText: string | null = null;
  const { data: link } = await supabaseAdmin
    .from("product_site_links")
    .select("site, site_product_id, variation_id")
    .eq("product_id", productId)
    .limit(1)
    .maybeSingle();
  const catalog = link ? catalogForBrandSlug(link.site) : null;
  if (link && catalog) {
    try {
      const site = await getWebsiteProduct(catalog.id, link.site_product_id);
      siteWeightText = link.variation_id
        ? (site.variations?.find((v) => v.id === link.variation_id)?.weight ?? null)
        : (site.weight ?? null);
    } catch {
      /* fall through without the listing's weight */
    }
  }
  return productWeightGrams(product.unit, product.name, product.weight_grams, siteWeightText);
}

// A cost typed somewhere other than Stock (the Margin Report's Unit Cost, a
// Set line's Unit Cost) also becomes Stock's Total for a product linked to a
// website listing -- Stock's Total is its own store and wins in
// getEffectiveProductCost, so without this the typed cost would show up
// everywhere except Stock.
export async function writeCostToStockTotal(productId: string, cost: number | null): Promise<void> {
  const { data: link } = await supabaseAdmin
    .from("product_site_links")
    .select("site, site_product_id, variation_id")
    .eq("product_id", productId)
    .limit(1)
    .maybeSingle();
  if (link) await setWebsitePurchaseCost(link.site, link.site_product_id, link.variation_id, { total_override: cost });
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
