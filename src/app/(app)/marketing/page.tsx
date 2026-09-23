import { getBrands, getStockPickerItems } from "@/lib/supabase/queries";
import { listCustomersAction, listPromotionsAction } from "./actions";
import { getSetAction, listSetsAction } from "./costControlActions";
import MarketingClient from "./MarketingClient";
import CostControlClient from "./CostControlClient";

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; q?: string; tab?: string; set?: string }>;
}) {
  const { brand: brandId = "", q = "", tab, set: setParam } = await searchParams;

  if (tab === "cost-control") {
    const brands = await getBrands();
    if (brands.length === 0) {
      return (
        <main className="p-8">
          <h1 className="text-2xl font-semibold">Cost Control</h1>
          <p className="mt-2 text-zinc-500">No brands configured yet.</p>
        </main>
      );
    }
    const currentBrand = brands.find((b) => b.id === brandId) ?? brands[0];
    const activeSetId = setParam && setParam !== "new" ? setParam : null;

    const [sets, pickerItems, activeSet] = await Promise.all([
      listSetsAction(currentBrand.id),
      getStockPickerItems(currentBrand.id, currentBrand.slug, { includeAddons: true }),
      activeSetId ? getSetAction(activeSetId) : Promise.resolve(null),
    ]);

    return (
      <CostControlClient
        brands={brands}
        currentBrand={currentBrand}
        sets={sets}
        items={pickerItems}
        activeSet={activeSet}
        isBuilderOpen={!!setParam}
      />
    );
  }

  // brandId/q come straight from the URL, so promotions/customers don't
  // actually depend on the brands list -- fetch all three in parallel
  // instead of waiting on getBrands() first.
  const [brands, promotions, customers] = await Promise.all([
    getBrands(),
    listPromotionsAction(brandId),
    listCustomersAction(q),
  ]);

  return (
    <MarketingClient
      brands={brands}
      currentBrandId={brandId}
      promotions={promotions}
      customers={customers}
      searchTerm={q}
    />
  );
}
