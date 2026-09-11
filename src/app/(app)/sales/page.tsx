import {
  DEFAULT_BRAND_SLUG,
  getBrands,
  getCatalogForBrand,
  getCatalogForBrandSlug,
  getInvoice,
} from "@/lib/supabase/queries";
import { catalogForBrandSlug } from "@/lib/websiteProducts/catalogs";
import { listWebsiteProducts } from "@/lib/websiteProducts/client";
import type { WebsiteCatalogId, WebsiteProduct } from "@/lib/websiteProducts/types";
import SalesClient, { type EditOrderSeed } from "./SalesClient";

export type SalesWebsiteCatalog = {
  id: WebsiteCatalogId;
  label: string;
  products: WebsiteProduct[] | null;
  error: string | null;
  // Category filter chips for this storefront (see CATALOGS in
  // lib/websiteProducts/catalogs).
  categories: { id: string; label: string }[];
};

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; q?: string; editOrder?: string }>;
}) {
  const { brand: brandIdParam, q, editOrder: editOrderId } = await searchParams;

  // "Add product" on an existing order lands here with ?editOrder=<id>: load
  // that order so the checkout can open with its cart, customer and totals
  // already filled in, and charge back an update instead of a new sale.
  const editInvoice = editOrderId ? await getInvoice(editOrderId) : null;
  // When editing, the order's own brand wins over any ?brand= in the URL --
  // the catalog has to match the products already on the order.
  const effectiveBrandId = editInvoice?.order.brand_id ?? brandIdParam;

  // Start the (expensive, catalogs run into the hundreds of products) catalog
  // fetch immediately instead of waiting for getBrands() to resolve first --
  // that serial wait was doubling the round trip on every navigation. If
  // ?brand= is set (switching brands), fetch straight by id; otherwise (e.g.
  // clicking Sales/Stock in the sidebar, which carries no ?brand=) fetch by
  // the known default brand's slug so it doesn't need getBrands() to resolve
  // an id first. Either way, only falls back to a second fetch below if the
  // guess turns out to be wrong/stale.
  const brandsPromise = getBrands();
  const optimisticCatalogPromise = effectiveBrandId
    ? getCatalogForBrand(effectiveBrandId)
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

  const currentBrand = effectiveBrandId
    ? (brands.find((b) => b.id === effectiveBrandId) ?? brands[0])
    : (brands.find((b) => b.slug === DEFAULT_BRAND_SLUG) ?? brands[0]);
  const optimisticIsValid = effectiveBrandId
    ? currentBrand.id === effectiveBrandId
    : currentBrand.slug === DEFAULT_BRAND_SLUG;

  // The brand's storefront catalog, pulled live from its own products API (same
  // source the Stock > Website tab uses). Kick the fetch off in parallel with
  // the Supabase catalog; failures here never block the sale screen -- they
  // surface inside the Website tab.
  const catalog = catalogForBrandSlug(currentBrand.slug);
  const websiteCatalogPromise: Promise<SalesWebsiteCatalog | null> = catalog
    ? listWebsiteProducts(catalog.id)
        .then((prods) => ({
          id: catalog.id,
          label: catalog.label,
          products: prods,
          error: null,
          categories: catalog.categories ?? [],
        }))
        .catch((e) => ({
          id: catalog.id,
          label: catalog.label,
          products: null,
          error: e instanceof Error ? e.message : "Failed to load",
          categories: catalog.categories ?? [],
        }))
    : Promise.resolve(null);

  const { categories, products } = optimisticIsValid
    ? await optimisticCatalogPromise
    : await getCatalogForBrand(currentBrand.id);
  const websiteCatalog = await websiteCatalogPromise;

  const editOrder: EditOrderSeed | null = editInvoice
    ? {
        orderId: editInvoice.order.id,
        invoiceNumber: editInvoice.invoiceNumber,
        customerId: editInvoice.order.customer_id,
        customerName: editInvoice.order.customer_name ?? "",
        customerPhone: editInvoice.order.customer_phone ?? "",
        customerAddress: editInvoice.customerAddress ?? "",
        discount: editInvoice.order.discount,
        deliveryFee: editInvoice.order.delivery_fee,
        // Raw ISO -- SalesClient converts to a local datetime-local value so
        // the timezone maths happens in the browser, not on the server.
        deliveryAt: editInvoice.order.delivery_at ?? "",
        note: editInvoice.order.note ?? "",
        lines: editInvoice.items.map((i) => ({
          productId: i.productId,
          name: i.name,
          unitPrice: i.unitPrice,
          quantity: i.quantity,
        })),
      }
    : null;

  return (
    <SalesClient
      key={`${q ?? ""}:${editOrderId ?? ""}`}
      brands={brands}
      currentBrand={currentBrand}
      categories={categories}
      products={products}
      websiteCatalog={websiteCatalog}
      initialSearch={q ?? ""}
      editOrder={editOrder}
    />
  );
}
