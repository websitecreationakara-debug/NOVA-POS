import { getBrands } from "@/lib/supabase/queries";
import { listCustomersAction, listPromotionsAction } from "./actions";
import MarketingClient from "./MarketingClient";

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; q?: string }>;
}) {
  const { brand: brandId = "", q = "" } = await searchParams;
  const brands = await getBrands();

  const [promotions, customers] = await Promise.all([
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
