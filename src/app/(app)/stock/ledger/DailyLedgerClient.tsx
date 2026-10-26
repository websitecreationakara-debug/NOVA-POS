"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, FileSpreadsheet, Loader2, Plus, Search, Trash2, TriangleAlert } from "lucide-react";
import TopBarSlot from "@/components/TopBarSlot";
import { applyLedgerEntry, daysOfMonth, LEDGER_TEXT_FIELDS, recalcRow, type DailyLedgerRow } from "@/lib/dailyLedger";
import { formatUsd } from "@/lib/formatNumber";
import { ENGLISH_SCALES } from "@/lib/khmerScales";
import type { Brand } from "@/types/database";
import type { WebsiteCatalogId } from "@/lib/websiteProducts/types";
import { deactivateProductAction } from "../actions";
import {
  deleteWebsiteAddonAction,
  deleteWebsiteProductAction,
  deleteWebsiteProductVariationAction,
} from "../websiteActions";
import {
  createLedgerProductAction,
  deleteLedgerProductAction,
  exportDailyLedgerAction,
  hideRemovedLedgerProductAction,
  setLedgerEntryAction,
} from "./actions";

// Column widths (px). The first five columns stay put while the days scroll, and so do the month
// totals on the right, so each sticky cell needs its own offset.
// Only SKU and Name stay put while the days scroll; the price/cost columns after them scroll away.
const W = { sku: 96, name: 220, weight: 130, unit: 64, price: 76, exDate: 84, loka: 92, tc10: 76, totalCost: 84, begin: 84, dayCol: 48 };
const LEFT = { sku: 0, name: W.sku };
const FROZEN = W.sku + W.name;
const LEFT_COLUMNS = 10;
const TW = { totalIn: 72, totalSold: 76, totalOther: 76, ending: 72, value: 96 };
const RIGHT = {
  value: 0,
  ending: TW.value,
  totalOther: TW.value + TW.ending,
  totalSold: TW.value + TW.ending + TW.totalOther,
  totalIn: TW.value + TW.ending + TW.totalOther + TW.totalSold,
};

// The Category pick that means "type a new category".
const NEW_CATEGORY = "\u0000new";

const WEEKDAYS =["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmt = (n: number) => String(Math.round(n * 100) / 100);

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// What a cell holds, as text, for its box when it is typed into.
function rawValue(r: DailyLedgerRow, field: string): string {
  switch (field) {
    case "sku":
      return r.sku ?? "";
    case "weight":
      return r.size;
    case "unit":
      return r.unit;
    case "ex_date":
      return r.exDate;
    case "unit_price":
      return String(r.unitPrice);
    case "s_price_loka":
      return r.originalCost === null ? "" : String(r.originalCost);
    case "tc10":
      return r.cost10 === null ? "" : String(r.cost10);
    case "total_cost":
      return r.totalCost === null ? "" : String(r.totalCost);
    case "begin":
      return String(r.begin);
    default: {
      const m = /^([pso]):(\d{2})$/.exec(field);
      if (!m) return "";
      const v = r.days[Number(m[2]) - 1]?.[m[1] as "p" | "s" | "o"] ?? 0;
      return v === 0 ? "" : String(v);
    }
  }
}

export default function DailyLedgerClient({
  brands,
  currentBrandId,
  month,
  today,
  rows,
}: {
  brands: Brand[];
  currentBrandId: string;
  month: string;
  today: string;
  rows: DailyLedgerRow[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [exporting, setExporting] = useState(false);
  // The removed product whose Delete popup is open, and whether it is being deleted.
  const [deleting, setDeleting] = useState<DailyLedgerRow | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The "Add product" popup: a new product for this business (a POS-only product, like Stock's).
  const [adding, setAdding] = useState(false);
  const [addPending, setAddPending] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("pcs");
  const [newPrice, setNewPrice] = useState("");
  // "" = no category (Added in ledger), NEW_CATEGORY = type a new one, else an existing category's name.
  const [newCategory, setNewCategory] = useState("");
  const [newCategoryText, setNewCategoryText] = useState("");
  // The rows as shown: what the page worked out, with what was typed into the ledger applied. They
  // are replaced whenever the page sends fresh ones.
  const [stateRows, setLocalRows] = useState(rows);
  const [prevRows, setPrevRows] = useState(rows);
  if (rows !== prevRows) {
    setPrevRows(rows);
    setLocalRows(rows);
  }
  // The rest of this render still runs before React redoes it with the new state, so it must already
  // use the new rows: old ones have the old month's number of days (31 vs 28/30) and `days[i]` breaks.
  const localRows = rows !== prevRows ? rows : stateRows;
  // The cell being typed into, and whether Escape was pressed to throw the typing away.
  const [editing, setEditing] = useState<{ id: string; field: string } | null>(null);
  const cancelEdit = useRef(false);
  const todayRef = useRef<HTMLTableCellElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const days = useMemo(() => daysOfMonth(month), [month]);
  // The categories already in the ledger, for the Add product popup (not the catch-all groups).
  const categoryOptions = useMemo(
    () =>
      [...new Set(localRows.map((r) => r.categoryName))]
        .filter((c) => c && c !== "Removed from Stock" && c !== "Added in ledger")
        .sort((a, b) => a.localeCompare(b)),
    [localRows]
  );
  const thisMonth = today.slice(0, 7);

  async function addProduct() {
    const name = newName.trim();
    if (!name) {
      setAddError("Type the product name");
      return;
    }
    const category = newCategory === NEW_CATEGORY ? newCategoryText.trim() : newCategory;
    if (newCategory === NEW_CATEGORY && !category) {
      setAddError("Type the new category name");
      return;
    }
    setAddPending(true);
    setAddError(null);
    try {
      await createLedgerProductAction({
        brandId: currentBrandId,
        name,
        price: Number(newPrice) || 0,
        unit: newUnit,
        category,
        month,
      });
      setAdding(false);
      setNewName("");
      setNewUnit("pcs");
      setNewPrice("");
      setNewCategory("");
      setNewCategoryText("");
      router.refresh();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Couldn't add the product");
    } finally {
      setAddPending(false);
    }
  }

  function go(nextMonth: string, brandId = currentBrandId) {
    router.push(`/stock/ledger?brand=${brandId}&month=${nextMonth}`);
  }

  // Puts today's column right next to the frozen columns on the left.
  function scrollToToday(smooth: boolean) {
    const scroller = scrollerRef.current;
    const th = todayRef.current;
    if (!scroller || !th) return;
    scroller.scrollTo({ left: th.offsetLeft - FROZEN, behavior: smooth ? "smooth" : "auto" });
  }

  // Opens on today's column when it's the current month.
  useEffect(() => {
    if (month === thisMonth) scrollToToday(false);
  }, [month, thisMonth]);

  const q = filter.trim().toLowerCase();
  const groups = useMemo(() => {
    const visible = localRows.filter(
      (r) =>
        !q ||
        r.name.toLowerCase().includes(q) ||
        r.size.toLowerCase().includes(q) ||
        (r.sku ?? "").toLowerCase().includes(q) ||
        r.categoryName.toLowerCase().includes(q)
    );
    // Business first (in the dropdown's order), then category.
    const brandIndex = (id: string | undefined) => brands.findIndex((b) => b.id === id);
    const byCategory = new Map<string, { brandId: string | undefined; name: string; items: DailyLedgerRow[] }>();
    for (const r of visible) {
      const key = `${r.brandId}|${r.categoryName}`;
      const g = byCategory.get(key) ?? { brandId: r.brandId, name: r.categoryName, items: [] };
      g.items.push(r);
      byCategory.set(key, g);
    }
    return [...byCategory.values()]
      .sort((a, b) => brandIndex(a.brandId) - brandIndex(b.brandId) || a.name.localeCompare(b.name))
      .map((g) => ({ ...g, items: g.items.sort((a, b) => a.name.localeCompare(b.name) || a.size.localeCompare(b.size)) }));
  }, [localRows, q, brands]);
  const showBrands = currentBrandId === "all";
  const brandName = (id: string | undefined) => brands.find((b) => b.id === id)?.name ?? "";
  const brandValue = (id: string | undefined) =>
    groups.filter((g) => g.brandId === id).reduce((sum, g) => sum + g.items.reduce((s, r) => s + (r.endingValue ?? 0), 0), 0);
  const totalEndingValue = groups.reduce(
    (sum, g) => sum + g.items.reduce((s, r) => s + (r.endingValue ?? 0), 0),
    0
  );

  // Saves what was typed into a cell: shown at once (R and the totals are worked out again here),
  // kept in the ledger's own table, and an emptied cell goes back to the worked-out number.
  async function commit(row: DailyLedgerRow, field: string, raw: string) {
    setEditing(null);
    if (cancelEdit.current) {
      cancelEdit.current = false;
      return;
    }
    const value = raw.trim();
    if (value === rawValue(row, field)) return;
    if (value !== "" && !LEDGER_TEXT_FIELDS.includes(field) && !Number.isFinite(Number(value))) {
      setError("Type a number");
      return;
    }
    setError(null);
    if (value !== "") {
      setLocalRows((prev) =>
        prev.map((r) => {
          if (r.productId !== row.productId) return r;
          const copy = structuredClone(r);
          applyLedgerEntry(copy, field, value);
          return recalcRow(copy);
        })
      );
    }
    try {
      await setLedgerEntryAction({ productId: row.productId, month, field, value: value === "" ? null : value, site: row.site });
      // A product made just now gets its real id (and, for a cleared cell, its worked-out number) from a fresh load.
      if (value === "" || row.site) router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that");
      router.refresh();
    }
  }

  const isEditing = (r: DailyLedgerRow, field: string) => editing?.id === r.productId && editing.field === field;
  const cellProps = (r: DailyLedgerRow, field: string) => ({
    "data-id": r.productId,
    "data-f": field,
    title: r.edited.includes(field)
      ? "Typed in -- clear the box to go back to the worked-out value"
      : "Click to type a value",
  });
  const typedTint = (r: DailyLedgerRow, field: string) =>
    (r.edited.includes(field) ? "bg-blue-50/70 dark:bg-blue-950/30 " : "") + "cursor-text";
  const editor = (r: DailyLedgerRow, field: string, align: "left" | "right") => (
    <input
      autoFocus
      defaultValue={rawValue(r, field)}
      type={field === "ex_date" ? "date" : "text"}
      inputMode={LEDGER_TEXT_FIELDS.includes(field) ? "text" : "decimal"}
      onFocus={(e) => {
        if (field === "ex_date") {
          try {
            e.target.showPicker();
          } catch {
            /* the browser only opens the picker from a user gesture */
          }
        } else e.target.select();
      }}
      onBlur={(e) => void commit(r, field, e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          cancelEdit.current = true;
          e.currentTarget.blur();
        }
      }}
      className={`w-full min-w-0 rounded border border-brand bg-card px-1 py-0.5 text-[13px] text-foreground outline-none ${
        align === "right" ? "text-right" : "text-left"
      }`}
    />
  );

  // The popup's wording for a row, the same as Stock's for that kind of product.
  function deleteCopy(row: DailyLedgerRow) {
    const d = row.deletion;
    const name = row.name ? `“${row.name}”` : "this product";
    if (d.kind === "ledger") return `Removes ${name} from the Daily Ledger. This can’t be undone.`;
    if (d.kind === "own") return `Removes ${name} and everything typed into it from the Daily Ledger. This can’t be undone.`;
    if (d.kind === "pos") return `Removes ${name} from the POS (Stock and Sales). This can’t be undone.`;
    if (d.kind === "size") return `Removes ${d.sizeLabel ? `“${d.sizeLabel}”` : "this size"} of ${name} from the website. This can’t be undone.`;
    return `Removes ${name} from the website. This can’t be undone.`;
  }

  async function confirmDelete(row: DailyLedgerRow) {
    setDeletePending(true);
    try {
      const d = row.deletion;
      if (d.kind === "ledger" || d.kind === "own") {
        if (d.kind === "own") await deleteLedgerProductAction({ productId: row.productId });
        else await hideRemovedLedgerProductAction({ productId: row.productId });
        setLocalRows((prev) => prev.filter((r) => r.productId !== row.productId));
      } else {
        if (d.kind === "pos") await deactivateProductAction({ productId: row.productId });
        else if (d.kind === "addon") await deleteWebsiteAddonAction(d.catalogId as WebsiteCatalogId, d.addonId);
        else if (d.kind === "size")
          await deleteWebsiteProductVariationAction(d.catalogId as WebsiteCatalogId, d.productId, d.variationId);
        else await deleteWebsiteProductAction(d.catalogId as WebsiteCatalogId, d.productId);
        // It is out of Stock now, so a fresh load moves its row to "Removed from Stock".
        router.refresh();
      }
      setDeleting(null);
    } catch (e) {
      setDeleting(null);
      setError(e instanceof Error ? e.message : "Couldn't delete that");
    } finally {
      setDeletePending(false);
    }
  }

  async function exportExcel() {
    setExporting(true);
    setError(null);
    try {
      const { filename, mime, base64 } = await exportDailyLedgerAction(currentBrandId, month);
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
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  // Frozen cells need a solid background so the scrolling days do not show through them.
  const sticky = "sticky z-10";
  const headBase =
    "border-b-2 border-border bg-muted px-2.5 py-2 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase";
  const subHead = "border-b border-border bg-muted px-1 py-1 text-center text-[10.5px] font-semibold text-muted-foreground";
  const cellBase = "border-b border-border/70 px-2.5 py-2 whitespace-nowrap";
  const colSpanAll = LEFT_COLUMNS + days.length * 4 + 5;
  const dash = <span className="text-muted-foreground/50">—</span>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBarSlot>
        <select
          aria-label="Business"
          className="min-w-0 max-w-[10.5rem] rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground sm:max-w-none"
          value={currentBrandId}
          onChange={(e) => go(month, e.target.value)}
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <h1 className="hidden items-center gap-2 text-sm sm:flex">
          <Link href={showBrands ? "/stock" : `/stock?brand=${currentBrandId}`} className="text-muted-foreground hover:underline">
            Stock
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-semibold text-foreground">Daily Ledger</span>
        </h1>
      </TopBarSlot>

      <div className="flex flex-wrap items-center gap-3 px-4 pt-4 sm:px-6">
        <div className="flex items-center rounded-lg border border-border bg-card shadow-sm">
          <button
            type="button"
            onClick={() => go(shiftMonth(month, -1))}
            aria-label="Previous month"
            className="rounded-l-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
          {/* The label is the button: a transparent month input on top opens the browser's month/year picker. */}
          <label className="relative min-w-36 cursor-pointer px-3 text-center text-sm font-semibold hover:bg-muted">
            {monthLabel(month)}
            <input
              type="month"
              aria-label="Pick a month"
              value={month}
              onChange={(e) => {
                if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) go(e.target.value);
              }}
              onClick={(e) => {
                try {
                  e.currentTarget.showPicker();
                } catch {
                  /* the browser only opens the picker from a user gesture */
                }
              }}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <button
            type="button"
            onClick={() => go(shiftMonth(month, 1))}
            aria-label="Next month"
            className="rounded-r-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <label className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-sm focus-within:border-brand sm:max-w-md">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter products…"
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() => (month === thisMonth ? scrollToToday(true) : go(thisMonth))}
          className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted"
        >
          Today
        </button>
        <span className="ml-auto flex items-center gap-3">
          {error && <span className="text-xs text-red-500">{error}</span>}
          <button
            type="button"
            onClick={() => {
              setAddError(null);
              setAdding(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted"
          >
            <Plus className="size-4" />
            Add product
          </button>
          <button
            type="button"
            onClick={exportExcel}
            disabled={exporting}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:brightness-95 disabled:opacity-60"
          >
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
            {exporting ? "Preparing…" : "Export to Excel"}
          </button>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3 pb-3 text-xs text-muted-foreground sm:px-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
          <span className="size-2.5 rounded-sm border border-blue-400 bg-blue-100 dark:bg-blue-950" /> Today
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1"
          title="Other out is at least half of what was on the shelf that morning"
        >
          <span className="size-2.5 rounded-sm border border-amber-400 bg-amber-100 dark:bg-amber-950" /> Unusual other-out
        </span>
        <span className="inline-flex items-center gap-3 rounded-full border border-border bg-card px-3 py-1">
          <span>
            <b className="text-green-600 dark:text-green-400">P</b> Purchase in
          </span>
          <span>
            <b className="text-foreground">S</b> Sale
          </span>
          <span>
            <b className="text-red-500">O</b> Other out
          </span>
          <span>
            <b className="text-foreground">R</b> Remaining = previous R + P − S − O
          </span>
        </span>
      </div>

      <div className="mx-4 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm sm:mx-6">
        <div ref={scrollerRef} className="relative min-h-0 flex-1 overflow-auto">
          <table
            className="border-separate border-spacing-0 text-[13px]"
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (target.closest("input")) return;
              const td = target.closest<HTMLElement>("td[data-f]");
              if (td?.dataset.id && td.dataset.f) setEditing({ id: td.dataset.id, field: td.dataset.f });
            }}
          >
            <thead className="sticky top-0 z-20">
              <tr>
                <th rowSpan={2} className={`${headBase} ${sticky} text-left`} style={{ left: LEFT.sku, minWidth: W.sku }}>
                  SKU
                </th>
                <th rowSpan={2} className={`${headBase} ${sticky} border-r text-left`} style={{ left: LEFT.name, minWidth: W.name }}>
                  Name
                </th>
                <th rowSpan={2} className={`${headBase} text-left`} style={{ minWidth: W.weight }}>
                  Weight
                </th>
                <th rowSpan={2} className={`${headBase} text-left`} style={{ minWidth: W.unit }}>
                  Unit
                </th>
                <th rowSpan={2} className={`${headBase} text-right`} style={{ minWidth: W.price }}>
                  Unit price
                </th>
                <th rowSpan={2} className={`${headBase} text-left`} style={{ minWidth: W.exDate }}>
                  Ex-Date
                </th>
                <th rowSpan={2} className={`${headBase} text-right`} style={{ minWidth: W.loka }}>
                  S-Price LOKA
                </th>
                <th rowSpan={2} className={`${headBase} text-right`} style={{ minWidth: W.tc10 }}>
                  TC+10%
                </th>
                <th rowSpan={2} className={`${headBase} text-right`} style={{ minWidth: W.totalCost }}>
                  Total Cost
                </th>
                <th rowSpan={2} className={`${headBase} text-right`} style={{ minWidth: W.begin }}>
                  Begining stock
                </th>
                {days.map((d) => {
                  const date = new Date(`${d}T00:00:00Z`);
                  const isToday = d === today;
                  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
                  return (
                    <th
                      key={d}
                      ref={isToday ? todayRef : undefined}
                      colSpan={4}
                      className={`border-l border-b border-border px-1 pt-1.5 pb-1 text-center text-[11px] font-semibold ${
                        isToday
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                          : weekend
                            ? "bg-muted text-rose-500"
                            : "bg-muted text-foreground"
                      }`}
                    >
                      <span className="font-normal opacity-70">{WEEKDAYS[date.getUTCDay()]}</span> {Number(d.slice(8))}
                    </th>
                  );
                })}
                <th
                  colSpan={5}
                  className={`${sticky} border-l border-b-2 border-border bg-muted px-2 py-2 text-center text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase`}
                  style={{ right: 0 }}
                >
                  Month totals
                </th>
              </tr>
              <tr>
                {days.map((d) => {
                  const isToday = d === today;
                  return ["P", "S", "O", "R"].map((k, i) => (
                    <th
                      key={`${d}-${k}`}
                      className={`${subHead} ${i === 0 ? "border-l" : ""} ${
                        isToday ? "!bg-blue-100 !text-blue-700 dark:!bg-blue-950 dark:!text-blue-300" : ""
                      } ${k === "P" ? "text-green-600/80" : k === "O" ? "text-red-500/80" : ""}`}
                      style={{ minWidth: W.dayCol }}
                    >
                      {k}
                    </th>
                  ));
                })}
                <th className={`${subHead} ${sticky} border-l text-right`} style={{ right: RIGHT.totalIn, minWidth: TW.totalIn }}>
                  Total In
                </th>
                <th className={`${subHead} ${sticky} text-right`} style={{ right: RIGHT.totalSold, minWidth: TW.totalSold }}>
                  Total Sold
                </th>
                <th className={`${subHead} ${sticky} text-right`} style={{ right: RIGHT.totalOther, minWidth: TW.totalOther }}>
                  Total Other
                </th>
                <th className={`${subHead} ${sticky} text-right`} style={{ right: RIGHT.ending, minWidth: TW.ending }}>
                  Ending
                </th>
                <th className={`${subHead} ${sticky} text-right`} style={{ right: RIGHT.value, minWidth: TW.value }}>
                  Ending value
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && (
                <tr>
                  <td colSpan={colSpanAll} className="px-4 py-14 text-center text-sm text-muted-foreground">
                    {rows.length === 0 ? "No stock or stock movement for this business in this month." : "No products match."}
                  </td>
                </tr>
              )}
              {groups.map((g, gi) => (
                <Fragment key={`${g.brandId}|${g.name}`}>
                  {showBrands && g.brandId !== groups[gi - 1]?.brandId && (
                    <tr>
                      <td colSpan={colSpanAll} className="border-b-2 border-border bg-muted p-0">
                        <div className="sticky left-0 flex w-max items-center gap-3 border-l-4 border-brand px-3 py-2 text-sm">
                          <span className="font-bold text-foreground">{brandName(g.brandId)}</span>
                          <span className="text-xs text-muted-foreground">Ending value {formatUsd(brandValue(g.brandId))}</span>
                        </div>
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={colSpanAll} className="border-b border-border bg-muted/60 p-0">
                      <div className="sticky left-0 flex w-max items-center gap-2 border-l-4 border-blue-500 px-3 py-1.5 text-xs">
                        <span className="font-semibold tracking-wide text-blue-600 uppercase dark:text-blue-400">{g.name}</span>
                        <span className="rounded-full bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
                          {g.items.length} item{g.items.length === 1 ? "" : "s"}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {g.items.map((r) => (
                    <tr key={r.productId} className="group">
                      <td
                        {...cellProps(r, "sku")}
                        className={`${cellBase} ${sticky} bg-card font-mono text-[11px] text-muted-foreground group-hover:bg-muted ${typedTint(r, "sku")}`}
                        style={{ left: LEFT.sku }}
                      >
                        {isEditing(r, "sku") ? editor(r, "sku", "left") : (r.sku || dash)}
                      </td>
                      <td
                        className={`${cellBase} ${sticky} overflow-hidden border-r bg-card font-medium text-ellipsis group-hover:bg-muted`}
                        style={{ left: LEFT.name, maxWidth: W.name, minWidth: W.name }}
                        title={r.name}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">{r.name}</span>
                          <button
                            type="button"
                            aria-label={`Delete ${r.name}`}
                            title="Delete"
                            onClick={() => setDeleting(r)}
                            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </td>
                      <td
                        {...cellProps(r, "weight")}
                        className={`${cellBase} text-muted-foreground group-hover:bg-muted/60 ${typedTint(r, "weight")}`}
                      >
                        {isEditing(r, "weight") ? editor(r, "weight", "left") : (r.size || dash)}
                      </td>
                      <td
                        {...cellProps(r, "unit")}
                        className={`${cellBase} text-muted-foreground group-hover:bg-muted/60 ${typedTint(r, "unit")}`}
                      >
                        {isEditing(r, "unit") ? editor(r, "unit", "left") : (r.unit || dash)}
                      </td>
                      <td
                        {...cellProps(r, "unit_price")}
                        className={`${cellBase} text-right font-medium tabular-nums group-hover:bg-muted/60 ${typedTint(r, "unit_price")}`}
                      >
                        {isEditing(r, "unit_price") ? editor(r, "unit_price", "right") : formatUsd(r.unitPrice)}
                      </td>
                      <td
                        {...cellProps(r, "ex_date")}
                        className={`${cellBase} group-hover:bg-muted/60 ${typedTint(r, "ex_date")}`}
                      >
                        {isEditing(r, "ex_date") ? editor(r, "ex_date", "left") : r.exDate || dash}
                      </td>
                      {/* S-Price LOKA is Stock's Original Cost, until a value is typed here. */}
                      <td
                        {...cellProps(r, "s_price_loka")}
                        className={`${cellBase} text-right tabular-nums group-hover:bg-muted/60 ${typedTint(r, "s_price_loka")}`}
                      >
                        {isEditing(r, "s_price_loka") ? editor(r, "s_price_loka", "right") : r.originalCost === null ? dash : formatUsd(r.originalCost)}
                      </td>
                      <td
                        {...cellProps(r, "tc10")}
                        className={`${cellBase} text-right tabular-nums group-hover:bg-muted/60 ${typedTint(r, "tc10")}`}
                      >
                        {isEditing(r, "tc10") ? editor(r, "tc10", "right") : r.cost10 === null ? dash : formatUsd(r.cost10)}
                      </td>
                      <td
                        {...cellProps(r, "total_cost")}
                        className={`${cellBase} text-right tabular-nums group-hover:bg-muted/60 ${typedTint(r, "total_cost")}`}
                      >
                        {isEditing(r, "total_cost") ? (
                          editor(r, "total_cost", "right")
                        ) : r.totalCost === null ? (
                          <span className="text-[11px] text-amber-600/80">no cost</span>
                        ) : (
                          formatUsd(r.totalCost)
                        )}
                      </td>
                      <td
                        {...cellProps(r, "begin")}
                        className={`${cellBase} text-right font-semibold tabular-nums group-hover:bg-muted/60 ${typedTint(r, "begin")}`}
                      >
                        {isEditing(r, "begin") ? editor(r, "begin", "right") : fmt(r.begin)}
                      </td>
                      {r.days.map((day, i) => {
                        const dd = days[i].slice(8);
                        const isToday = days[i] === today;
                        const opening = i === 0 ? r.begin : (r.days[i - 1].r ?? 0);
                        const unusual = day.o > 0 && opening > 0 && day.o >= opening / 2;
                        const tint = isToday ? "bg-blue-50 dark:bg-blue-950/40" : "";
                        const num = "border-b border-border/70 px-1 py-2 text-right tabular-nums";
                        // Days still to come can be typed into too (to plan ahead); they get an R then.
                        const open = true;
                        const cell = (kind: "p" | "s" | "o", value: number, classes: string) => {
                          const f = `${kind}:${dd}`;
                          return (
                            <td
                              {...(open ? cellProps(r, f) : {})}
                              className={`${num} ${classes} ${open ? "cursor-text" : ""}`}
                            >
                              {open && isEditing(r, f) ? editor(r, f, "right") : value === 0 ? "" : fmt(value)}
                            </td>
                          );
                        };
                        return (
                          <Fragment key={days[i]}>
                            {cell("p", day.p, `border-l border-border/70 font-medium text-green-600 dark:text-green-400 ${tint}`)}
                            {cell("s", day.s, tint)}
                            {cell(
                              "o",
                              day.o,
                              unusual ? "bg-amber-100 font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300" : `text-red-500 ${tint}`
                            )}
                            <td
                              className={`${num} ${
                                day.p || day.s || day.o ? "font-semibold" : "text-muted-foreground/60"
                              } ${tint}`}
                            >
                              {day.r === null ? "" : fmt(day.r)}
                            </td>
                          </Fragment>
                        );
                      })}
                      <td className={`${cellBase} ${sticky} border-l bg-muted text-right tabular-nums`} style={{ right: RIGHT.totalIn }}>
                        {fmt(r.totalIn)}
                      </td>
                      <td className={`${cellBase} ${sticky} bg-muted text-right tabular-nums`} style={{ right: RIGHT.totalSold }}>
                        {fmt(r.totalSold)}
                      </td>
                      <td className={`${cellBase} ${sticky} bg-muted text-right tabular-nums`} style={{ right: RIGHT.totalOther }}>
                        {fmt(r.totalOther)}
                      </td>
                      <td className={`${cellBase} ${sticky} bg-muted text-right font-semibold tabular-nums`} style={{ right: RIGHT.ending }}>
                        {fmt(r.ending)}
                      </td>
                      <td className={`${cellBase} ${sticky} bg-muted text-right font-medium tabular-nums`} style={{ right: RIGHT.value }}>
                        {r.endingValue === null ? (
                          <span className="text-[11px] text-amber-600/80" title="No cost recorded for this product">
                            no cost
                          </span>
                        ) : (
                          formatUsd(r.endingValue)
                        )}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            {groups.length > 0 && (
              <tfoot className="sticky bottom-0 z-20">
                <tr>
                  <td colSpan={2} className={`${sticky} border-t-2 border-border bg-muted px-3 py-2.5 text-sm font-semibold`} style={{ left: 0 }}>
                    Total ending value
                  </td>
                  <td colSpan={LEFT_COLUMNS - 2 + days.length * 4} className="border-t-2 border-border bg-muted" />
                  <td colSpan={4} className={`${sticky} border-t-2 border-border bg-muted`} style={{ right: RIGHT.ending }} />
                  <td
                    className={`${sticky} border-t-2 border-border bg-muted px-2.5 py-2.5 text-right text-sm font-bold tabular-nums`}
                    style={{ right: RIGHT.value }}
                  >
                    {formatUsd(totalEndingValue)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      {adding && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            if (!addPending) setAdding(false);
          }}
        >
          <form
            aria-label="Add product"
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void addProduct();
            }}
          >
            <h2 className="text-base font-semibold text-foreground">Add product</h2>
            <label className="mt-4 block text-xs text-muted-foreground">
              Name
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
              />
            </label>
            <label className="mt-3 block text-xs text-muted-foreground">
              Category
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none [color-scheme:light] focus:border-brand dark:[color-scheme:dark]"
              >
                <option value="">None (Added in ledger)</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value={NEW_CATEGORY}>+ New category…</option>
              </select>
              {newCategory === NEW_CATEGORY && (
                <input
                  autoFocus
                  value={newCategoryText}
                  onChange={(e) => setNewCategoryText(e.target.value)}
                  placeholder="New category name"
                  className="mt-2 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
                />
              )}
            </label>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-xs text-muted-foreground">
                Unit
                <select
                  value={newUnit}
                  onChange={(e) => setNewUnit(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none [color-scheme:light] focus:border-brand dark:[color-scheme:dark]"
                >
                  {ENGLISH_SCALES.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-muted-foreground">
                Unit price
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  placeholder="0"
                  className="mt-1 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
                />
              </label>
            </div>
            {addError && <p className="mt-3 text-xs text-red-500">{addError}</p>}
            <div className="mt-6 flex gap-2">
              <button
                type="button"
                disabled={addPending}
                onClick={() => setAdding(false)}
                className="flex-1 rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={addPending}
                className="flex-1 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:brightness-95 disabled:opacity-50"
              >
                {addPending ? "Adding…" : "Add"}
              </button>
            </div>
          </form>
        </div>
      )}
      {deleting && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            if (!deletePending) setDeleting(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Delete this product?"
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
              <TriangleAlert className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-foreground">Delete this product?</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {deleteCopy(deleting)}
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <button
                type="button"
                disabled={deletePending}
                onClick={() => setDeleting(null)}
                className="flex-1 rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletePending}
                onClick={() => void confirmDelete(deleting)}
                className="flex-1 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {deletePending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
