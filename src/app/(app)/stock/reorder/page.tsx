import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getBrands } from "@/lib/supabase/queries";
import { getReorderData } from "./data";
import { DEFAULT_LIMIT } from "@/lib/reorder";
import ReorderClient from "./ReorderClient";
import ReorderSkeleton from "./ReorderSkeleton";
import type { Brand } from "@/types/database";

// Stock > Reorder Suggestions: how much of each product to buy for the next month, from its sales and stock
// (see lib/reorder.ts for the rule), for the business picked with ?brand=.
export default async function ReorderPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; page?: string; limit?: string }>;
}) {
  const { brand: brandParam, page: pageParam, limit: limitParam } = await searchParams;
  // Opened without a page / limit (the sidebar link): go to the same address with them, e.g. ?page=1&limit=12.
  if (!pageParam || !limitParam) {
    const params = new URLSearchParams();
    if (brandParam) params.set("brand", brandParam);
    params.set("page", pageParam || "1");
    params.set("limit", limitParam || String(DEFAULT_LIMIT));
    redirect(`/stock/reorder?${params}`);
  }
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
  // Working the figures out takes a few seconds, so the page itself is sent first and the table streams in after it.
  return (
    <Suspense key={currentBrand.id} fallback={<ReorderSkeleton />}>
      <ReorderContent brands={brands} brand={currentBrand} />
    </Suspense>
  );
}

async function ReorderContent({ brands, brand }: { brands: Brand[]; brand: Brand }) {
  const data = await getReorderData(brand.id, brand.slug);
  return <ReorderClient brands={brands} currentBrandId={brand.id} data={data} />;
}
