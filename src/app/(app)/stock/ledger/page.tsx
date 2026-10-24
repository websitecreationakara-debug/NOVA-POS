import { getBrands, getDailyLedger } from "@/lib/supabase/queries";
import { ppToday } from "@/lib/phnomPenhTime";
import DailyLedgerClient from "./DailyLedgerClient";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Stock > Daily Ledger: one month, every product's day-by-day stock (see lib/dailyLedger.ts), for
// all businesses (shown as separate sections) or just one picked with ?brand=. Read-only; the figures come from the stock history, the manual stock
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
  const currentBrand = brands.find((b) => b.id === brandParam);
  const shown = currentBrand ? [currentBrand] : brands;
  const rows = (
    await Promise.all(
      shown.map(async (b) => (await getDailyLedger(b.id, month)).map((r) => ({ ...r, brandId: b.id })))
    )
  ).flat();

  return <DailyLedgerClient brands={brands} currentBrandId={currentBrand?.id ?? "all"} month={month} today={today} rows={rows} />;
}
