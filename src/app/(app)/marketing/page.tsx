import { getBrands } from "@/lib/supabase/queries";
import { listCustomersAction, listPromotionsAction } from "./actions";
import MarketingClient from "./MarketingClient";

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; q?: string }>;
}) {
  const { brand: brandId = "", q = "" } = await searchParams;

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
