import { getBrands } from "@/lib/supabase/queries";
import { getReorderData } from "./data";
import ReorderClient from "./ReorderClient";

// Stock > Reorder Suggestions: how much of each product to buy for the next month, from its sales and stock
// (see lib/reorder.ts for the rule), for the business picked with ?brand=.
export default async function ReorderPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const { brand: brandParam } = await searchParams;
  const brands = await getBrands();
  if (brands.length === 0) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Reorder Suggestions</h1>
        <p className="mt-2 text-zinc-500">No brands configured yet.</p>
      </main>
    );
  }
  const currentBrand = brands.find((b) => b.id === brandParam) ?? brands[0];
  const data = await getReorderData(currentBrand.id, currentBrand.slug);
  return <ReorderClient brands={brands} currentBrandId={currentBrand.id} data={data} />;
}
