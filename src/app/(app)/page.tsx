import { Suspense } from "react";
import { AlertTriangle, DollarSign, Package, ShoppingCart } from "lucide-react";
import { getDashboardStats, getWebsiteProductTotal } from "@/lib/supabase/queries";
import RevenueChart from "./RevenueChart";

export const dynamic = "force-dynamic";

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

// Streamed in its own Suspense boundary: it hits the 3 storefront APIs, which
// would otherwise hold up the whole dashboard's first paint.
async function WebsiteProductCount() {
  const total = await getWebsiteProductTotal();
  return <>{total ?? "—"}</>;
}

export default async function Home() {
  const stats = await getDashboardStats();

  const statCards = [
    {
      label: "Total Revenue",
      value: formatMoney(stats.totalRevenue),
      icon: DollarSign,
      tint: "bg-brand/10 text-brand",
    },
    {
      label: "Orders Today",
      value: stats.ordersToday,
      icon: ShoppingCart,
      tint: "bg-accent-bg text-brand",
    },
    {
      label: "Total Products",
      value: (
        <Suspense fallback={<span className="text-muted-foreground">…</span>}>
          <WebsiteProductCount />
        </Suspense>
      ),
      icon: Package,
      tint: "bg-success-bg text-success",
    },
    {
      label: "Low Stock Items",
      value: stats.lowStockCount,
      icon: AlertTriangle,
      tint: "bg-warning-bg text-warning",
    },
  ];

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 p-8">
      <header>
        <h1 className="font-display text-3xl font-bold">NOVA POS</h1>
        <p className="mt-1 text-muted-foreground">
          BOSBA Premium Foods · BOSBA Drink&amp;Snack · SORA SAKE
        </p>
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
          </div>
        ))}
      </div>

      <RevenueChart dailyRevenue={stats.dailyRevenue} />

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
            {stats.recentOrders.map((o) => (
              <tr key={o.id} className="border-t border-border">
                <td className="px-6 py-3 font-mono text-xs">{o.id.slice(0, 8)}</td>
                <td className="px-3 py-3 text-muted-foreground">{o.brandName}</td>
                <td className="px-3 py-3">
                  <span className="rounded bg-muted px-2 py-0.5 text-xs font-bold uppercase">
                    {o.status}
                  </span>
                </td>
                <td className="px-6 py-3 text-right font-bold">{formatMoney(o.total)}</td>
              </tr>
            ))}
            {stats.recentOrders.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                  No orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
