import { Suspense } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  DollarSign,
  Package,
  Plus,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { getDashboardStats, getWebsiteProductTotal } from "@/lib/supabase/queries";
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

export default async function Home() {
  const stats = await getDashboardStats();

  const currentYear = new Date().getUTCFullYear();

  const statCards = [
    {
      label: `Total Revenue (${currentYear})`,
      value: formatMoney(stats.totalRevenue),
      icon: DollarSign,
      tint: "bg-amber-400/15 text-amber-600 dark:text-amber-400",
      trend: weekTrend(stats.dailyRevenue),
    },
    {
      label: "Orders Today",
      value: stats.ordersToday,
      icon: ShoppingCart,
      tint: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
      trend: weekTrend(stats.dailyOrders),
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
    },
    {
      label: "Low Stock Items",
      value: stats.lowStockCount,
      icon: AlertTriangle,
      tint: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
      trend: null,
    },
  ];

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 p-8">
      <header>
        <h1 className="font-display text-3xl font-bold">NOVA POS</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          {BRANDS.map((b) => (
            <span
              key={b}
              className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground"
            >
              {b}
            </span>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-5">
            <div className={`mb-4 grid size-10 place-items-center rounded-xl ${s.tint}`}>
              <s.icon className="size-5" />
            </div>
            <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
              {s.label}
            </p>
            <p className="font-display mt-1 text-2xl font-bold">{s.value}</p>
            <Trend pct={s.trend} />
          </div>
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

      <PeriodBarChart title="Revenue" dailyData={stats.dailyRevenue} metric="money" />

      <PeriodBarChart title="Orders" dailyData={stats.dailyOrders} metric="count" />

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
