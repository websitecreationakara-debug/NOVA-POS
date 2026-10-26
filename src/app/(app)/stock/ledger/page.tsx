import { getBrands, getDailyLedger } from "@/lib/supabase/queries";
import { ppToday } from "@/lib/phnomPenhTime";
import DailyLedgerClient from "./DailyLedgerClient";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Stock > Daily Ledger: one month, every product's day-by-day stock (see lib/dailyLedger.ts), for
// the business picked with ?brand=. Read-only; the figures come from the stock history, the manual stock
// adjustments and the sold lines.
export default async function StockLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; month?: string }>;
}) {
  const { brand: brandParam, month: monthParam } = await searchParams;
  const today = ppToday();
  const month = monthParam && MONTH_RE.test(monthParam) ? monthParam : today.slice(0, 7);

  const brands = await getBrands();
  if (brands.length === 0) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Daily Ledger</h1>
        <p className="mt-2 text-zinc-500">No brands configured yet.</p>
      </main>
    );
  }
  // No "All businesses" view: no/unknown ?brand= falls back to the first business.
  const currentBrand = brands.find((b) => b.id === brandParam) ?? brands[0];
  const rows = (await getDailyLedger(currentBrand.id, month)).map((r) => ({ ...r, brandId: currentBrand.id }));

  return <DailyLedgerClient brands={brands} currentBrandId={currentBrand.id} month={month} today={today} rows={rows} />;
}
