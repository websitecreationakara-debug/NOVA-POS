import { DEFAULT_BRAND_SLUG, getBrands, getCatalogForBrand, getCatalogForBrandSlug } from "@/lib/supabase/queries";
import SalesClient from "./SalesClient";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; q?: string }>;
}) {
  const { brand: brandIdParam, q } = await searchParams;

  // Start the (expensive, catalogs run into the hundreds of products) catalog
  // fetch immediately instead of waiting for getBrands() to resolve first --
  // that serial wait was doubling the round trip on every navigation. If
  // ?brand= is set (switching brands), fetch straight by id; otherwise (e.g.
  // clicking Sales/Stock in the sidebar, which carries no ?brand=) fetch by
  // the known default brand's slug so it doesn't need getBrands() to resolve
  // an id first. Either way, only falls back to a second fetch below if the
  // guess turns out to be wrong/stale.
  const brandsPromise = getBrands();
  const optimisticCatalogPromise = brandIdParam
    ? getCatalogForBrand(brandIdParam)
    : getCatalogForBrandSlug(DEFAULT_BRAND_SLUG);

  const brands = await brandsPromise;

  if (brands.length === 0) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Sales</h1>
        <p className="mt-2 text-zinc-500">No brands configured yet.</p>
      </main>
    );
  }

  const currentBrand = brandIdParam
    ? (brands.find((b) => b.id === brandIdParam) ?? brands[0])
    : (brands.find((b) => b.slug === DEFAULT_BRAND_SLUG) ?? brands[0]);
  const optimisticIsValid = brandIdParam
    ? currentBrand.id === brandIdParam
    : currentBrand.slug === DEFAULT_BRAND_SLUG;
  const { categories, products } = optimisticIsValid
    ? await optimisticCatalogPromise
    : await getCatalogForBrand(currentBrand.id);

  return (
    <SalesClient
      key={q ?? ""}
      brands={brands}
      currentBrand={currentBrand}
      categories={categories}
      products={products}
      initialSearch={q ?? ""}
    />
  );
}
