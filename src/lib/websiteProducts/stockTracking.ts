import type { WebsiteProduct } from "./types";

// A website product (or one size of it) whose stock is blank ("—") isn't
// tracked: it's unlimited. Pushing POS's count to it would turn that into a
// number -- typically 0, since the POS count of an untracked product never goes
// up -- and the storefront would show it as sold out.
export function isStockUntracked(product: WebsiteProduct, variationId: string): boolean {
  if (variationId) {
    const variation = product.variations?.find((v) => v.id === variationId);
    return !!variation && (variation.stock === null || variation.stock === undefined);
  }
  return product.stock === null || product.stock === undefined;
}
