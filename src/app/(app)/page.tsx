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
  ShoppingCart,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  ALL_BUSINESSES_ID,
  getBrands,
  getDashboardStats,
  getWebsiteProductTotal,
} from "@/lib/supabase/queries";
import { rangeLabel, resolveRange } from "@/lib/dateRange";
import DashboardRangeBar from "./DashboardRangeBar";
import PeriodBarChart from "./PeriodBarChart";
import RecentOrdersRows from "./RecentOrdersRows";

export const dynamic = "force-dynamic";

const BRANDS = ["BOSBA Premium Foods", "BOSBA Drink&Snack", "SORA SAKE"];

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

// Percent change of the last 7 days vs the 7 days before that, from the
// per-day series the dashboard already loads. null = not enough history.
function weekTrend(daily: { date: string; total: number }[]): number | null {
  const day = 86_400_000;
  const now = Date.now();
  const key = (t: number) => new Date(t).toISOString().slice(0, 10);
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
  return <>{total ?? "—"}</>;
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
  }>;
}) {
  const params = await searchParams;
  const { mode, week, month, quarter, year, fromDate, toDate } = resolveRange(params);
  const brandParam = params.brand;
  const brands = await getBrands();
  // Same fixed display order as the chips themselves (see brandsOrdered
  // below) -- an unrecognized/stale ?brand= falls back to "All Business"
  // rather than erroring.
  const currentBrandId =
    brandParam === ALL_BUSINESSES_ID || brands.some((b) => b.id === brandParam)
      ? (brandParam ?? ALL_BUSINESSES_ID)
      : ALL_BUSINESSES_ID;
  const stats = await getDashboardStats(currentBrandId, fromDate, toDate);

  const period = rangeLabel(fromDate, toDate);

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
  const revenueByBusiness = byBrandOrdered.map((b) => ({
    id: b.brandId,
    name: b.brandName,
    dailyData: b.dailyRevenue,
  }));
  const ordersByBusiness = byBrandOrdered.map((b) => ({
    id: b.brandId,
    name: b.brandName,
    dailyData: b.dailyOrders,
  }));

  const statCards = [
    {
      label: `Total Revenue (${period})`,
      value: formatMoney(stats.totalRevenue),
      icon: DollarSign,
      tint: "bg-amber-400/15 text-amber-600 dark:text-amber-400",
      trend: weekTrend(stats.dailyRevenue),
      href: "/accountance?tab=reports",
    },
    {
      label: `Orders (${period})`,
      value: stats.orderCount,
      icon: ShoppingCart,
      tint: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
      trend: weekTrend(stats.dailyOrders),
      href: "/orders",
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
      value: stats.lowStockCount,
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
      href: "/accountance?tab=cogs",
    },
    {
      label: `Gross Profit (${period})`,
      value: formatMoney(stats.grossProfit),
      icon: PiggyBank,
      tint: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
      trend: null,
      href: "/accountance?tab=cogs",
    },
    {
      label: `Gross Margin % (${period})`,
      value: stats.grossMarginPct === null ? "—" : `${stats.grossMarginPct.toFixed(1)}%`,
      icon: Percent,
      tint: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
      trend: null,
      href: "/accountance?tab=cogs",
    },
    {
      label: `Waste (${period})`,
      value: formatMoney(stats.wasteCost),
      icon: Trash2,
      tint: "bg-red-500/15 text-red-600 dark:text-red-400",
      trend: null,
      href: "/accountance?tab=cogs",
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
    <main className="mx-auto w-full max-w-7xl space-y-8 p-8">
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
          className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-black hover:brightness-95"
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

      {stats.lowStockCount > 0 && (
        <Link
          href="/stock"
          className="flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-950"
        >
          <AlertTriangle className="size-5 shrink-0" />
          <span className="font-medium">
            {stats.lowStockCount} item{stats.lowStockCount === 1 ? "" : "s"} at or below the
            low-stock level
          </span>
          <span className="ml-auto flex items-center gap-1 font-semibold">
            Restock <ArrowRight className="size-4" />
          </span>
        </Link>
      )}

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
        <div className="border-b border-border px-6 py-4">
          <h2 className="font-display font-bold">Recent Orders</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs font-bold tracking-widest text-muted-foreground uppercase">
            <tr>
              <th className="px-6 py-3 text-left">Order</th>
              <th className="px-3 py-3 text-left">Brand</th>
              <th className="px-3 py-3 text-left">Payment</th>
              <th className="px-6 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <RecentOrdersRows orders={stats.recentOrders} />
          </tbody>
        </table>
      </section>
    </main>
  );
}
