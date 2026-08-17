import { getBrands, getCatalogForBrand } from "@/lib/supabase/queries";
import SalesClient from "./SalesClient";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; q?: string }>;
}) {
  const { brand: brandIdParam, q } = await searchParams;

  // Switching brands always sets ?brand=<a valid id already in the list>,
  // so start the (expensive, catalogs run into the hundreds of products)
  // catalog fetch immediately instead of waiting for getBrands() to
  // resolve first -- that serial wait was doubling the round trip on
  // every brand switch. Only falls back to a second fetch below if the
  // id turns out to be missing/stale.
  const brandsPromise = getBrands();
  const optimisticCatalogPromise = brandIdParam ? getCatalogForBrand(brandIdParam) : null;

  const brands = await brandsPromise;

  if (brands.length === 0) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Sales</h1>
        <p className="mt-2 text-zinc-500">No brands configured yet.</p>
      </main>
    );
  }

  const currentBrand = brands.find((b) => b.id === brandIdParam) ?? brands[0];
  const { categories, products } =
    optimisticCatalogPromise && currentBrand.id === brandIdParam
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
