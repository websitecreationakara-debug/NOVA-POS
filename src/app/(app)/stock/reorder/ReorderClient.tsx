"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Search } from "lucide-react";
import TopBarSlot from "@/components/TopBarSlot";
import { formatUsd } from "@/lib/formatNumber";
import { DEFAULT_SETTINGS, suggestReorder, type ReorderSettings, type ReorderStatus, type Suggestion } from "@/lib/reorder";
import type { Brand } from "@/types/database";
import type { ReorderData } from "./data";

const SETTINGS_KEY = "nova:reorder-settings";
const ON_ORDER_KEY = "nova:reorder-on-order";

const STATUS_LABEL: Record<ReorderStatus, string> = {
  buy: "Buy",
  enough: "Enough stock",
  no_sales: "No sales",
  not_enough_data: "Not enough data",
  untracked: "Stock not tracked",
};
const STATUS_STYLE: Record<ReorderStatus, string> = {
  buy: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  enough: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  no_sales: "bg-muted text-muted-foreground",
  not_enough_data: "bg-muted text-muted-foreground",
  untracked: "bg-muted text-muted-foreground",
};

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const input =
  "h-9 w-20 rounded-lg border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function ReorderClient({
  brands,
  currentBrandId,
  data,
}: {
  brands: Brand[];
  currentBrandId: string;
  data: ReorderData;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState<ReorderSettings>(DEFAULT_SETTINGS);
  // Stock already on order from a supplier, typed here per product (kept in this browser; invoices add stock when
  // they are saved, so nothing is "on order" until you say so).
  const [onOrder, setOnOrder] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [onlyBuy, setOnlyBuy] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Restoring what this browser remembered after mount; reading storage during render would differ from the server HTML.
    /* eslint-disable react-hooks/set-state-in-effect */
    setSettings(readStored(SETTINGS_KEY, DEFAULT_SETTINGS));
    setOnOrder(readStored<Record<string, string>>(ON_ORDER_KEY, {}));
    setLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      localStorage.setItem(ON_ORDER_KEY, JSON.stringify(onOrder));
    } catch {
      // storage unavailable: the page still works, it just won't remember
    }
  }, [settings, onOrder, loaded]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const order: Record<ReorderStatus, number> = { buy: 0, enough: 1, no_sales: 2, not_enough_data: 3, untracked: 4 };
    return data.products
      .map((p) => ({ p, s: suggestReorder(p, settings, Number(onOrder[p.id]) || 0) }))
      .filter(
        ({ p, s }) =>
          (!onlyBuy || s.status === "buy") && (!q || p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q))
      )
      .sort(
        (a, b) =>
          order[a.s.status] - order[b.s.status] || (a.s.daysLeft ?? 1e9) - (b.s.daysLeft ?? 1e9) || a.p.name.localeCompare(b.p.name)
      );
  }, [data.products, settings, onOrder, search, onlyBuy]);

  const toBuy = rows.filter((r) => r.s.status === "buy");
  const totalCost = toBuy.reduce((sum, r) => sum + (r.s.cost ?? 0), 0);
  const unknownCost = toBuy.filter((r) => r.s.cost === null).length;

  function setNumber(key: keyof ReorderSettings, value: string) {
    const n = Number(value);
    setSettings((s) => ({ ...s, [key]: Number.isFinite(n) && n >= 0 ? n : 0 }));
  }

  function downloadCsv() {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [
      ["SKU", "Product", "Stock", "Avg per day", "Suggested buy (units)", "Cases", "Unit cost", "Estimated cost"].map(esc).join(","),
    ];
    for (const { p, s } of toBuy) {
      lines.push(
        [p.sku ?? "", p.name, p.stock, s.dailyRate ?? "", s.buyUnits, s.cases ?? "", p.unitCost ?? "", s.cost ?? ""].map(esc).join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reorder-${data.today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const buyText = (s: Suggestion, caseSize: number | null) =>
    s.status !== "buy"
      ? "—"
      : s.cases !== null && caseSize
        ? `${s.cases} case${s.cases === 1 ? "" : "s"} × ${fmt(caseSize)} = ${s.buyUnits}`
        : String(s.buyUnits);

  return (
    <>
      <TopBarSlot>
        <select
          value={currentBrandId}
          onChange={(e) => router.push(`/stock/reorder?brand=${e.target.value}`)}
          className="h-9 rounded-lg border border-border bg-card px-3 text-sm"
          aria-label="Business"
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <h1 className="hidden items-center gap-2 text-sm sm:flex">
          <Link href={`/stock?brand=${currentBrandId}`} className="text-muted-foreground hover:underline">
            Stock
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-semibold text-foreground">Reorder Suggestions</span>
        </h1>
      </TopBarSlot>

      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Reorder Suggestions</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            How much to buy so there is enough stock. Average daily sales over the look-back (days with no stock aren&apos;t
            counted) × the days to cover, plus the safety stock, minus the stock you have and what is already on order, rounded
            up to whole cases.
          </p>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            Sales, stock (the Ending), cost and Units / case come from the <span className="font-medium">Daily Ledger</span>; a month
            whose Begining stock isn&apos;t typed yet carries on from the month before. Products that aren&apos;t in the ledger use
            Stock and POS orders (marked <span className="font-medium">Stock</span>). A negative stock counts as 0.
          </p>
        </div>

        <section className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Look back
            <select
              value={settings.windowDays}
              onChange={(e) => setNumber("windowDays", e.target.value)}
              className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
            >
              {[30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  Last {d} days
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Days to cover
            <input className={input} inputMode="numeric" value={settings.coverDays} onChange={(e) => setNumber("coverDays", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Safety stock (%)
            <input className={input} inputMode="numeric" value={settings.safetyPct} onChange={(e) => setNumber("safetyPct", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Supplier delivery (days)
            <input className={input} inputMode="numeric" value={settings.leadDays} onChange={(e) => setNumber("leadDays", e.target.value)} />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => setSettings(DEFAULT_SETTINGS)}
              className="h-9 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:bg-muted"
            >
              Reset to default
            </button>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search product or SKU"
              className="h-10 w-full rounded-lg border border-border bg-background pr-3 pl-9 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={onlyBuy} onChange={(e) => setOnlyBuy(e.target.checked)} />
            Only products to buy
          </label>
          <button
            type="button"
            disabled={toBuy.length === 0}
            onClick={downloadCsv}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            <Download className="size-4" /> Download order list
          </button>
        </div>

        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{toBuy.length}</span> product{toBuy.length === 1 ? "" : "s"} to buy
          {totalCost > 0 && (
            <>
              {" "}
              · about <span className="font-medium text-foreground">{formatUsd(totalCost)}</span>
              {unknownCost > 0 && ` (${unknownCost} without a cost price)`}
            </>
          )}
          {data.withoutSales > 0 && ` · ${data.withoutSales} products had no sales in the last 90 days and are left out`}
        </p>

        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <th className="px-3 py-2.5">Product</th>
                <th className="px-3 py-2.5 text-right">Stock</th>
                <th className="px-3 py-2.5 text-right">Avg / day</th>
                <th className="px-3 py-2.5 text-right">Days left</th>
                <th className="px-3 py-2.5 text-right">Trend</th>
                <th className="px-3 py-2.5 text-right">Want</th>
                <th className="px-3 py-2.5 text-right">On order</th>
                <th className="px-3 py-2.5 text-right">Suggested buy</th>
                <th className="px-3 py-2.5 text-right">Est. cost</th>
                <th className="px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-muted-foreground">
                    {data.products.length === 0 ? "No products sold in the last 90 days." : "Nothing matches."}
                  </td>
                </tr>
              )}
              {rows.map(({ p, s }) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-medium">{p.name}</div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      {p.sku && <span className="font-mono">{p.sku}</span>}
                      {p.source === "stock" && <span className="rounded bg-muted px-1.5 py-px">Stock</span>}
                      {s.stockBelowZero && <span className="text-amber-600">stock below 0: check the ledger</span>}
                    </div>
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${s.stockBelowZero ? "text-amber-600" : ""}`}>{p.tracked ? fmt(p.stock) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.dailyRate === null ? "—" : fmt(s.dailyRate)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${s.daysLeft !== null && s.daysLeft < 7 ? "font-semibold text-red-600" : ""}`}>
                    {s.daysLeft === null ? "—" : fmt(s.daysLeft)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {s.trendPct === null ? "—" : `${s.trendPct > 0 ? "▲" : s.trendPct < 0 ? "▼" : ""} ${Math.abs(s.trendPct)}%`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {s.status === "buy" || s.status === "enough" ? fmt(s.target) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      className="h-8 w-16 rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums outline-none focus:border-brand"
                      inputMode="decimal"
                      value={onOrder[p.id] ?? ""}
                      placeholder="0"
                      onChange={(e) => setOnOrder((o) => ({ ...o, [p.id]: e.target.value }))}
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{buyText(s, p.caseSize)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{s.cost === null ? "—" : formatUsd(s.cost)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[s.status]}`}>{STATUS_LABEL[s.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
