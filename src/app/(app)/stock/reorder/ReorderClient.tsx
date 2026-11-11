"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, CircleDollarSign, Download, Info, PackageCheck, PackagePlus, RefreshCw, RotateCcw, Search, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import TopBarSlot from "@/components/TopBarSlot";
import { formatUsd } from "@/lib/formatNumber";
import { DEFAULT_LIMIT, DEFAULT_SETTINGS, suggestReorder, type ReorderSettings, type ReorderStatus, type Suggestion } from "@/lib/reorder";
import type { Brand } from "@/types/database";
import type { ReorderData } from "./data";
import { refreshReorderAction } from "./actions";

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

// Rows per page, picked in the footer and kept in the address (?page= and ?limit=).
const PAGE_SIZES = [10, 25, 50, 100];

const fmt = (n: number) => String(Math.round(n * 100) / 100);

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
  // How old the figures are, and the Refresh button. The age is only worked out in the browser (after mount), so it
  // can't differ from the server's HTML.
  const [ageMin, setAgeMin] = useState<number | null>(null);
  const [refreshing, startRefresh] = useTransition();
  useEffect(() => {
    const update = () => setAgeMin(Math.max(0, Math.floor((Date.now() - data.computedAt) / 60000)));
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [data.computedAt]);

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

  const all = useMemo(
    () => data.products.map((p) => ({ p, s: suggestReorder(p, settings, Number(onOrder[p.id]) || 0) })),
    [data.products, settings, onOrder]
  );
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const order: Record<ReorderStatus, number> = { buy: 0, enough: 1, no_sales: 2, not_enough_data: 3, untracked: 4 };
    return all
      .filter(
        ({ p, s }) =>
          (!onlyBuy || s.status === "buy") && (!q || p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q))
      )
      .sort(
        (a, b) =>
          order[a.s.status] - order[b.s.status] || (a.s.daysLeft ?? 1e9) - (b.s.daysLeft ?? 1e9) || a.p.name.localeCompare(b.p.name)
      );
  }, [all, search, onlyBuy]);

  // The summary cards count every product of the business; the table and the CSV follow the search.
  const toBuyAll = all.filter((r) => r.s.status === "buy");
  const totalCost = toBuyAll.reduce((sum, r) => sum + (r.s.cost ?? 0), 0);
  const unknownCost = toBuyAll.filter((r) => r.s.cost === null).length;
  const enoughCount = all.filter((r) => r.s.status === "enough").length;
  const runningOut = toBuyAll.filter((r) => r.s.daysLeft !== null && r.s.daysLeft < 7).length;
  const toBuy = rows.filter((r) => r.s.status === "buy");

  // The page and rows per page live in the address (?page=2&limit=50), so a page can be shared or reloaded and Back
  // returns to the page before. The list is worked out here from the settings, so paging only slices it.
  const searchParams = useSearchParams();
  const limit = PAGE_SIZES.includes(Number(searchParams.get("limit"))) ? Number(searchParams.get("limit")) : DEFAULT_LIMIT;
  const requestedPage = Math.floor(Number(searchParams.get("page"))) || 1;
  const pageCount = Math.max(1, Math.ceil(rows.length / limit));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const pageRows = rows.slice((page - 1) * limit, page * limit);

  function setPaging(next: { page: number; limit?: number }, mode: "push" | "replace" = "push") {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(next.page));
    params.set("limit", String(next.limit ?? limit));
    window.history[mode === "push" ? "pushState" : "replaceState"](null, "", `?${params}`);
  }
  // A new search, filter or setting changes which products there are: back to page 1 (without a Back step for it).
  function firstPage() {
    if (requestedPage !== 1) setPaging({ page: 1 }, "replace");
  }

  function setNumber(key: keyof ReorderSettings, value: string) {
    const n = Number(value);
    setSettings((s) => ({ ...s, [key]: Number.isFinite(n) && n >= 0 ? n : 0 }));
    firstPage();
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
          onChange={(e) => router.push(`/stock/reorder?brand=${e.target.value}&page=1&limit=${limit}`)}
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

      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Reorder Suggestions</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            What to buy so you never run short for your customers, worked out from the last 90 days of sales.
          </p>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            {ageMin === null ? "Up to date" : ageMin < 1 ? "Updated just now" : `Updated ${ageMin} min ago`}
            <button
              type="button"
              disabled={refreshing}
              onClick={() =>
                startRefresh(async () => {
                  await refreshReorderAction(currentBrandId);
                  router.refresh();
                })
              }
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-brand transition-colors hover:bg-brand/10 disabled:opacity-60"
            >
              <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /> {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </p>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={<PackagePlus className="size-5" />}
            tint="bg-amber-500/10 text-amber-600 dark:text-amber-400"
            label="Products to buy"
            value={String(toBuyAll.length)}
            hint={`${data.withoutSales} had no sales in 90 days`}
          />
          <StatCard
            icon={<CircleDollarSign className="size-5" />}
            tint="bg-sky-500/10 text-sky-600 dark:text-sky-400"
            label="Estimated purchase cost"
            value={formatUsd(totalCost)}
            hint={unknownCost > 0 ? `${unknownCost} without a cost price` : "At each product's cost"}
          />
          <StatCard
            icon={<PackageCheck className="size-5" />}
            tint="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            label="Enough stock"
            value={String(enoughCount)}
            hint="Covered for the days you chose"
          />
          <StatCard
            icon={<TriangleAlert className="size-5" />}
            tint="bg-red-500/10 text-red-600 dark:text-red-400"
            label="Running out (< 7 days)"
            value={String(runningOut)}
            hint="Buy these first"
          />
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-end gap-4">
            <NumberField label="Days to cover" suffix="days" value={settings.coverDays} onChange={(v) => setNumber("coverDays", v)} />
            <NumberField label="Supplier delivery" suffix="days" value={settings.leadDays} onChange={(v) => setNumber("leadDays", v)} />
            <NumberField label="Safety stock" suffix="days" value={settings.safetyDays} onChange={(v) => setNumber("safetyDays", v)} />
            <button
              type="button"
              onClick={() => {
                setSettings(DEFAULT_SETTINGS);
                firstPage();
              }}
              className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <RotateCcw className="size-4" /> Reset
            </button>
            <div className="ml-auto hidden max-w-md rounded-xl bg-muted/60 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground lg:block">
              <span className="font-semibold text-foreground">Target</span> = avg daily sales × ({settings.coverDays} +{" "}
              {settings.leadDays} + {settings.safetyDays} days). <span className="font-semibold text-foreground">Buy</span> = target
              − stock − on order.
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[14rem] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  firstPage();
                }}
                placeholder="Search product or SKU"
                className="h-11 w-full rounded-xl border border-border bg-card pr-3 pl-10 text-sm shadow-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </div>
            <div className="inline-flex h-11 rounded-xl border border-border bg-card p-1 shadow-sm" role="group" aria-label="Show">
              {[
                { value: true, label: "To buy" },
                { value: false, label: "All products" },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  aria-pressed={onlyBuy === o.value}
                  onClick={() => {
                    setOnlyBuy(o.value);
                    firstPage();
                  }}
                  className={`rounded-lg px-4 text-sm font-medium transition-colors ${
                    onlyBuy === o.value ? "bg-brand text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={toBuy.length === 0}
              onClick={downloadCsv}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-medium shadow-sm transition-colors hover:bg-muted disabled:opacity-50"
            >
              <Download className="size-4" /> Download order list
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[60rem] border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  {[
                    ["Product", ""],
                    ["Stock", "text-right"],
                    ["Avg / day", "text-right"],
                    ["Days left", ""],
                    ["Trend", ""],
                    ["Want", "text-right"],
                    ["On order", "text-right"],
                    ["Suggested buy", "text-right"],
                    ["Est. cost", "text-right"],
                    ["Status", ""],
                  ].map(([label, align]) => (
                    <th key={label} className={`border-b border-border bg-muted/90 px-4 py-3 backdrop-blur ${align}`}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-16 text-center">
                      <div className="mx-auto flex max-w-xs flex-col items-center gap-2 text-muted-foreground">
                        <PackageCheck className="size-8 opacity-60" />
                        <p className="text-sm font-medium text-foreground">
                          {data.products.length === 0
                            ? "No products sold in the last 90 days"
                            : onlyBuy && !search
                              ? "Nothing to buy right now"
                              : "Nothing matches"}
                        </p>
                        {onlyBuy && data.products.length > 0 && (
                          <p className="text-xs">Switch to “All products” to see every product that sold.</p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                {pageRows.map(({ p, s }) => (
                  <tr key={p.id} className="group transition-colors hover:bg-muted/50">
                    <td className="border-b border-border px-4 py-3 group-last:border-0">
                      <div className="font-medium text-foreground">{p.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        {p.sku && <span className="rounded bg-muted px-1.5 py-px font-mono">{p.sku}</span>}
                        {p.source === "stock" && <span className="rounded bg-muted px-1.5 py-px">Stock</span>}
                        {s.stockBelowZero && (
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <TriangleAlert className="size-3" /> stock below 0, check the ledger
                          </span>
                        )}
                      </div>
                    </td>
                    <td
                      className={`border-b border-border px-4 py-3 text-right tabular-nums group-last:border-0 ${
                        s.stockBelowZero ? "text-amber-600 dark:text-amber-400" : ""
                      }`}
                    >
                      {p.tracked ? fmt(p.stock) : "—"}
                    </td>
                    <td className="border-b border-border px-4 py-3 text-right tabular-nums group-last:border-0">
                      {s.dailyRate === null ? "—" : fmt(s.dailyRate)}
                    </td>
                    <td className="border-b border-border px-4 py-3 group-last:border-0">
                      <DaysLeft days={s.daysLeft} />
                    </td>
                    <td className="border-b border-border px-4 py-3 group-last:border-0">
                      <Trend pct={s.trendPct} />
                    </td>
                    <td className="border-b border-border px-4 py-3 text-right tabular-nums text-muted-foreground group-last:border-0">
                      {s.status === "buy" || s.status === "enough" ? fmt(s.target) : "—"}
                    </td>
                    <td className="border-b border-border px-4 py-3 text-right group-last:border-0">
                      <input
                        className="h-9 w-20 rounded-lg border border-border bg-background px-2 text-right text-sm tabular-nums outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                        inputMode="decimal"
                        aria-label={`On order for ${p.name}`}
                        value={onOrder[p.id] ?? ""}
                        placeholder="0"
                        onChange={(e) => setOnOrder((o) => ({ ...o, [p.id]: e.target.value }))}
                      />
                    </td>
                    <td className="border-b border-border px-4 py-3 text-right group-last:border-0">
                      {s.status === "buy" ? (
                        <span className="inline-block rounded-lg bg-brand/10 px-2.5 py-1 font-semibold whitespace-nowrap text-brand tabular-nums">
                          {buyText(s, p.caseSize)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="border-b border-border px-4 py-3 text-right tabular-nums text-muted-foreground group-last:border-0">
                      {s.cost === null ? "—" : formatUsd(s.cost)}
                    </td>
                    <td className="border-b border-border px-4 py-3 group-last:border-0">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${STATUS_STYLE[s.status]}`}
                      >
                        <span className="size-1.5 rounded-full bg-current opacity-70" />
                        {STATUS_LABEL[s.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 text-sm">
              <span className="text-xs text-muted-foreground">
                {rows.length === 0
                  ? "No products"
                  : `${(page - 1) * limit + 1}–${Math.min(page * limit, rows.length)} of ${rows.length} product${rows.length === 1 ? "" : "s"}`}
                {search.trim() ? ` matching "${search.trim()}"` : ""}
              </span>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Per page
                  <select
                    value={limit}
                    onChange={(e) => setPaging({ page: 1, limit: Number(e.target.value) })}
                    className="h-8 rounded-lg border border-border bg-card px-2 text-xs text-foreground"
                  >
                    {PAGE_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => setPaging({ page: page - 1 })}
                  disabled={page <= 1}
                  className="flex h-8 items-center gap-1 rounded-lg border border-border px-3 text-xs transition hover:bg-muted disabled:opacity-30"
                >
                  <ChevronLeft className="size-3.5" />
                  Prev
                </button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  Page {page} of {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPaging({ page: page + 1 })}
                  disabled={page >= pageCount}
                  className="flex h-8 items-center gap-1 rounded-lg border border-border px-3 text-xs transition hover:bg-muted disabled:opacity-30"
                >
                  Next
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>
          </div>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Sales, stock (the Ending), cost and Units / case come from the <span className="font-medium">Daily Ledger</span>; a month
              whose Begining stock isn&apos;t typed yet carries on from the month before. Products that aren&apos;t in the ledger use
              Stock and POS orders (marked <span className="font-medium">Stock</span>). A negative stock counts as 0, and quantities are
              rounded up to whole cases.
            </span>
          </p>
        </section>
      </div>
    </>
  );
}

function StatCard({
  icon,
  tint,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  tint: string;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${tint}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-2xl font-semibold tracking-tight text-foreground tabular-nums">{value}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function NumberField({
  label,
  suffix,
  value,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      <span className="relative">
        <input
          className="h-10 w-32 rounded-lg border border-border bg-background pr-12 pl-3 text-sm text-foreground tabular-nums outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>
      </span>
    </label>
  );
}

// Days the stock lasts at the current sales: red under a week, amber under two, green after that.
function DaysLeft({ days }: { days: number | null }) {
  if (days === null) return <span className="text-muted-foreground">—</span>;
  const bar = days < 7 ? "bg-red-500" : days < 14 ? "bg-amber-500" : "bg-emerald-500";
  const text =
    days < 7
      ? "text-red-600 dark:text-red-400"
      : days < 14
        ? "text-amber-600 dark:text-amber-400"
        : "text-emerald-600 dark:text-emerald-400";
  return (
    <div className="flex min-w-24 flex-col gap-1">
      <span className={`text-sm font-semibold tabular-nums ${text}`}>{fmt(days)}</span>
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <span className={`block h-full rounded-full ${bar}`} style={{ width: `${Math.max(4, Math.min(100, (days / 30) * 100))}%` }} />
      </span>
    </div>
  );
}

function Trend({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground">—</span>;
  if (pct === 0) return <span className="text-muted-foreground tabular-nums">0%</span>;
  const up = pct > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
        up ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"
      }`}
    >
      <Icon className="size-3.5" /> {Math.abs(pct)}%
    </span>
  );
}
