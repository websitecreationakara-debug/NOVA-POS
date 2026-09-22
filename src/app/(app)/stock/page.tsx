import { getBrands, getCatalogForBrand } from "@/lib/supabase/queries";
import { catalogForBrandSlug } from "@/lib/websiteProducts/catalogs";
import { listWebsiteAddons, listWebsiteCategories, listWebsiteProducts } from "@/lib/websiteProducts/client";
import { getWebsitePurchaseCosts, type PurchaseCostFields } from "@/lib/websiteProducts/purchaseCosts";
import type {
  WebsiteAddon,
  WebsiteCatalogId,
  WebsiteCategory,
  WebsiteProduct,
} from "@/lib/websiteProducts/types";
import type { ProductSiteLink } from "@/types/database";
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
  // This storefront's live category list, if it has the read-only categories
  // endpoint deployed -- see categoriesUrlEnv. Empty for a catalog that hasn't
  // deployed it yet, in which case the panel falls back to its old
  // derived-from-products chip list.
  categories: WebsiteCategory[];
  // Manually-entered purchase-cost breakdown per storefront item (Original
  // Cost / Total Cost 10% / Extra Money columns), keyed by purchaseCostKey --
  // POS's own record, unrelated to the storefront's own data.
  purchaseCosts: Record<string, PurchaseCostFields>;
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
            categories: await listWebsiteCategories(catalog.id).catch(() => []),
            purchaseCosts: await getWebsitePurchaseCosts(
              catalog.brandSlug as ProductSiteLink["site"]
            ).catch(() => ({})),
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
            categories: [],
            purchaseCosts: {},
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