import type { WebsiteProduct } from "./types";

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
