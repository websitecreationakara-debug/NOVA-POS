"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FileSpreadsheet, Loader2, Search } from "lucide-react";
import type { Brand } from "@/types/database";
import { MONTH_NAMES, type MonthlyRow } from "@/lib/productInsight";
import { exportProductMonthlyAction } from "./actions";
import InsightTabs, { INSIGHT_VIEW_TITLES, type InsightView } from "./InsightTabs";

type MonthlyView = "quantity" | "price";
type SortKey = number | "sum" | "name"; // 0..11 = a month

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "Insight by Quantity" / "Insight by Price": a table of every product with its
// value for each month of the year, and a Sum column. Click a column to sort.
export default function ProductMonthlyClient({
  rows,
  year,
  years,
  brandId,
  brands,
  initialView,
}: {
  rows: MonthlyRow[];
  year: number;
  years: number[];
  brandId: string;
  brands: Brand[];
  initialView: MonthlyView;
}) {
  const router = useRouter();
  const [view, setView] = useState<MonthlyView>(initialView);
  const [search, setSearch] = useState("");
  const isPrice = view === "price";
  const valuesOf = (r: MonthlyRow) => (isPrice ? r.amount : r.qty);
  const money = (n: number) => (isPrice ? `$${fmt(n)}` : fmt(n));

  // Sorted by the latest month that has sales, biggest first, until a column is clicked.
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>(() => {
    let latest = -1;
    for (const r of rows) r.qty.forEach((v, m) => v > 0 && m > latest && (latest = m));
    return { key: latest >= 0 ? latest : "sum", dir: "desc" };
  });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) => !q || r.name.toLowerCase().includes(q));
    const val = (r: MonthlyRow): number | string => {
      const v = isPrice ? r.amount : r.qty;
      return sort.key === "name" ? r.name.toLowerCase() : sort.key === "sum" ? v.reduce((a, b) => a + b, 0) : v[sort.key];
    };
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
      return c * dir || a.name.localeCompare(b.name);
    });
  }, [rows, search, sort, isPrice]);

  const monthTotals = MONTH_NAMES.map((_, m) => shown.reduce((s, r) => s + valuesOf(r)[m], 0));
  const grandTotal = monthTotals.reduce((a, b) => a + b, 0);

  function clickSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "name" ? "asc" : "desc" }));
  }

  function go(patch: { year?: number; brand?: string; view?: InsightView }) {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", "product-insight");
    if (patch.view) params.set("view", patch.view);
    if (patch.year) params.set("year", String(patch.year));
    if (patch.brand !== undefined) {
      if (patch.brand) params.set("brand", patch.brand);
      else params.delete("brand");
    }
    router.push(`/marketing?${params.toString()}`, { scroll: false });
  }

  function switchView(next: InsightView) {
    if (next === "overview") return go({ view: "overview" });
    // Same data, so switching between quantity and price needs no new load.
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(window.history.state, "", url);
  }

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  async function exportExcel() {
    setExporting(true);
    setExportError(null);
    try {
      const { filename, mime, base64 } = await exportProductMonthlyAction({
        view,
        year,
        businessLabel: brands.find((b) => b.id === brandId)?.name ?? "",
        rows: shown,
      });
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const yearIndex = years.indexOf(year);
  const arrowClass =
    "inline-flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30";
  const th = "sticky top-0 z-10 bg-card px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap";
  const sortIcon = (k: SortKey) =>
    sort.key === k ? sort.dir === "desc" ? <ChevronDown className="ml-0.5 inline size-3.5" /> : <ChevronUp className="ml-0.5 inline size-3.5" /> : null;

  return (
    <div className="min-h-screen space-y-4 p-6">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-label="Breadcrumb">
        <span>Marketing</span>
        <ChevronRight className="size-3.5" />
        <span>Product Insight</span>
        <ChevronRight className="size-3.5" />
        <span className="font-medium text-foreground">{INSIGHT_VIEW_TITLES[view]}</span>
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <InsightTabs active={view} onChange={switchView} />

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search product"
              className="w-48 rounded-lg border border-border bg-transparent py-1.5 pr-3 pl-8 text-sm"
            />
          </div>
          <select
            aria-label="Business"
            value={brandId}
            onChange={(e) => go({ brand: e.target.value })}
            className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-foreground"
          >
            <option value="">All businesses</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous year"
              disabled={yearIndex < 0 || yearIndex >= years.length - 1}
              onClick={() => go({ year: years[yearIndex + 1] })}
              className={arrowClass}
            >
              <ChevronLeft className="size-4" />
            </button>
            <select
              aria-label="Year"
              value={year}
              onChange={(e) => go({ year: Number(e.target.value) })}
              className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm font-medium text-foreground"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Next year"
              disabled={yearIndex <= 0}
              onClick={() => go({ year: years[yearIndex - 1] })}
              className={arrowClass}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={exportExcel}
            disabled={exporting || shown.length === 0}
            title="Download this table as an Excel file"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
            Excel
          </button>
        </div>
      </div>
      {exportError && <p className="text-sm text-red-500">{exportError}</p>}

      <div className="max-h-[72vh] overflow-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full min-w-[60rem] border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-muted-foreground">
              <th className={`${th} left-0 z-20 min-w-[16rem] cursor-pointer border-b border-border`} onClick={() => clickSort("name")}>
                English Name
                {sortIcon("name")}
              </th>
              <th className={`${th} border-b border-border`}>Scale</th>
              {MONTH_NAMES.map((m, i) => (
                <th key={m} className={`${th} cursor-pointer border-b border-border text-right`} onClick={() => clickSort(i)}>
                  {m}
                  {sortIcon(i)}
                </th>
              ))}
              <th className={`${th} cursor-pointer border-b border-border text-right text-foreground`} onClick={() => clickSort("sum")}>
                {isPrice ? "Sum Price" : "Sum QTY"}
                {sortIcon("sum")}
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const v = valuesOf(r);
              const sum = v.reduce((a, b) => a + b, 0);
              return (
                <tr key={r.id} className="hover:bg-muted/60">
                  <td className="sticky left-0 z-[1] max-w-[22rem] truncate border-b border-border bg-card px-3 py-2 font-medium" title={r.name}>
                    {r.name}
                  </td>
                  <td className="border-b border-border px-3 py-2 whitespace-nowrap text-muted-foreground">{r.unit || "—"}</td>
                  {v.map((n, i) => (
                    <td
                      key={i}
                      className={`border-b border-border px-3 py-2 text-right whitespace-nowrap tabular-nums ${n === 0 ? "text-muted-foreground/50" : ""}`}
                    >
                      {money(n)}
                    </td>
                  ))}
                  <td className="border-b border-border px-3 py-2 text-right font-semibold whitespace-nowrap tabular-nums">{money(sum)}</td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={15} className="px-3 py-10 text-center text-muted-foreground">
                  {rows.length === 0 ? `No sales in ${year}.` : "No product matches your search."}
                </td>
              </tr>
            )}
          </tbody>
          {shown.length > 0 && (
            <tfoot>
              <tr className="font-semibold">
                <td className="sticky bottom-0 left-0 z-20 border-t border-border bg-card px-3 py-2.5">
                  Total ({shown.length.toLocaleString()} products)
                </td>
                <td className="sticky bottom-0 z-10 border-t border-border bg-card" />
                {monthTotals.map((n, i) => (
                  <td key={i} className="sticky bottom-0 z-10 border-t border-border bg-card px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                    {money(n)}
                  </td>
                ))}
                <td className="sticky bottom-0 z-10 border-t border-border bg-card px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                  {money(grandTotal)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
