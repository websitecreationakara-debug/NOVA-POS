import type { WebsiteProductVariation } from "./types";

// BOSBA Drink & Snack doesn't keep one stock per product: two variations share a count only when
// they have the same flavor AND (for liquid sizes, i.e. ml/L) the same size -- "Lemon 6 cans" and
// "Lemon 12 cans" are one pool, but Lemon vs Muscat, or a 1.8L vs a 720ml bottle, each count apart.
// Mirrors stockGroupKey in the BOSBA-Drink-Snack repo (src/lib/commerce/variants.ts); change both
// together.
type StockVariation = Pick<WebsiteProductVariation, "flavor" | "weight">;

const isVolume = (weight: string) => /\d(ml|cl|l|lt|ltr|liter|litre)$/i.test(weight.replace(/\s+/g, ""));

export function stockGroupKey(v: StockVariation): string {
  const weight = v.weight ?? "";
  const size = weight.replace(/\s+/g, "").toLowerCase();
  return `${(v.flavor ?? "").trim().toLowerCase()}|${isVolume(weight) ? size : ""}`;
}

// The variations of a product that draw from the same count as `variation` (itself included).
export function stockGroupMembers<V extends StockVariation>(variations: V[], variation: StockVariation): V[] {
  const key = stockGroupKey(variation);
  return variations.filter((v) => stockGroupKey(v) === key);
}
