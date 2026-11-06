import { canPackSize } from "./stockUnits";
import { stockGroupMembers } from "./stockGroups";
import type { WebsiteCatalogId, WebsiteProduct, WebsiteProductVariation } from "./types";

// BOSBA Drink & Snack shares one stock count between the variations of a stock group (same flavor /
// ml-L size, see stockGroups.ts); the other catalogs keep stock on each variation.
export const SHARED_VARIATION_STOCK_CATALOG: WebsiteCatalogId = "bosba_drink_snack";

// The Sales entry keys of every variation that draws from the same stock count as this one (itself
// included): its stock group on a shared-stock catalog, else just itself.
export function stockGroupEntryKeys(
  catalogId: WebsiteCatalogId,
  product: WebsiteProduct,
  variation: WebsiteProductVariation | null
): string[] {
  if (!variation) return [product.id];
  if (catalogId !== SHARED_VARIATION_STOCK_CATALOG) return [`${product.id}::${variation.id}`];
  return stockGroupMembers(product.variations ?? [], variation).map((m) => `${product.id}::${m.id}`);
}

// How many units are in the Order against that count: selling one 24can leaves one fewer of the 6can
// of the same flavor too, so the cards of a stock group always show the same remaining count.
export function cartQtyForKeys(cartQtyByEntryKey: Map<string, number>, keys: string[]): number {
  let total = 0;
  for (const key of keys) total += cartQtyByEntryKey.get(key) ?? 0;
  return total;
}

// The stock of every *sellable* unit in a storefront catalog: one number per
// simple product, and one per size/flavour of a "variable" product (whose own
// parent-level stock is always 0/null). This is what the Stock page's rows --
// and its "Low stock" / "Out of stock" filters -- count, so dashboard stats
// derived from the same list stay in agreement with it.
export function sellableStocks(products: WebsiteProduct[]): (number | null)[] {
  const out: (number | null)[] = [];
  for (const p of products) {
    const isVariable = p.type === "variable" || p.type === "variant";
    if (isVariable && p.variations && p.variations.length > 0) {
      for (const v of p.variations) out.push(v.stock);
    } else {
      out.push(p.stock);
    }
  }
  return out;
}

// A unit is "low" when it has a tracked count of 1-5. `null` (untracked) and 0
// are not low -- 0 is out of stock, untracked is neither.
export function countLowStock(products: WebsiteProduct[]): number {
  return sellableStocks(products).filter((s) => s != null && s > 0 && s <= 5).length;
}

// How many stock units selling one of this entry takes: a can pack of a shared-stock catalog takes
// its can count ("24can" -> 24), everything else takes 1. Matches products.stock_units_per_sale.
export function sellUnits(catalogId: WebsiteCatalogId, variation: WebsiteProductVariation | null): number {
  return catalogId === SHARED_VARIATION_STOCK_CATALOG && variation ? canPackSize(variation.weight) : 1;
}
