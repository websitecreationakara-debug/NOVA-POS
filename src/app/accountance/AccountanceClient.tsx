"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Brand, CashReconciliation, Expense, Order } from "@/types/database";
import type { DailySalesSummary } from "@/lib/supabase/queries";
import { addExpenseAction, deleteExpenseAction, saveReconciliationAction } from "./actions";

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function AccountanceClient({
  brands,
  currentBrand,
  date,
  summary,
  orders,
  reconciliation,
  expenses,
}: {
  brands: Brand[];
  currentBrand: Brand;
  date: string;
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
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function switchBrand(brandId: string) {
    router.push(`/accountance?brand=${brandId}&date=${date}`);
  }

  function switchDate(newDate: string) {
    router.push(`/accountance?brand=${currentBrand.id}&date=${newDate}`);
  }

  const expenseTotal = expenses.reduce((sum, e) => sum + e.amount, 0);

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
          date,
          countedCash: counted,
          expectedCash: summary.cashTotal,
          expectedBankQr: summary.bankQrTotal,
          notes: notes.trim() || undefined,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save reconciliation");
      }
    });
  }

  function addExpense() {
    const amount = parseFloat(expenseAmount);
    if (!expenseDesc.trim() || Number.isNaN(amount) || amount <= 0) {
      setError("Enter a description and a positive amount");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await addExpenseAction({
          brandId: currentBrand.id,
          description: expenseDesc.trim(),
          amount,
          category: expenseCategory.trim() || undefined,
          date,
        });
        setExpenseDesc("");
        setExpenseAmount("");
        setExpenseCategory("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to add expense");
      }
    });
  }

  function removeExpense(id: string) {
    startTransition(async () => {
      await deleteExpenseAction(id);
      router.refresh();
    });
  }

  function exportCsv() {
    const lines: string[] = [];
    lines.push(`Daily report,${currentBrand.name},${date}`);
    lines.push("");
    lines.push("Sales");
    lines.push("Order ID,Payment Method,Total,Paid At");
    for (const o of orders) {
      lines.push(`${o.id},${o.payment_method ?? ""},${o.total},${o.paid_at ?? ""}`);
    }
    lines.push("");
    lines.push(`Cash total,${summary.cashTotal}`);
    lines.push(`Bank/QR total,${summary.bankQrTotal}`);
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
    a.download = `${currentBrand.slug}-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const variance = reconciliation ? reconciliation.variance : null;

  return (
    <div className="min-h-screen p-6">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <select
          className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
          value={currentBrand.id}
          onChange={(e) => switchBrand(e.target.value)}
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <h1 className="text-lg font-medium">Accountance</h1>
        <input
          type="date"
          value={date}
          onChange={(e) => switchDate(e.target.value)}
          className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
        />
        <button
          onClick={exportCsv}
          className="ml-auto rounded-full border border-black/[.15] px-4 py-1.5 text-sm dark:border-white/[.2]"
        >
          Export CSV
        </button>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
          <div className="text-xs text-zinc-500">Cash sales</div>
          <div className="mt-1 text-xl font-semibold">{formatMoney(summary.cashTotal)}</div>
        </div>
        <div className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
          <div className="text-xs text-zinc-500">Bank/QR sales</div>
          <div className="mt-1 text-xl font-semibold">{formatMoney(summary.bankQrTotal)}</div>
        </div>
        <div className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
          <div className="text-xs text-zinc-500">Orders</div>
          <div className="mt-1 text-xl font-semibold">{orders.length}</div>
        </div>
        <div className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
          <div className="text-xs text-zinc-500">Total revenue</div>
          <div className="mt-1 text-xl font-semibold">{formatMoney(summary.total)}</div>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
          <h2 className="font-medium">Cash reconciliation</h2>
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
        </section>

        <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
          <h2 className="font-medium">Expense log</h2>
          <div className="mt-3 flex flex-wrap gap-2">
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
              onClick={addExpense}
              className="rounded border border-black/[.15] px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/[.2]"
            >
              Add
            </button>
          </div>

          <div className="mt-4 divide-y divide-black/[.06] dark:divide-white/[.08]">
            {expenses.map((e) => (
              <div key={e.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div>{e.description}</div>
                  {e.category && <div className="text-xs text-zinc-500">{e.category}</div>}
                </div>
                <div className="flex items-center gap-3">
                  <span>{formatMoney(e.amount)}</span>
                  <button
                    onClick={() => removeExpense(e.id)}
                    className="text-zinc-400 hover:text-red-500"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
            {expenses.length === 0 && (
              <p className="py-4 text-sm text-zinc-500">No expenses logged for this day.</p>
            )}
          </div>
          <div className="mt-3 flex justify-between border-t border-black/[.08] pt-3 text-sm font-medium dark:border-white/[.145]">
            <span>Total expenses</span>
            <span>{formatMoney(expenseTotal)}</span>
          </div>
        </section>
      </div>
    </div>
  );
}
