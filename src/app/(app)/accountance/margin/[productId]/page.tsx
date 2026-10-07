import Link from "next/link";
import { notFound } from "next/navigation";
import { ALL_BUSINESSES_ID, getBrands, getProductMarginDetail } from "@/lib/supabase/queries";
import { ppToday } from "@/lib/phnomPenhTime";
import { formatUsd } from "@/lib/formatNumber";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SALES_SHOWN = 200;

function formatMoney(n: number) {
  return formatUsd(n);
}

function formatWhen(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Phnom_Penh" }) : "—";
}

// One Margin Report row opened up: the same product, business and dates as the
// row that was clicked, with every cost it was sold at and each sale behind it.
export default async function ProductMarginPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ brand?: string; from?: string; to?: string; back?: string }>;
}) {
  const { productId } = await params;
  const { brand = ALL_BUSINESSES_ID, from, to, back } = await searchParams;
  const today = ppToday();
  const fromDate = from && DAY_RE.test(from) ? from : today;
  const toDate = to && DAY_RE.test(to) ? to : fromDate;

  const [detail, brands] = await Promise.all([
    getProductMarginDetail(productId, brand, fromDate, toDate),
    getBrands(),
  ]);
  if (!detail) notFound();

  const { name, summary, costBreakdown, sales } = detail;
  const brandName = brands.find((b) => b.id === brand)?.name ?? "All Businesses";
  const rangeLabel = fromDate === toDate ? fromDate : `${fromDate} → ${toDate}`;
  // Only ever go back to the Accounting page (the link came from a query string).
  const backHref = back?.startsWith("/accountance") && !back.startsWith("//") ? back : "/accountance?tab=cogs";

  // This page's own address, so an order opened from here can come back to it.
  const thisPage = `/accountance/margin/${productId}?${new URLSearchParams({ brand, from: fromDate, to: toDate, back: backHref })}`;

  const stats = [
    { label: "Units sold", value: String(summary.unitsSold) },
    { label: "Revenue", value: formatMoney(summary.revenue) },
    { label: "Unit cost (current)", value: summary.unitCost === null ? "—" : formatMoney(summary.unitCost) },
    { label: "Total COGS", value: summary.totalCogs === null ? "No cost price" : formatMoney(summary.totalCogs) },
    { label: "Gross profit", value: summary.grossProfit === null ? "—" : formatMoney(summary.grossProfit) },
    { label: "Gross margin", value: summary.grossMarginPct === null ? "—" : `${summary.grossMarginPct.toFixed(1)}%` },
  ];

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <Link href={backHref} className="text-sm text-muted-foreground hover:underline">
        ← Back to Margin Report
      </Link>

      <header>
        <h1 className="text-xl font-semibold">{name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {brandName} · {rangeLabel}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-3">
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{s.label}</p>
            <p className="font-display mt-1 text-lg font-bold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="font-medium">Units sold by cost</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Each sale keeps the cost it was made at, so Total COGS adds up these rows.
        </p>
        {costBreakdown.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No cost recorded for the sales in this period.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
                <th className="py-2 pr-3">Cost per unit</th>
                <th className="py-2 pr-3 text-right">Units sold</th>
                <th className="py-2 pr-3 text-right">% of units</th>
                <th className="py-2 text-right">COGS</th>
              </tr>
            </thead>
            <tbody>
              {costBreakdown.map((c) => (
                <tr key={c.unitCost} className="border-b border-border">
                  <td className="py-2 pr-3 tabular-nums">{formatMoney(c.unitCost)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{c.units}</td>
                  <td className="py-2 pr-3 text-right text-muted-foreground tabular-nums">{c.share}%</td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(c.cogs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="font-medium">Sales ({sales.length})</h2>
        {sales.length > SALES_SHOWN && (
          <p className="mt-1 text-xs text-muted-foreground">Showing the {SALES_SHOWN} most recent.</p>
        )}
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
              <th className="py-2 pr-3">Date</th>
              <th className="py-2 pr-3 text-right">Qty</th>
              <th className="py-2 pr-3 text-right">Price</th>
              <th className="py-2 pr-3 text-right">Cost</th>
              <th className="py-2 pr-3 text-right">Line total</th>
              <th className="py-2 text-right">Order</th>
            </tr>
          </thead>
          <tbody>
            {sales.slice(0, SALES_SHOWN).map((s, i) => (
              <tr key={`${s.orderId}-${i}`} className="border-b border-border">
                <td className="py-2 pr-3 text-muted-foreground">{formatWhen(s.paidAt)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{s.quantity}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(s.unitPrice)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{s.unitCost === null ? "—" : formatMoney(s.unitCost)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(s.lineTotal)}</td>
                <td className="py-2 text-right">
                  <Link
                    href={`/orders/${s.orderId}?${new URLSearchParams({ back: thisPage })}`}
                    className="text-brand hover:underline"
                  >
                    View →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
