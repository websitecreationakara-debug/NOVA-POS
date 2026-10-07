"use client";

import { useRouter } from "next/navigation";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Boxes, ChevronRight, Crown, Receipt, TrendingUp } from "lucide-react";
import type { Brand } from "@/types/database";
import { INSIGHT_RANGE_LABELS, type InsightRange, type ProductInsight } from "@/lib/productInsight";
import { Card, Donut, Empty, HBars, Kpi, PALETTE, money, monthLabel, num } from "./chartParts";
import InsightTabs, { type InsightView } from "./InsightTabs";

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const fmtDay = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

export default function ProductInsightClient({
  insight,
  range,
  brandId,
  brands,
  from,
  to,
}: {
  insight: ProductInsight;
  range: InsightRange;
  brandId: string;
  brands: Brand[];
  from: string | null;
  to: string;
}) {
  const router = useRouter();

  // The period and business live in the page address, so a view can be reloaded or shared.
  function go(patch: { range?: InsightRange; brand?: string; from?: string; to?: string }) {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", "product-insight");
    if (patch.range) params.set("range", patch.range);
    // The picked days only mean something for "Custom"; the other ranges drop them.
    if (patch.range === "custom") {
      params.set("from", patch.from ?? from ?? to);
      params.set("to", patch.to ?? to);
    } else if (patch.range) {
      params.delete("from");
      params.delete("to");
    } else if (patch.from || patch.to) {
      params.set("range", "custom");
      params.set("from", patch.from ?? from ?? to);
      params.set("to", patch.to ?? to);
    }
    if (patch.brand !== undefined) {
      if (patch.brand) params.set("brand", patch.brand);
      else params.delete("brand");
    }
    router.push(`/marketing?${params.toString()}`, { scroll: false });
  }

  const best = insight.topByRevenue[0];
  const bestShare = best && insight.revenue ? (best.revenue / insight.revenue) * 100 : 0;
  const avgOrder = insight.orders ? insight.revenue / insight.orders : 0;
  const isEmpty = insight.orders === 0;
  const pairMax = insight.pairs[0]?.count ?? 1;
  const brandName = brands.find((b) => b.id === brandId)?.name;

  // Each number opens the data behind it: Sales / Units sold -> the by-product
  // tables (for the year of the period's last day), Orders -> the Orders list for
  // the same days and business.
  const tableHref = (view: "price" | "quantity") =>
    `/marketing?${new URLSearchParams({
      tab: "product-insight",
      view,
      year: to.slice(0, 4),
      ...(brandId ? { brand: brandId } : {}),
    })}`;
  const ordersHref = `/orders?${new URLSearchParams({
    ...(brandId ? { brand: brandId } : {}),
    ...(from ? { from } : {}),
    to,
  })}`;

  // The quantity / price tables are their own loads (a whole year of sales).
  function openView(view: InsightView) {
    if (view === "overview") return;
    const params = new URLSearchParams(window.location.search);
    params.set("tab", "product-insight");
    params.set("view", view);
    params.delete("range");
    params.delete("from");
    params.delete("to");
    router.push(`/marketing?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="min-h-screen space-y-6 p-6">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-label="Breadcrumb">
        <span>Marketing</span>
        <ChevronRight className="size-3.5" />
        <span className="font-medium text-foreground">Product Insight</span>
      </nav>
      <InsightTabs active="overview" onChange={openView} />
      <div>
        <h1 className="text-lg font-medium">Product Insight</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          What sells, and what sells together
          {from ? ` · ${fmtDay(from)} – ${fmtDay(to)}` : ` · up to ${fmtDay(to)}`}
          {brandName ? ` · ${brandName}` : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(INSIGHT_RANGE_LABELS) as InsightRange[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => go({ range: r })}
            aria-pressed={range === r}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
              range === r
                ? "border-brand bg-brand text-white"
                : "border-border text-foreground hover:bg-black/[.04] dark:hover:bg-white/[.06]"
            }`}
          >
            {INSIGHT_RANGE_LABELS[r]}
          </button>
        ))}
        {range === "custom" && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="date"
              aria-label="From"
              value={from ?? to}
              max={to}
              onChange={(e) => e.target.value && go({ from: e.target.value })}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            />
            to
            <input
              type="date"
              aria-label="To"
              value={to}
              min={from ?? undefined}
              onChange={(e) => e.target.value && go({ to: e.target.value })}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            />
          </span>
        )}
        <select
          aria-label="Business"
          value={brandId}
          onChange={(e) => go({ brand: e.target.value })}
          className="ml-auto rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-foreground"
        >
          <option value="">All businesses</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={TrendingUp}
          label="Sales"
          value={money(insight.revenue)}
          tint="#2b7fc4"
          note="Item prices, before discounts"
          href={tableHref("price")}
          hrefLabel="Sales by product"
        />
        <Kpi
          icon={Boxes}
          label="Units sold"
          value={num(insight.units)}
          tint="#0891b2"
          note={`${num(insight.products)} different products`}
          href={tableHref("quantity")}
          hrefLabel="Units by product"
        />
        <Kpi
          icon={Receipt}
          label="Orders"
          value={num(insight.orders)}
          tint="#7c5cbf"
          note={insight.orders ? `${money(avgOrder)} average per order` : undefined}
          href={ordersHref}
          hrefLabel="View orders"
        />
        <Kpi
          icon={Crown}
          label="Best seller"
          value={best?.name ?? "—"}
          tint="#e0a030"
          note={best ? `${money(best.revenue)} · ${bestShare.toFixed(1)}% of sales` : undefined}
        />
      </div>

      {isEmpty ? (
        <Card title="No sales in this period">
          <Empty />
        </Card>
      ) : (
        <>
          <Card title="Sales trend" subtitle={insight.trendBy === "day" ? "Per day" : "Per month"}>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={insight.trend} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
                  <defs>
                    <linearGradient id="pi-sales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2b7fc4" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#2b7fc4" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" />
                  <XAxis
                    dataKey="key"
                    tickFormatter={(k: string) => (insight.trendBy === "day" ? dayLabel(k) : monthLabel(k))}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    minTickGap={28}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => money(v)}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  />
                  <Tooltip
                    cursor={{ stroke: "var(--border)", strokeDasharray: "3 4" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0].payload as { key: string; revenue: number; units: number };
                      return (
                        <div className="min-w-[8rem] rounded-xl border border-white/10 bg-[#161616] px-3.5 py-2.5 shadow-xl shadow-black/50">
                          <p className="text-[11px] font-medium tracking-wide text-white/45 uppercase">
                            {insight.trendBy === "day" ? dayLabel(p.key) : monthLabel(p.key)}
                          </p>
                          <p className="mt-0.5 text-sm font-semibold text-white">{money(p.revenue)}</p>
                          <p className="text-xs text-white/60">{num(p.units)} units</p>
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#2b7fc4"
                    strokeWidth={2.5}
                    fill="url(#pi-sales)"
                    activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2, fill: "#2b7fc4" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Top products by sales" subtitle="Top 10">
              <HBars data={insight.topByRevenue.map((p) => ({ name: p.name, value: p.revenue }))} unit="$" format={money} />
            </Card>
            <Card title="Top products by units sold" subtitle="Top 10">
              <HBars data={insight.topByUnits.map((p) => ({ name: p.name, value: p.units }))} unit="units" />
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Sales by category">
              <Donut data={insight.byCategory} unit="sales" format={money} />
            </Card>
            <Card title="Sales by business">
              <Donut data={insight.byBrand} unit="sales" format={money} />
            </Card>
          </div>

          <Card title="Bought together" subtitle="Pairs of products that appear in the same order at least twice">
            {insight.pairs.length === 0 ? (
              <Empty />
            ) : (
              <ul className="space-y-3">
                {insight.pairs.map((p, i) => (
                  <li key={`${p.a}|${p.b}`} className="text-sm">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate font-medium">{p.a}</span>
                      <span className="text-muted-foreground">+</span>
                      <span className="truncate font-medium">{p.b}</span>
                      <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{num(p.count)} orders</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(p.count / pairMax) * 100}%`, background: PALETTE[i % PALETTE.length] }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
