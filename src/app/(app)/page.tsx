import { AlertTriangle, DollarSign, Package, ShoppingCart } from "lucide-react";
import { getDashboardStats } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
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
      value: stats.totalProducts,
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

  const maxDay = Math.max(...stats.last7Days.map((d) => d.total), 1);

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

      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-display text-lg font-bold">Revenue · Last 7 days</h2>
        <div className="mt-6 flex h-48 items-end gap-3">
          {stats.last7Days.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-2">
              <div className="flex w-full flex-1 items-end">
                <div
                  className="relative w-full overflow-hidden rounded-t-md bg-brand/15"
                  style={{ height: `${(d.total / maxDay) * 100}%`, minHeight: "4px" }}
                >
                  <div className="absolute inset-x-0 bottom-0 h-full bg-brand" />
                </div>
              </div>
              <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                {new Date(`${d.day}T00:00:00`).toLocaleDateString("en", { weekday: "short" })}
              </span>
            </div>
          ))}
        </div>
      </section>

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
