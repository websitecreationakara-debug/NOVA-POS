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
  const brands = await getBrands();

  if (brands.length === 0) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Accountance</h1>
        <p className="mt-2 text-zinc-500">No brands configured yet.</p>
      </main>
    );
  }

  const currentBrand = brands.find((b) => b.id === brandIdParam) ?? brands[0];
  const date = dateParam || todayIso();

  const [{ summary, orders }, reconciliation, expenses] = await Promise.all([
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
