"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import type { Brand, CashReconciliation, Expense, Order } from "@/types/database";
import { ALL_BUSINESSES_ID, type DailySalesSummary } from "@/lib/supabase/queries";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/paymentMethods";
import {
  addExpenseAction,
  deleteExpenseAction,
  saveReconciliationAction,
  updateExpenseAction,
} from "./actions";
import { exportAccountancePdf } from "@/lib/exportAccountancePdf";
import type { AccountanceTab } from "./page";

type RangeMode = "day" | "week" | "month" | "quarter" | "year";

const TAB_LABELS: Record<AccountanceTab, string> = {
  reconciliation: "Cash Reconciliation",
  expenses: "Expense & Accounts Payable",
  reports: "Financial Reporting & P&L",
  cogs: "COGS & Margin Tracking",
};

// One color per payment method, cycled if there are ever more methods than
// colors -- cash keeps the blue it always had.
const PAYMENT_METHOD_COLORS: Record<PaymentMethod, string> = {
  cash: "#2a78d6",
  aba_pay: "#eb6834",
  wing: "#c026d3",
  khqr: "#16a34a",
  card: "#9333ea",
  bank_qr: "#6b7280",
};

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function AccountanceClient({
  brands,
  currentBrand,
  mode,
  week,
  month,
  quarter,
  year,
  fromDate,
  toDate,
  tab,
  summary,
  orders,
  reconciliation,
  expenses,
}: {
  brands: Brand[];
  currentBrand: Brand;
  mode: RangeMode;
  week: string;
  month: string;
  quarter: string;
  year: string;
  fromDate: string;
  toDate: string;
  tab: AccountanceTab;
  summary: DailySalesSummary;
  orders: Order[];
  reconciliation: CashReconciliation | null;
  expenses: Expense[];
}) {
  const router = useRouter();
  const [countedCash, setCountedCash] = useState(
    reconciliation ? String(reconciliation.counted_cash) : ""
  );
  const [notes, setNotes] = useState(reconciliation?.notes ?? "");
  const [expenseDesc, setExpenseDesc] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("");
  // Logging an expense picks its own business and day, independent of
  // whatever the page is currently filtered to -- so it works while looking
  // at "All Businesses", a whole month, or a whole year, not just a single
  // business on a single day. Seeded from the current view as a starting
  // point, not a constraint.
  const [expenseBrandId, setExpenseBrandId] = useState(
    currentBrand.id === ALL_BUSINESSES_ID ? brands[0].id : currentBrand.id
  );
  const [expenseDate, setExpenseDate] = useState(fromDate);
  // Set while editing an existing row -- the same form above the table is
  // reused for both adding and editing (populated from that row, "Add"
  // becomes "Save changes") instead of a separate edit form/modal.
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Day mode starts as one date box, not two identical ones -- "+ Range"
  // reveals the second (end) box only once the user actually wants a span.
  // Seeded from whether the incoming range already spans >1 day so a
  // bookmarked/shared multi-day link still opens with both boxes visible.
  const [showRangeEnd, setShowRangeEnd] = useState(fromDate !== toDate);
  const [expenseSearch, setExpenseSearch] = useState("");
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState("");

  // Hides the app shell's scrollbar while this page is mounted -- scrolling
  // itself still works (wheel/keyboard/touch), only the visible track/thumb
  // is gone. Scoped to #app-scroll-area (the one scroll container shared by
  // every page under (app)/layout.tsx) via a class toggled at runtime, and
  // removed on unmount, so navigating to any other page gets its normal
  // scrollbar back.
  useEffect(() => {
    const el = document.getElementById("app-scroll-area");
    el?.classList.add("no-scrollbar");
    return () => {
      el?.classList.remove("no-scrollbar");
    };
  }, []);

  // Every navigation goes through this -- it fills in whichever of
  // from/to/week/month/quarter/year the target mode actually needs from
  // current state, so switching brand, mode, tab, or stepping a
  // week/month/quarter/year never has to repeat the other params by hand
  // (or accidentally drop one). `tab` always carries over unless overridden,
  // so changing the date filter never bounces you back to the default tab.
  function urlFor(overrides: {
    brand?: string;
    mode?: RangeMode;
    from?: string;
    to?: string;
    week?: string;
    month?: string;
    quarter?: string;
    year?: string;
    tab?: AccountanceTab;
  }) {
    const targetMode = overrides.mode ?? mode;
    const params = new URLSearchParams();
    params.set("brand", overrides.brand ?? currentBrand.id);
    params.set("mode", targetMode);
    if (targetMode === "week") params.set("week", overrides.week ?? week);
    else if (targetMode === "month") params.set("month", overrides.month ?? month);
    else if (targetMode === "quarter") params.set("quarter", overrides.quarter ?? quarter);
    else if (targetMode === "year") params.set("year", overrides.year ?? year);
    else {
      params.set("from", overrides.from ?? fromDate);
      params.set("to", overrides.to ?? toDate);
    }
    params.set("tab", overrides.tab ?? tab);
    return `/accountance?${params.toString()}`;
  }

  function switchBrand(brandId: string) {
    router.push(urlFor({ brand: brandId }));
  }

  function switchMode(newMode: RangeMode) {
    router.push(urlFor({ mode: newMode }));
  }

  function switchTab(newTab: AccountanceTab) {
    router.push(urlFor({ tab: newTab }));
  }

  // A single date input clamps its own range (max/min against the other
  // end) so this never has to correct an inverted from > to itself.
  function switchDates(newFrom: string, newTo: string) {
    router.push(urlFor({ mode: "day", from: newFrom, to: newTo }));
  }

  function switchWeek(newWeek: string) {
    router.push(urlFor({ mode: "week", week: newWeek }));
  }

  function stepWeek(delta: number) {
    const d = new Date(`${week}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 7 * delta);
    switchWeek(d.toISOString().slice(0, 10));
  }

  function switchMonth(newMonth: string) {
    router.push(urlFor({ mode: "month", month: newMonth }));
  }

  function stepMonth(delta: number) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    switchMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  function switchQuarter(newQuarter: string) {
    router.push(urlFor({ mode: "quarter", quarter: newQuarter }));
  }

  function stepQuarter(delta: number) {
    const [y, q] = quarter.split("-Q").map(Number);
    const zeroBased = (q - 1) + delta;
    const yearOffset = Math.floor(zeroBased / 4);
    const newQ = ((zeroBased % 4) + 4) % 4;
    switchQuarter(`${y + yearOffset}-Q${newQ + 1}`);
  }

  function switchYear(newYear: string) {
    router.push(urlFor({ mode: "year", year: newYear }));
  }

  function stepYear(delta: number) {
    switchYear(String(Number(year) + delta));
  }

  const isSingleDay = mode === "day" && fromDate === toDate;
  const rangeLabel =
    mode === "week"
      ? `${fromDate} to ${toDate}`
      : mode === "month"
        ? month
        : mode === "quarter"
          ? quarter
          : mode === "year"
            ? year
            : isSingleDay
              ? fromDate
              : `${fromDate} to ${toDate}`;

  const expenseTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
  const netProfit = summary.total - expenseTotal;

  const filteredExpenses = useMemo(() => {
    const q = expenseSearch.trim().toLowerCase();
    return expenses.filter((e) => {
      if (expenseCategoryFilter && (e.category ?? "") !== expenseCategoryFilter) return false;
      if (q && !e.description.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [expenses, expenseSearch, expenseCategoryFilter]);
  const filteredExpenseTotal = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
  const expenseCategories = useMemo(
    () => Array.from(new Set(expenses.map((e) => e.category).filter((c): c is string => Boolean(c)))).sort(),
    [expenses]
  );
  const isExpenseFilterActive = expenseSearch.trim() !== "" || expenseCategoryFilter !== "";

  function saveReconciliation() {
    const counted = parseFloat(countedCash);
    if (Number.isNaN(counted)) {
      setError("Enter a counted cash amount");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await saveReconciliationAction({
          brandId: currentBrand.id,
          date: fromDate,
          countedCash: counted,
          expectedCash: summary.cashTotal,
          expectedBankQr: summary.nonCashTotal,
          notes: notes.trim() || undefined,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save reconciliation");
      }
    });
  }

  function resetExpenseForm() {
    setEditingExpenseId(null);
    setExpenseDesc("");
    setExpenseAmount("");
    setExpenseCategory("");
  }

  function startEditExpense(expense: Expense) {
    setEditingExpenseId(expense.id);
    setExpenseBrandId(expense.brand_id);
    setExpenseDate(expense.expense_date);
    setExpenseDesc(expense.description);
    setExpenseAmount(String(expense.amount));
    setExpenseCategory(expense.category ?? "");
    setError(null);
  }

  function saveExpense() {
    const amount = parseFloat(expenseAmount);
    if (!expenseDesc.trim() || Number.isNaN(amount) || amount <= 0) {
      setError("Enter a description and a positive amount");
      return;
    }
    setError(null);
    const input = {
      brandId: expenseBrandId,
      description: expenseDesc.trim(),
      amount,
      category: expenseCategory.trim() || undefined,
      date: expenseDate,
    };
    startTransition(async () => {
      try {
        if (editingExpenseId) await updateExpenseAction(editingExpenseId, input);
        else await addExpenseAction(input);
        resetExpenseForm();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save expense");
      }
    });
  }

  function removeExpense(id: string) {
    startTransition(async () => {
      await deleteExpenseAction(id);
      if (editingExpenseId === id) resetExpenseForm();
      router.refresh();
    });
  }

  const fileDateLabel =
    mode === "week" || mode === "month" || mode === "quarter" || mode === "year"
      ? rangeLabel
      : `${fromDate}${isSingleDay ? "" : `_to_${toDate}`}`;

  function exportCsv() {
    const lines: string[] = [];
    lines.push(`Daily report,${currentBrand.name},${rangeLabel}`);
    lines.push("");
    lines.push("Sales");
    lines.push("Order ID,Payment Method,Total,Paid At");
    for (const o of orders) {
      lines.push(`${o.id},${o.payment_method ?? ""},${o.total},${o.paid_at ?? ""}`);
    }
    lines.push("");
    for (const b of summary.paymentBreakdown) {
      lines.push(`${PAYMENT_METHOD_LABELS[b.method]} total,${b.total}`);
    }
    lines.push(`Sales total,${summary.total}`);
    lines.push("");
    lines.push("Expenses");
    lines.push("Description,Category,Amount");
    for (const e of expenses) {
      lines.push(`"${e.description.replace(/"/g, '""')}",${e.category ?? ""},${e.amount}`);
    }
    lines.push(`Expense total,${expenseTotal}`);
    lines.push("");
    lines.push(`Net (sales - expenses),${summary.total - expenseTotal}`);

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentBrand.slug}-${fileDateLabel}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    exportAccountancePdf(`${currentBrand.slug}-${fileDateLabel}`, {
      businessName: currentBrand.name,
      rangeLabel,
      paymentBreakdown: summary.paymentBreakdown.map((b) => ({
        label: PAYMENT_METHOD_LABELS[b.method],
        total: b.total,
      })),
      orderCount: orders.length,
      total: summary.total,
      expenses: expenses.map((e) => ({
        description: e.description,
        category: e.category,
        amount: e.amount,
      })),
      expenseTotal,
    });
  }

  const variance = reconciliation ? reconciliation.variance : null;
  // Reconciling a till count, and logging a new expense, both need one
  // specific business on one specific day -- "All Businesses" has no single
  // cash drawer, addExpenseAction/saveReconciliationAction both take one
  // brandId, and a multi-day range has no single day to file either against.
  // Both actions are disabled (not hidden -- the combined stats/expense log
  // still read fine) until a single business and a single day are picked.
  const isAllBusinesses = currentBrand.id === ALL_BUSINESSES_ID;
  function brandNameFor(brandId: string) {
    return brands.find((b) => b.id === brandId)?.name ?? "—";
  }

  return (
    <div className="p-6">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-medium">Accountance</h1>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={exportPdf}
            className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-black hover:brightness-95"
          >
            Save as PDF
          </button>
          <button
            onClick={exportCsv}
            className="rounded-full border border-black/[.15] px-4 py-1.5 text-sm dark:border-white/[.2]"
          >
            Export CSV
          </button>
        </div>
      </header>

      {/* One grouped filter bar -- business + Day/Month/Year + the date
          control that mode needs -- separate from the title/actions above so
          "what am I looking at" and "what can I do with it" don't compete for
          the same row. */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-black/[.08] p-3 dark:border-white/[.145]">
        <select
          className="rounded border border-black/[.15] bg-card px-3 py-1.5 text-sm text-foreground dark:border-white/[.2]"
          value={currentBrand.id}
          onChange={(e) => switchBrand(e.target.value)}
        >
          <option value={ALL_BUSINESSES_ID}>All Businesses</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>

        {/* Day/Week/Month/Quarter/Year -- Day keeps the free-form From/To
            range below (also covers "Custom Date Range"); the rest swap in
            a single stepped picker that always covers that whole calendar
            unit. */}
        <div className="inline-flex rounded-full border border-black/[.15] p-0.5 dark:border-white/[.2]">
          {(["day", "week", "month", "quarter", "year"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              aria-pressed={mode === m}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                mode === m ? "bg-brand text-black" : "text-zinc-500 hover:text-foreground"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === "day" && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={fromDate}
              max={showRangeEnd ? toDate : undefined}
              onChange={(e) => switchDates(e.target.value, showRangeEnd ? toDate : e.target.value)}
              className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            />
            {showRangeEnd ? (
              <>
                <span className="text-xs text-zinc-500">to</span>
                <input
                  type="date"
                  value={toDate}
                  min={fromDate}
                  onChange={(e) => switchDates(fromDate, e.target.value)}
                  className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowRangeEnd(false);
                    switchDates(fromDate, fromDate);
                  }}
                  aria-label="Remove end date"
                  className="text-zinc-500 hover:text-foreground"
                >
                  ×
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowRangeEnd(true)}
                className="text-xs font-medium text-brand hover:underline"
              >
                + Range
              </button>
            )}
          </div>
        )}

        {mode === "week" && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => stepWeek(-1)}
              aria-label="Previous week"
              className="rounded-full p-1 text-zinc-500 hover:bg-black/[.06] hover:text-foreground dark:hover:bg-white/[.1]"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-40 text-center text-sm">{fromDate} – {toDate}</span>
            <button
              type="button"
              onClick={() => stepWeek(1)}
              aria-label="Next week"
              className="rounded-full p-1 text-zinc-500 hover:bg-black/[.06] hover:text-foreground dark:hover:bg-white/[.1]"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}

        {mode === "month" && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => stepMonth(-1)}
              aria-label="Previous month"
              className="rounded-full p-1 text-zinc-500 hover:bg-black/[.06] hover:text-foreground dark:hover:bg-white/[.1]"
            >
              <ChevronLeft className="size-4" />
            </button>
            <input
              type="month"
              value={month}
              onChange={(e) => switchMonth(e.target.value)}
              className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            />
            <button
              type="button"
              onClick={() => stepMonth(1)}
              aria-label="Next month"
              className="rounded-full p-1 text-zinc-500 hover:bg-black/[.06] hover:text-foreground dark:hover:bg-white/[.1]"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}

        {mode === "quarter" && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => stepQuarter(-1)}
              aria-label="Previous quarter"
              className="rounded-full p-1 text-zinc-500 hover:bg-black/[.06] hover:text-foreground dark:hover:bg-white/[.1]"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-20 text-center text-sm">{quarter}</span>
            <button
              type="button"
              onClick={() => stepQuarter(1)}
              aria-label="Next quarter"
              className="rounded-full p-1 text-zinc-500 hover:bg-black/[.06] hover:text-foreground dark:hover:bg-white/[.1]"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}

        {mode === "year" && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => stepYear(-1)}
              aria-label="Previous year"
              className="rounded-full p-1 text-zinc-500 hover:bg-black/[.06] hover:text-foreground dark:hover:bg-white/[.1]"
            >
              <ChevronLeft className="size-4" />
            </button>
            <input
              type="number"
              inputMode="numeric"
              value={year}
              onChange={(e) => switchYear(e.target.value)}
              className="w-20 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            />
            <button
              type="button"
              onClick={() => stepYear(1)}
              aria-label="Next year"
              className="rounded-full p-1 text-zinc-500 hover:bg-black/[.06] hover:text-foreground dark:hover:bg-white/[.1]"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <div className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
          <div className="text-xs text-zinc-500">Cash sales</div>
          <div className="mt-1 text-xl font-semibold">{formatMoney(summary.cashTotal)}</div>
        </div>
        <div className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
          <div className="text-xs text-zinc-500">Non-cash sales</div>
          <div className="mt-1 text-xl font-semibold">{formatMoney(summary.nonCashTotal)}</div>
        </div>
        <div className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
          <div className="text-xs text-zinc-500">Orders</div>
          <div className="mt-1 text-xl font-semibold">{orders.length}</div>
        </div>
        <div className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
          <div className="text-xs text-zinc-500">Total revenue</div>
          <div className="mt-1 text-xl font-semibold">{formatMoney(summary.total)}</div>
        </div>
        <div className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
          <div className="text-xs text-zinc-500">Total expenses</div>
          <div className="mt-1 text-xl font-semibold">{formatMoney(expenseTotal)}</div>
        </div>
        <div className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
          <div className="text-xs text-zinc-500">Net profit</div>
          <div
            className={`mt-1 text-xl font-semibold ${netProfit < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}
          >
            {formatMoney(netProfit)}
          </div>
        </div>
      </div>

      {/* Sub-navigation for the 4 Accountance views -- mirrors the sidebar's
          Accountance sub-links, so a tab can be reached either way and both
          stay in sync via the same `tab` searchParam. */}
      <div className="mt-6 inline-flex flex-wrap gap-1 rounded-full border border-black/[.08] p-1 dark:border-white/[.145]">
        {(Object.keys(TAB_LABELS) as AccountanceTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => switchTab(t)}
            aria-pressed={tab === t}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              tab === t ? "bg-brand text-black" : "text-zinc-500 hover:text-foreground"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      <div className="mt-6 space-y-6">
        {tab === "reconciliation" && (
        <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
          <h2 className="font-medium">Cash reconciliation</h2>
          {isAllBusinesses ? (
            <>
              <p className="mt-1 text-xs text-zinc-500">
                There&apos;s no single cash drawer across all 3 businesses -- pick one to reconcile:
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {brands.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => switchBrand(b.id)}
                    className="rounded-full border border-black/[.15] px-3 py-1 text-xs font-medium hover:bg-black/[.04] dark:border-white/[.2] dark:hover:bg-white/[.08]"
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            </>
          ) : !isSingleDay ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="text-xs text-zinc-500">
                Cash is counted once per day -- narrow the date range above to a single day to
                reconcile it, or
              </p>
              <button
                type="button"
                onClick={() => switchDates(todayIso(), todayIso())}
                className="text-xs font-medium text-brand hover:underline"
              >
                jump to today
              </button>
            </div>
          ) : (
            <>
              <p className="mt-1 text-xs text-zinc-500">
                Expected cash from sales: {formatMoney(summary.cashTotal)}
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <label className="text-xs text-zinc-500">Counted cash</label>
                <input
                  type="number"
                  step="0.01"
                  value={countedCash}
                  onChange={(e) => setCountedCash(e.target.value)}
                  className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
                />
                <label className="text-xs text-zinc-500">Notes (optional)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
                />
                <button
                  disabled={isPending}
                  onClick={saveReconciliation}
                  className="mt-1 self-start rounded-full bg-black px-4 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black"
                >
                  Save reconciliation
                </button>
              </div>
              {variance !== null && (
                <p
                  className={`mt-3 text-sm font-medium ${
                    variance === 0 ? "text-green-600" : "text-red-500"
                  }`}
                >
                  Variance: {variance > 0 ? "+" : ""}
                  {formatMoney(variance)}{" "}
                  {variance === 0 ? "(balanced)" : variance > 0 ? "(over)" : "(short)"}
                </p>
              )}
            </>
          )}
        </section>
        )}

        {tab === "expenses" && (
        <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
          <h2 className="font-medium">Expense log</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {isAllBusinesses || !isSingleDay
              ? "Showing expenses for the filter above -- logging a new one below works for any business and day, regardless of that filter."
              : "Log an expense for any business and day below -- not just the one currently filtered above."}
          </p>
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            Vendor &amp; accounts-payable tracking and recurring expense automation are
            coming in a later update -- for now this logs one-off expenses only.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <select
              value={expenseBrandId}
              onChange={(e) => setExpenseBrandId(e.target.value)}
              className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            />
            <input
              type="text"
              placeholder="Description"
              value={expenseDesc}
              onChange={(e) => setExpenseDesc(e.target.value)}
              className="flex-1 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            />
            <input
              type="number"
              step="0.01"
              placeholder="Amount"
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
              className="w-28 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            />
            <input
              type="text"
              placeholder="Category (optional)"
              value={expenseCategory}
              onChange={(e) => setExpenseCategory(e.target.value)}
              className="w-36 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            />
            <button
              disabled={isPending}
              onClick={saveExpense}
              className="rounded border border-black/[.15] px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/[.2]"
            >
              {editingExpenseId ? "Save changes" : "Add"}
            </button>
            {editingExpenseId && (
              <button
                type="button"
                disabled={isPending}
                onClick={resetExpenseForm}
                className="rounded px-3 py-1.5 text-sm text-zinc-500 hover:text-foreground disabled:opacity-40"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Search + category filter -- narrows the table below without
              touching the page's own business/date filter above, so finding
              an old expense doesn't require re-filtering the whole page. */}
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Search description..."
              value={expenseSearch}
              onChange={(e) => setExpenseSearch(e.target.value)}
              className="flex-1 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            />
            <select
              value={expenseCategoryFilter}
              onChange={(e) => setExpenseCategoryFilter(e.target.value)}
              className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            >
              <option value="">All categories</option>
              {expenseCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/[.08] text-left text-xs text-zinc-500 dark:border-white/[.145]">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Business</th>
                  <th className="py-2 pr-3 font-medium">Category</th>
                  <th className="py-2 pr-3 font-medium">Description</th>
                  <th className="py-2 pr-3 text-right font-medium">Amount</th>
                  <th className="relative py-2 font-medium">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[.06] dark:divide-white/[.08]">
                {filteredExpenses.map((e) => (
                  <tr key={e.id} className={editingExpenseId === e.id ? "bg-brand/10" : undefined}>
                    <td className="py-2 pr-3 whitespace-nowrap text-zinc-500">{e.expense_date}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{brandNameFor(e.brand_id)}</td>
                    <td className="py-2 pr-3 text-zinc-500">{e.category || "—"}</td>
                    <td className="py-2 pr-3">{e.description}</td>
                    <td className="py-2 pr-3 text-right font-medium">{formatMoney(e.amount)}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => startEditExpense(e)}
                        aria-label={`Edit ${e.description}`}
                        className="mr-2 text-zinc-400 hover:text-foreground"
                      >
                        <Pencil className="inline size-3.5" />
                      </button>
                      <button
                        onClick={() => removeExpense(e.id)}
                        aria-label={`Delete ${e.description}`}
                        className="text-zinc-400 hover:text-red-500"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredExpenses.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-sm text-zinc-500">
                      {expenses.length === 0
                        ? `No expenses logged for ${isSingleDay ? "this day" : "this date range"}.`
                        : "No expenses match this search/filter."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-between border-t border-black/[.08] pt-3 text-sm font-medium dark:border-white/[.145]">
            <span>{isExpenseFilterActive ? "Total (filtered)" : "Total expenses"}</span>
            <span>{formatMoney(isExpenseFilterActive ? filteredExpenseTotal : expenseTotal)}</span>
          </div>
        </section>
        )}

        {tab === "reports" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
              <h2 className="font-medium">Profit &amp; Loss</h2>
              <p className="mt-1 text-xs text-zinc-500">{rangeLabel}</p>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Gross sales</span>
                  <span className="font-medium">{formatMoney(summary.total)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">
                    Cost of goods sold
                    <span className="ml-1 text-[11px] text-zinc-400">(not yet tracked)</span>
                  </span>
                  <span className="font-medium text-zinc-400">—</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Operating expenses</span>
                  <span className="font-medium">-{formatMoney(expenseTotal)}</span>
                </div>
                <div className="flex justify-between border-t border-black/[.08] pt-2 text-base font-semibold dark:border-white/[.145]">
                  <span>Net profit</span>
                  <span className={netProfit < 0 ? "text-rose-600 dark:text-rose-400" : ""}>
                    {formatMoney(netProfit)}
                  </span>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-zinc-400">
                COGS &amp; margin tracking (synced with Stock) is coming in a later update --
                net profit above is gross sales minus operating expenses only.
              </p>
            </section>

            <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
              <h2 className="font-medium">Payment method breakdown</h2>
              {summary.paymentBreakdown.length === 0 ? (
                <p className="mt-1 text-xs text-zinc-500">No sales logged for this period.</p>
              ) : (
                <>
                  <div className="mt-4 flex h-4 w-full overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]">
                    {summary.paymentBreakdown.map((b, i) => (
                      <div
                        key={b.method}
                        style={{ width: `${(b.total / summary.total) * 100}%`, background: PAYMENT_METHOD_COLORS[b.method] }}
                        className={i < summary.paymentBreakdown.length - 1 ? "border-r-2 border-white dark:border-[#0d0d0d]" : ""}
                      />
                    ))}
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
                    {summary.paymentBreakdown.map((b) => (
                      <li key={b.method} className="flex items-center gap-2">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ background: PAYMENT_METHOD_COLORS[b.method] }}
                          aria-hidden
                        />
                        <span>{PAYMENT_METHOD_LABELS[b.method]}</span>
                        <span className="text-xs text-zinc-500">
                          {((b.total / summary.total) * 100).toFixed(0)}%
                        </span>
                        <span className="font-medium">{formatMoney(b.total)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        )}

        {tab === "cogs" && (
          <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
            <h2 className="font-medium">COGS &amp; Margin Tracking</h2>
            <p className="mt-2 text-sm text-zinc-500">
              Coming in a later update. This will deduct each sale&apos;s ingredient/item cost
              from the Stock module in real time to compute gross margins per business, plus
              a ledger for waste, spillage, comps, and promotional giveaways -- none of which
              can be calculated yet since products don&apos;t have a cost price recorded.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
