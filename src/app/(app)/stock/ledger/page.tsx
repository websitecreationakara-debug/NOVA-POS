import { redirect } from "next/navigation";
import { getBrands, getDailyLedgerPage, LEDGER_PAGE_SIZES } from "@/lib/supabase/queries";
import { ppToday } from "@/lib/phnomPenhTime";
import DailyLedgerClient from "./DailyLedgerClient";

// Rows per page when the address has no ?limit= (one of LEDGER_PAGE_SIZES).
const DEFAULT_LIMIT = 25;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Stock > Daily Ledger: one month, every product's day-by-day stock (see lib/dailyLedger.ts), for
// the business picked with ?brand=. One page of products at a time (?page=&limit=), narrowed by ?q= -- the ledger
// holds hundreds of products, and loading and drawing them all made it slow.
export default async function StockLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; month?: string; q?: string; page?: string; limit?: string }>;
}) {
  const { brand: brandParam, month: monthParam, q: qParam, page: pageParam, limit: limitParam } = await searchParams;
  // Opened without a page / limit (the sidebar link): go to the same address with them, e.g. ?page=1&limit=25.
  if (!pageParam || !limitParam) {
    const params = new URLSearchParams();
    if (brandParam) params.set("brand", brandParam);
    if (monthParam) params.set("month", monthParam);
    if (qParam) params.set("q", qParam);
    params.set("page", pageParam || "1");
    params.set("limit", limitParam || String(DEFAULT_LIMIT));
    redirect(`/stock/ledger?${params}`);
  }
  const q = (qParam ?? "").trim().slice(0, 80);
  const limit = LEDGER_PAGE_SIZES.includes(Number(limitParam)) ? Number(limitParam) : DEFAULT_LIMIT;
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
  const result = await getDailyLedgerPage(currentBrand.id, month, { q, page: Math.floor(Number(pageParam)) || 1, limit });
  const rows = result.rows.map((r) => ({ ...r, brandId: currentBrand.id }));

  return (
    <DailyLedgerClient
      brands={brands}
      currentBrandId={currentBrand.id}
      month={month}
      today={today}
      rows={rows}
      categories={result.categories}
      paging={{ q, page: result.page, pageCount: result.pageCount, limit, total: result.total, pageSizes: LEDGER_PAGE_SIZES }}
    />
  );
}
