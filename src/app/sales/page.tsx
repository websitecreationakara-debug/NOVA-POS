import { getBrands, getCatalogForBrand } from "@/lib/supabase/queries";
import SalesClient from "./SalesClient";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const { brand: brandIdParam } = await searchParams;
  const brands = await getBrands();

  if (brands.length === 0) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Sales</h1>
        <p className="mt-2 text-zinc-500">No brands configured yet.</p>
      </main>
    );
  }

  const currentBrand = brands.find((b) => b.id === brandIdParam) ?? brands[0];
  const { categories, products } = await getCatalogForBrand(currentBrand.id);

  return (
    <SalesClient
      brands={brands}
      currentBrand={currentBrand}
      categories={categories}
      products={products}
    />
  );
}
