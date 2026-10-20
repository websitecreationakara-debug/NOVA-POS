import { getBrands, getCatalogForBrand, getRecentStockUpdates } from "@/lib/supabase/queries";
import { catalogForBrandSlug, configuredCatalogs } from "@/lib/websiteProducts/catalogs";
import {
  addonToWebsiteProduct,
  markWebsiteSynced,
  websiteSyncDue,
  listWebsiteAddons,
  listWebsiteCategories,
  listWebsiteProducts,
} from "@/lib/websiteProducts/client";
import { getWebsitePurchaseCosts, type PurchaseCostFields } from "@/lib/websiteProducts/purchaseCosts";
import { syncWebsiteToPos } from "@/lib/websiteProducts/syncFromWebsite";
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
  // The other businesses a product here can be moved to (their websites are connected).
  moveTargets: { id: WebsiteCatalogId; label: string }[];
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

  const catalog = catalogForBrandSlug(currentBrand.slug);

  const moveTargets = catalog
    ? configuredCatalogs()
        .filter((c) => c.id !== catalog.id)
        .map((c) => ({ id: c.id, label: c.label }))
    : [];

  const websiteCatalogPromise: Promise<WebsiteCatalogData | null> =
    catalog
      // The products, add-ons, categories and purchase costs don't depend on each
      // other, so they load together instead of one after another.
      ? Promise.all([
          listWebsiteProducts(catalog.id),
          listWebsiteAddons(catalog.id).catch(() => []),
          listWebsiteCategories(catalog.id).catch(() => []),
          getWebsitePurchaseCosts(catalog.brandSlug as ProductSiteLink["site"]).catch(() => ({})),
        ])
          .then(([prods, addons, categories, purchaseCosts]) => ({
            id: catalog.id,
            label: catalog.label,
            moveTargets,
            products: prods,
            error: null,
            addons,
            categories,
            purchaseCosts,
          }))
          .catch((e) => ({
            id: catalog.id,
            label: catalog.label,
            moveTargets,
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

  // The POS catalog and the website's load together; the website is then copied onto the POS.
  // The recent-stock-updates read doesn't need the catalog either, so it goes with them.
  const [initialCatalog, websiteCatalog, recentByProductId] = await Promise.all([
    getCatalogForBrand(currentBrand.id),
    websiteCatalogPromise,
    getRecentStockUpdates(currentBrand.id, 7),
  ]);
  let { categories, products } = initialCatalog;

  // Keep the POS products' pictures and prices in step with the website's (the website is where
  // they're managed). If anything changed, reload the POS list so this very page shows it.
  // That copy is only repeated every few minutes (or after a write from here) -- it re-reads
  // every POS product, and nothing has usually changed since the last visit.
  if (catalog && websiteCatalog?.products && websiteSyncDue(catalog.id)) {
    // Add-ons are linked POS products too (their own picture/name/price live in the storefront's
    // add-on table), so they're copied across the same way.
    const siteItems = [...websiteCatalog.products, ...websiteCatalog.addons.map(addonToWebsiteProduct)];
    let syncFailed = false;
    const updated = await syncWebsiteToPos(currentBrand.slug, siteItems).catch((e) => {
      console.error("stock: couldn't sync website pictures/prices to the POS", e);
      syncFailed = true;
      return 0;
    });
    if (updated > 0) ({ categories, products } = await getCatalogForBrand(currentBrand.id));
    if (!syncFailed) markWebsiteSynced(catalog.id);
  }

  // When each product's stock was last changed by hand (last 7 days), keyed like the website
  // panel's own lookup -- `${site_product_id}::${variation_id}` -- for its "Recently updated" filter.
  const recentStockUpdates: Record<string, string> = {};
  for (const p of products) {
    const at = recentByProductId.get(p.id);
    if (at && p.site_link) {
      recentStockUpdates[`${p.site_link.site_product_id}::${p.site_link.variation_id}`] = at;
    }
  }

  return (
    <StockClient
      brands={brands}
      currentBrand={currentBrand}
      categories={categories}
      products={products}
      websiteCatalog={websiteCatalog}
      recentStockUpdates={recentStockUpdates}
    />
  );
}