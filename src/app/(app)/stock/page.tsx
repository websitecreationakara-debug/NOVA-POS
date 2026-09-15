import { getBrands, getCatalogForBrand } from "@/lib/supabase/queries";
import { catalogForBrandSlug } from "@/lib/websiteProducts/catalogs";
import { listWebsiteAddons, listWebsiteProducts } from "@/lib/websiteProducts/client";
import type {
  WebsiteAddon,
  WebsiteCatalogId,
  WebsiteProduct,
} from "@/lib/websiteProducts/types";
import StockClient from "./StockClient";

export type WebsiteCatalogData = {
  id: WebsiteCatalogId;
  label: string;
  products: WebsiteProduct[] | null;
  error: string | null;
  // Read-only -- see addonToWebsiteProduct's comment in
  // lib/websiteProducts/client.ts for why these never go through the
  // editable product list above. Empty for a brand with no add-on endpoint.
  addons: WebsiteAddon[];
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
          .then(async (prods) => ({
            id: catalog.id,
            label: catalog.label,
            products: prods,
            error: null,
            addons: await listWebsiteAddons(catalog.id).catch(() => []),
          }))
          .catch((e) => ({
            id: catalog.id,
            label: catalog.label,
            products: null,
            error:
              e instanceof Error
                ? e.message
                : "Failed to load",
            addons: [],
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