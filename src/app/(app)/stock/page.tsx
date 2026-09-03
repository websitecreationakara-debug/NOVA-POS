import { getBrands, getCatalogForBrand } from "@/lib/supabase/queries";
import { catalogForBrandSlug } from "@/lib/websiteProducts/catalogs";
import { listWebsiteProducts } from "@/lib/websiteProducts/client";
import type {
  WebsiteCatalogId,
  WebsiteProduct,
} from "@/lib/websiteProducts/types";
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

  const brands = await getBrands();

  if (brands.length === 0) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Stock</h1>
        <p className="mt-2 text-zinc-500">
          No brands configured yet.
        </p>
      </main>
    );
  }

  const currentBrand =
    brands.find((b) => b.id === brandIdParam) ?? brands[0];

  const { categories, products } =
    await getCatalogForBrand(currentBrand.id);

  const catalog = catalogForBrandSlug(currentBrand.slug);

  const websiteCatalogPromise: Promise<WebsiteCatalogData | null> =
    catalog
      ? listWebsiteProducts(catalog.id)
          .then((prods) => ({
            id: catalog.id,
            label: catalog.label,
            products: prods,
            error: null,
          }))
          .catch((e) => ({
            id: catalog.id,
            label: catalog.label,
            products: null,
            error:
              e instanceof Error
                ? e.message
                : "Failed to load",
          }))
      : Promise.resolve(null);

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