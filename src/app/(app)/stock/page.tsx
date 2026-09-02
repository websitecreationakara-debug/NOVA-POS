import { getBrands, getCatalogForBrand } from "@/lib/supabase/queries";
import { catalogForBrandSlug } from "@/lib/websiteProducts/catalogs";
import { listWebsiteProducts } from "@/lib/websiteProducts/client";
import type { WebsiteCatalogId, WebsiteProduct } from "@/lib/websiteProducts/types";
import StockClient from "./StockClient";

export type WebsiteCatalogData = {
  id: WebsiteCatalogId;
  label: string;
  products: WebsiteProduct[] | null;
  error: string | null;
};

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const { brand: brandIdParam } = await searchParams;

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
        <h1 className="text-2xl font-semibold">Stock</h1>
        <p className="mt-2 text-zinc-500">No brands configured yet.</p>
      </main>
    );
  }

  const currentBrand = brands.find((b) => b.id === brandIdParam) ?? brands[0];

  // The Website tab follows the selected brand: show only that brand's
  // storefront catalog (or nothing, if the brand has no storefront wired up).
  const catalog = catalogForBrandSlug(currentBrand.slug);
  const websiteCatalogPromise: Promise<WebsiteCatalogData | null> = catalog
    ? listWebsiteProducts(catalog.id)
        .then((prods) => ({ id: catalog.id, label: catalog.label, products: prods, error: null }))
        .catch((e) => ({
          id: catalog.id,
          label: catalog.label,
          products: null,
          error: e instanceof Error ? e.message : "Failed to load",
        }))
    : Promise.resolve(null);

  const { categories, products } =
    optimisticCatalogPromise && currentBrand.id === brandIdParam
      ? await optimisticCatalogPromise
      : await getCatalogForBrand(currentBrand.id);
  const websiteCatalog = await websiteCatalogPromise;

  return (
    <StockClient
      brands={brands}
      currentBrand={currentBrand}
      categories={categories}
      products={products}
      websiteCatalog={websiteCatalog}
    />
  );
}
