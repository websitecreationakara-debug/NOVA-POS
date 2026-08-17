import { getBrands, getDailySales, getExpensesForDate, getReconciliation } from "@/lib/supabase/queries";
import AccountanceClient from "./AccountanceClient";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default async function AccountancePage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; date?: string }>;
}) {
  const { brand: brandIdParam, date: dateParam } = await searchParams;
  const date = dateParam || todayIso();

  // Switching brands always sets ?brand=<a valid id already in the list>,
  // so start these brand-scoped queries immediately instead of waiting
  // for getBrands() to resolve first. Falls back to a second fetch below
  // if the id turns out to be missing/stale.
  const brandsPromise = getBrands();
  const optimisticDataPromise = brandIdParam
    ? Promise.all([
        getDailySales(brandIdParam, date),
        getReconciliation(brandIdParam, date),
        getExpensesForDate(brandIdParam, date),
      ])
    : null;

  const brands = await brandsPromise;

  if (brands.length === 0) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Accountance</h1>
        <p className="mt-2 text-zinc-500">No brands configured yet.</p>
      </main>
    );
  }

  const currentBrand = brands.find((b) => b.id === brandIdParam) ?? brands[0];

  const [{ summary, orders }, reconciliation, expenses] =
    optimisticDataPromise && currentBrand.id === brandIdParam
      ? await optimisticDataPromise
      : await Promise.all([
          getDailySales(currentBrand.id, date),
          getReconciliation(currentBrand.id, date),
          getExpensesForDate(currentBrand.id, date),
        ]);

  return (
    <AccountanceClient
      brands={brands}
      currentBrand={currentBrand}
      date={date}
      summary={summary}
      orders={orders}
      reconciliation={reconciliation}
      expenses={expenses}
    />
  );
}
