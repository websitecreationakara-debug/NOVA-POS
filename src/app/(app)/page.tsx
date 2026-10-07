import { Suspense } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  DollarSign,
  Gift,
  Layers,
  Package,
  Percent,
  PiggyBank,
  Plus,
  Receipt,
  ShoppingCart,
  Trash2,
  TrendingDown,
  Truck,
  TrendingUp,
} from "lucide-react";
import {
  ALL_BUSINESSES_ID,
  getBrands,
  getDashboardStats,
  getLowStockCount,
  TOP_PRODUCT_MIN_PRICE,
  getWebsiteProductTotal,
} from "@/lib/supabase/queries";
import { rangeLabel, resolveRange } from "@/lib/dateRange";
import { ppDay } from "@/lib/phnomPenhTime";
import DashboardRangeBar from "./DashboardRangeBar";
import PeriodBarChart from "./PeriodBarChart";
import RecentOrdersRows from "./RecentOrdersRows";
import { formatCount, formatUsd } from "@/lib/formatNumber";

export const dynamic = "force-dynamic";

const BRANDS = ["BOSBA Premium Foods", "BOSBA Drink&Snack", "SORA SAKE"];

function formatMoney(n: number) {
  return formatUsd(n);
}

// Percent change of the last 7 days vs the 7 days before that, from the
// per-day series the dashboard already loads. null = not enough history.
function weekTrend(daily: { date: string; total: number }[]): number | null {
  const day = 86_400_000;
  const now = Date.now();
  const key = (t: number) => ppDay(new Date(t).toISOString());
  const recent = new Set<string>();
  const prior = new Set<string>();
  for (let i = 0; i < 7; i++) recent.add(key(now - i * day));
  for (let i = 7; i < 14; i++) prior.add(key(now - i * day));
  let r = 0;
  let p = 0;
  for (const d of daily) {
    if (recent.has(d.date)) r += d.total;
    else if (prior.has(d.date)) p += d.total;
  }
  if (p === 0) return r > 0 ? 100 : null;
  return ((r - p) / p) * 100;
}

function Trend({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <p
      className={`mt-1.5 flex items-center gap-1 text-xs font-medium ${
        up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
      }`}
    >
      <Icon className="size-3.5" />
      {up ? "+" : ""}
      {pct.toFixed(1)}% vs last week
    </p>
  );
}

// Streamed in its own Suspense boundary: it hits the 3 storefront APIs, which
// would otherwise hold up the whole dashboard's first paint.
async function WebsiteProductCount() {
  const total = await getWebsiteProductTotal();
  return <>{total === null ? "—" : formatCount(total)}</>;
}

// Low-stock reads the storefront APIs too -- streamed like the product count so
// the stats don't wait on it. getLowStockCount is cached, so the card and the
// banner below share one lookup.
async function LowStockCount() {
  return <>{formatCount(await getLowStockCount())}</>;
}

async function LowStockBanner() {
  const count = await getLowStockCount();
  if (count <= 0) return null;
  return (
    <Link
      href="/stock"
      className="flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-950"
    >
      <AlertTriangle className="size-5 shrink-0" />
      <span className="font-medium">
        {formatCount(count)} item{count === 1 ? "" : "s"} at or below the low-stock level
      </span>
      <span className="ml-auto flex items-center gap-1 font-semibold">
        Restock <ArrowRight className="size-4" />
      </span>
    </Link>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    brand?: string;
    mode?: string;
    from?: string;
    to?: string;
    week?: string;
    month?: string;
    quarter?: string;
    year?: string;
    // The separate filter above Top Branch / Top Products (see DashboardRangeBar's
    // paramPrefix) -- same fields, own params.
    top_mode?: string;
    top_from?: string;
    top_to?: string;
    top_week?: string;
    top_month?: string;
    top_quarter?: string;
    top_year?: string;
  }>;
}) {
  const params = await searchParams;
  const { mode, week, month, quarter, year, fromDate, toDate } = resolveRange(params);
  const brandParam = params.brand;

  const period = rangeLabel(fromDate, toDate);

  // Top Branch / Top Products have their own filter. Until it is used it
  // follows the page-wide range; once set, only those two cards move.
  const hasTopFilter = Object.keys(params).some((k) => k.startsWith("top_"));
  const topRange = hasTopFilter
    ? resolveRange({
        mode: params.top_mode,
        from: params.top_from,
        to: params.top_to,
        week: params.top_week,
        month: params.top_month,
        quarter: params.top_quarter,
        year: params.top_year,
      })
    : { mode, week, month, quarter, year, fromDate, toDate };
  const topSameRange = topRange.fromDate === fromDate && topRange.toDate === toDate;
  const loadStats = async (brandId: string) => {
    const [main, top] = await Promise.all([
      getDashboardStats(brandId, fromDate, toDate),
      topSameRange ? null : getDashboardStats(brandId, topRange.fromDate, topRange.toDate),
    ]);
    return { stats: main, topStats: top ?? main };
  };

  // The brand list and the stats don't depend on each other, so start them
  // together (optimistically trusting ?brand=) instead of one after the other.
  const [brands, first] = await Promise.all([getBrands(), loadStats(brandParam ?? ALL_BUSINESSES_ID)]);
  // Same fixed display order as the chips themselves (see brandsOrdered
  // below) -- an unrecognized/stale ?brand= falls back to "All Business"
  // rather than erroring.
  const currentBrandId =
    brandParam === ALL_BUSINESSES_ID || brands.some((b) => b.id === brandParam)
      ? (brandParam ?? ALL_BUSINESSES_ID)
      : ALL_BUSINESSES_ID;
  const { stats, topStats } =
    currentBrandId === (brandParam ?? ALL_BUSINESSES_ID) ? first : await loadStats(currentBrandId);
  const topPeriod = rangeLabel(topRange.fromDate, topRange.toDate);

  // Same brand order as the header chips, not whatever order orders happened
  // to come back in.
  const byBrandOrdered = stats.byBrand.toSorted((a, b) => {
    const ia = BRANDS.indexOf(a.brandName);
    const ib = BRANDS.indexOf(b.brandName);
    if (ia === -1 && ib === -1) return a.brandName.localeCompare(b.brandName);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  const brandsOrdered = brands.toSorted((a, b) => {
    const ia = BRANDS.indexOf(a.name);
    const ib = BRANDS.indexOf(b.name);
    if (ia === -1 && ib === -1) return a.name.localeCompare(b.name);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  // On "All Business" list every brand (a brand with no paid orders yet, like
  // SORA SAKE, still gets a chip with an empty chart); when the page is already
  // filtered to one brand, only that brand has data.
  const chartBrands =
    currentBrandId === ALL_BUSINESSES_ID
      ? brandsOrdered.map((b) => ({
          brandId: b.id,
          brandName: b.name,
          data: byBrandOrdered.find((x) => x.brandId === b.id),
        }))
      : byBrandOrdered.map((b) => ({ brandId: b.brandId, brandName: b.brandName, data: b }));
  const revenueByBusiness = chartBrands.map((b) => ({
    id: b.brandId,
    name: b.brandName,
    dailyData: b.data?.dailyRevenue ?? [],
  }));
  const ordersByBusiness = chartBrands.map((b) => ({
    id: b.brandId,
    name: b.brandName,
    dailyData: b.data?.dailyOrders ?? [],
  }));

  // Cards that drill down carry the selected business and date range along, so the
  // page they open shows the same slice of data the card was summing.
  const accountanceHref = (tab: string) =>
    `/accountance?${new URLSearchParams({ brand: currentBrandId, mode: "day", from: fromDate, to: toDate, tab })}`;
  const ordersHref = `/orders?${new URLSearchParams({
    ...(currentBrandId === ALL_BUSINESSES_ID ? {} : { brand: currentBrandId }),
    from: fromDate,
    to: toDate,
  })}`;

  const statCards = [
    {
      label: `Total Revenue (${period})`,
      value: formatMoney(stats.totalRevenue),
      icon: DollarSign,
      tint: "bg-amber-400/15 text-amber-600 dark:text-amber-400",
      trend: weekTrend(stats.dailyRevenue),
      href: accountanceHref("reports"),
    },
    {
      label: `Orders (${period})`,
      value: formatCount(stats.orderCount),
      icon: ShoppingCart,
      tint: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
      trend: weekTrend(stats.dailyOrders),
      href: ordersHref,
    },
    {
      label: "Total Products",
      value: (
        <Suspense fallback={<span className="text-muted-foreground">…</span>}>
          <WebsiteProductCount />
        </Suspense>
      ),
      icon: Package,
      tint: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
      trend: null,
      href: "/stock",
    },
    {
      label: "Low Stock Items",
      value: (
        <Suspense fallback={<span className="text-muted-foreground">…</span>}>
          <LowStockCount />
        </Suspense>
      ),
      icon: AlertTriangle,
      tint: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
      trend: null,
      href: "/stock?filter=low",
    },
    {
      label: `Total COGS (${period})${stats.hasUnknownCost ? " ⚠" : ""}`,
      value: formatMoney(stats.totalCogs),
      icon: Layers,
      tint: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
      trend: null,
      href: accountanceHref("cogs"),
    },
    {
      label: `Delivery Fees (${period})`,
      value: formatMoney(stats.deliveryFees),
      icon: Truck,
      tint: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
      trend: null,
      href: ordersHref,
    },
    {
      label: `Expenses (${period})`,
      value: formatMoney(stats.expenseTotal),
      icon: Receipt,
      tint: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
      trend: null,
      href: accountanceHref("expenses"),
    },
    {
      label: `Waste (${period})`,
      value: formatMoney(stats.wasteCost),
      icon: Trash2,
      tint: "bg-red-500/15 text-red-600 dark:text-red-400",
      trend: null,
      href: accountanceHref("cogs"),
    },
    {
      label: `Gross Profit (${period})`,
      value: formatMoney(stats.grossProfit),
      icon: PiggyBank,
      tint: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
      trend: null,
      href: accountanceHref("cogs"),
    },
    {
      label: `Gross Margin % (${period})`,
      value: stats.grossMarginPct === null ? "—" : `${stats.grossMarginPct.toFixed(1)}%`,
      icon: Percent,
      tint: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
      trend: null,
      href: accountanceHref("cogs"),
    },
    {
      label: `Promotions (${period})`,
      value: formatMoney(stats.promotionCost),
      icon: Gift,
      tint: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
      trend: null,
      href: "/marketing?tab=promotions",
    },
  ];

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:space-y-8 sm:p-8">
      <header>
        <h1 className="font-display text-3xl font-bold">NOVA POS</h1>
        <DashboardRangeBar
          brands={brandsOrdered}
          brandId={currentBrandId}
          mode={mode}
          week={week}
          month={month}
          quarter={quarter}
          year={year}
          fromDate={fromDate}
          toDate={toDate}
        />
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-2xl border border-border bg-card p-5 transition-colors hover:border-brand/50 hover:bg-muted/40"
          >
            <div className={`mb-4 grid size-10 place-items-center rounded-xl ${s.tint}`}>
              <s.icon className="size-5" />
            </div>
            <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
              {s.label}
            </p>
            <p className="font-display mt-1 text-2xl font-bold">{s.value}</p>
            <Trend pct={s.trend} />
          </Link>
        ))}
      </div>

      {/* Quick actions -- the handful of things a cashier jumps to most. */}
      <div className="flex flex-wrap gap-3">
        <Link
          href="/sales"
          className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:brightness-95"
        >
          <Plus className="size-4" />
          New Order
        </Link>
        <Link
          href="/stock"
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          <Plus className="size-4" />
          Add Product
        </Link>
        <Link
          href="/orders"
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          View Orders
        </Link>
      </div>

      <Suspense fallback={null}>
        <LowStockBanner />
      </Suspense>

      <DashboardRangeBar
        brands={brandsOrdered}
        brandId={currentBrandId}
        paramPrefix="top_"
        showBrands={false}
        mode={topRange.mode}
        week={topRange.week}
        month={topRange.month}
        quarter={topRange.quarter}
        year={topRange.year}
        fromDate={topRange.fromDate}
        toDate={topRange.toDate}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="font-display font-bold">Top Branch ({topPeriod})</h2>
          <p className="mt-1 text-xs text-muted-foreground">Ranked by revenue</p>
          {topStats.topBranches.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No sales in this period.</p>
          ) : (
            <ol className="mt-4 space-y-3">
              {topStats.topBranches.map((b, i) => (
                <li key={b.name} className="flex items-center gap-3 text-sm">
                  <span
                    className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                      i === 0 ? "bg-brand text-white" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatCount(b.orders)} order{b.orders === 1 ? "" : "s"}
                  </span>
                  <span className="w-24 text-right font-semibold">{formatMoney(b.revenue)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="font-display font-bold">Top Products ({topPeriod})</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Ranked by sales amount · items priced above {formatMoney(TOP_PRODUCT_MIN_PRICE)}
          </p>
          {topStats.topProducts.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No sales in this period.</p>
          ) : (
            <ol className="mt-4 space-y-3">
              {topStats.topProducts.map((p, i) => (
                <li key={p.name} className="flex items-center gap-3 text-sm">
                  <span
                    className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                      i === 0 ? "bg-brand text-white" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{formatCount(p.quantity)} sold</span>
                  <span className="w-24 text-right font-semibold">{formatMoney(p.revenue)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <PeriodBarChart
        title="Revenue"
        dailyData={stats.dailyRevenue}
        metric="money"
        businesses={revenueByBusiness}
      />

      <PeriodBarChart
        title="Orders"
        dailyData={stats.dailyOrders}
        metric="count"
        businesses={ordersByBusiness}
      />

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-4 py-4 sm:px-6">
          <h2 className="font-display font-bold">Recent Orders</h2>
        </div>
        {/* overflow-x-auto: if a phone is narrower than the columns, the table
            scrolls inside the card instead of being cut off at its edge. */}
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-[11px] font-bold tracking-wider text-muted-foreground uppercase sm:text-xs sm:tracking-widest">
            <tr>
              <th className="py-3 pr-2 pl-4 text-left sm:px-6">Order</th>
              <th className="px-2 py-3 text-left sm:px-3">Brand</th>
              <th className="px-2 py-3 text-left sm:px-3">Payment</th>
              <th className="py-3 pr-4 pl-2 text-right sm:px-6">Total</th>
            </tr>
          </thead>
          <tbody>
            <RecentOrdersRows orders={stats.recentOrders} />
          </tbody>
        </table>
        </div>
      </section>
    </main>
  );
}
