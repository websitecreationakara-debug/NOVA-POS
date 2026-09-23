import {
  ALL_BUSINESSES_ID,
  getBrands,
  getCogsSummary,
  getDailySales,
  getExpensesForDateRange,
  getMarginReport,
  getReconciliation,
  getStockPickerItems,
  getWasteLog,
  type StockPickerItem,
  type WasteLogEntry,
} from "@/lib/supabase/queries";
import type { Brand } from "@/types/database";
import AccountanceClient from "./AccountanceClient";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// The immediately preceding period of the same length as [fromDate, toDate]
// -- e.g. viewing a single day compares against yesterday, a 7-day week
// compares against the 7 days before it. Powers the summary cards' small
// vs-previous-period trend badges.
function previousPeriodRange(fromDate: string, toDate: string): { from: string; to: string } {
  const lengthDays =
    Math.round(
      (new Date(`${toDate}T00:00:00.000Z`).getTime() - new Date(`${fromDate}T00:00:00.000Z`).getTime()) /
        86_400_000
    ) + 1;
  const to = addDaysIso(fromDate, -1);
  const from = addDaysIso(to, -(lengthDays - 1));
  return { from, to };
}

// "2026-09" -> the first and last calendar day of that month. Date.UTC's
// day-0 rolls back to the last day of the *previous* month, so passing the
// target month as if it were 1-indexed (m, not m - 1) lands on its last day.
function monthRange(monthStr: string): { from: string; to: string } {
  const [y, m] = monthStr.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${monthStr}-01`, to: `${monthStr}-${String(lastDay).padStart(2, "0")}` };
}

function yearRange(yearStr: string): { from: string; to: string } {
  return { from: `${yearStr}-01-01`, to: `${yearStr}-12-31` };
}

// Any date -> the Monday on or before it (UTC), same "week starts Monday"
// convention PeriodBarChart's mondayOf() uses on the Dashboard, so a
// business's week means the same thing everywhere in the app.
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const dow = d.getUTCDay(); // 0 = Sun .. 6 = Sat
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}

// `weekStr` is any date within the target week (canonically its Monday, but
// stepping/navigation just needs *a* date inside the week) -> that week's
// Monday-Sunday range.
function weekRange(weekStr: string): { from: string; to: string } {
  const from = mondayOf(weekStr);
  const sunday = new Date(`${from}T00:00:00.000Z`);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return { from, to: sunday.toISOString().slice(0, 10) };
}

// "2026-Q3" -> that quarter's first and last calendar day.
function quarterRange(quarterStr: string): { from: string; to: string } {
  const [yearPart, qPart] = quarterStr.split("-Q");
  const y = Number(yearPart);
  const startMonth = (Number(qPart) - 1) * 3; // 0-indexed
  const lastDay = new Date(Date.UTC(y, startMonth + 3, 0)).getUTCDate();
  return {
    from: `${y}-${String(startMonth + 1).padStart(2, "0")}-01`,
    to: `${y}-${String(startMonth + 3).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

function quarterOf(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

const ACCOUNTANCE_TABS = ["reconciliation", "expenses", "reports", "cogs"] as const;
export type AccountanceTab = (typeof ACCOUNTANCE_TABS)[number];

// A pseudo-brand for the "All Businesses" option in the brand dropdown --
// not a real row, just enough of a Brand for AccountanceClient to render its
// name/id like any other selection. getDailySales/getExpensesForDate/etc.
// all special-case ALL_BUSINESSES_ID to combine every real brand's rows
// instead of filtering to one.
const ALL_BUSINESSES_BRAND: Brand = {
  id: ALL_BUSINESSES_ID,
  slug: ALL_BUSINESSES_ID,
  name: "All Businesses",
  logo_url: null,
  created_at: "",
};

// Reconciling a till count is inherently per single day (one row per
// brand+date in cash_reconciliations) -- once the range covers more than
// one day there's no single "counted cash" figure to enter, so that query
// is skipped rather than picking one day out of the range to reconcile.
function reconciliationFor(brandId: string, fromDate: string, toDate: string) {
  if (fromDate !== toDate || brandId === ALL_BUSINESSES_ID) return Promise.resolve(null);
  return getReconciliation(brandId, fromDate);
}

export default async function AccountancePage({
  searchParams,
}: {
  searchParams: Promise<{
    brand?: string;
    from?: string;
    to?: string;
    date?: string;
    mode?: string;
    week?: string;
    month?: string;
    quarter?: string;
    year?: string;
    tab?: string;
  }>;
}) {
  const {
    brand: brandIdParam,
    from: fromParam,
    to: toParam,
    date: dateParam,
    mode: modeParam,
    week: weekParam,
    month: monthParam,
    quarter: quarterParam,
    year: yearParam,
    tab: tabParam,
  } = await searchParams;
  const today = todayIso();
  const mode =
    modeParam === "week" || modeParam === "month" || modeParam === "quarter" || modeParam === "year"
      ? modeParam
      : "day";
  const week = weekParam || mondayOf(today);
  const month = monthParam || today.slice(0, 7);
  const quarter = quarterParam || quarterOf(today);
  const year = yearParam || today.slice(0, 4);
  const tab = ACCOUNTANCE_TABS.includes(tabParam as AccountanceTab) ? (tabParam as AccountanceTab) : "reconciliation";

  // `date` is kept as a fallback so any old bookmarked/shared link (before
  // this page had a range) still resolves to that single day.
  let fromDate: string;
  let toDate: string;
  if (mode === "week") ({ from: fromDate, to: toDate } = weekRange(week));
  else if (mode === "month") ({ from: fromDate, to: toDate } = monthRange(month));
  else if (mode === "quarter") ({ from: fromDate, to: toDate } = quarterRange(quarter));
  else if (mode === "year") ({ from: fromDate, to: toDate } = yearRange(year));
  else {
    fromDate = fromParam || dateParam || today;
    toDate = toParam || fromDate;
  }

  // Switching brands always sets ?brand=<a valid id already in the list>,
  // so start these brand-scoped queries immediately instead of waiting
  // for getBrands() to resolve first. Falls back to a second fetch below
  // if the id turns out to be missing/stale.
  const brandsPromise = getBrands();
  const optimisticDataPromise = brandIdParam
    ? Promise.all([
        getDailySales(brandIdParam, fromDate, toDate),
        reconciliationFor(brandIdParam, fromDate, toDate),
        getExpensesForDateRange(brandIdParam, fromDate, toDate),
        getCogsSummary(brandIdParam, fromDate, toDate),
        getMarginReport(brandIdParam, fromDate, toDate),
      ])
    : null;

  const brands = await brandsPromise;

  if (brands.length === 0) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Accounting</h1>
        <p className="mt-2 text-zinc-500">No brands configured yet.</p>
      </main>
    );
  }

  const currentBrand =
    brandIdParam === ALL_BUSINESSES_ID
      ? ALL_BUSINESSES_BRAND
      : (brands.find((b) => b.id === brandIdParam) ?? brands[0]);

  const [{ summary, orders }, reconciliation, expenses, cogsSummary, marginReport] =
    optimisticDataPromise && currentBrand.id === brandIdParam
      ? await optimisticDataPromise
      : await Promise.all([
          getDailySales(currentBrand.id, fromDate, toDate),
          reconciliationFor(currentBrand.id, fromDate, toDate),
          getExpensesForDateRange(currentBrand.id, fromDate, toDate),
          getCogsSummary(currentBrand.id, fromDate, toDate),
          getMarginReport(currentBrand.id, fromDate, toDate),
        ]);

  // Only the COGS tab needs either of these -- skip the extra queries for
  // every other tab. The "+ Add waste item" picker also needs one real
  // brand's product list (waste is logged against one brand's actual stock),
  // but the log itself reads fine for "All Businesses" too.
  const { from: prevFromDate, to: prevToDate } = previousPeriodRange(fromDate, toDate);
  const wasteDataPromise: Promise<[StockPickerItem[], WasteLogEntry[]]> =
    tab === "cogs"
      ? Promise.all([
          currentBrand.id !== ALL_BUSINESSES_ID
            ? getStockPickerItems(currentBrand.id, currentBrand.slug)
            : Promise.resolve([]),
          getWasteLog(currentBrand.id, fromDate, toDate),
        ])
      : Promise.resolve([[], []]);
  const previousPeriodPromise = Promise.all([
    getDailySales(currentBrand.id, prevFromDate, prevToDate),
    getExpensesForDateRange(currentBrand.id, prevFromDate, prevToDate),
    getCogsSummary(currentBrand.id, prevFromDate, prevToDate),
  ]);

  const [[wasteItems, wasteLog], [{ summary: prevSummary }, prevExpenses, prevCogsSummary]] =
    await Promise.all([wasteDataPromise, previousPeriodPromise]);

  const prevExpenseTotal = prevExpenses.reduce((sum, e) => sum + e.amount, 0);
  const prevGrossProfit = prevSummary.total - prevCogsSummary.totalCogs;
  const prevNetProfit = prevGrossProfit - prevExpenseTotal - prevCogsSummary.wasteCost - prevCogsSummary.promotionCost;
  const previousPeriod = {
    cashTotal: prevSummary.cashTotal,
    nonCashTotal: prevSummary.nonCashTotal,
    orderCount: prevSummary.orderCount,
    total: prevSummary.total,
    expenseTotal: prevExpenseTotal,
    netProfit: prevNetProfit,
  };

  return (
    <AccountanceClient
      brands={brands}
      currentBrand={currentBrand}
      mode={mode}
      week={week}
      month={month}
      quarter={quarter}
      year={year}
      fromDate={fromDate}
      toDate={toDate}
      tab={tab}
      summary={summary}
      orders={orders}
      reconciliation={reconciliation}
      expenses={expenses}
      cogsSummary={cogsSummary}
      marginReport={marginReport}
      wasteItems={wasteItems}
      wasteLog={wasteLog}
      previousPeriod={previousPeriod}
    />
  );
}
