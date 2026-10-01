"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, X } from "lucide-react";
import {
  getCustomerPurchaseHistoryAction,
  type CustomerPurchaseHistory,
} from "@/app/(app)/marketing/actions";

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

function formatDay(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-CA") : "—";
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}

// Everything one customer has bought, past to now -- opened by clicking a row
// in the Marketing customers table. Mount only while open:
// `{viewing && <CustomerPurchasesDialog … />}`.
export default function CustomerPurchasesDialog({
  customerId,
  name,
  onClose,
}: {
  customerId: string;
  name: string;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [history, setHistory] = useState<CustomerPurchaseHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInvoices, setShowInvoices] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    getCustomerPurchaseHistoryAction(customerId)
      .then((h) => {
        if (!cancelled) setHistory(h);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load purchases");
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  // history.items is already newest purchase first, so rows of one purchase are adjacent.
  const purchases: {
    orderId: string;
    boughtAt: string;
    invoiceNumber: string | null;
    items: CustomerPurchaseHistory["items"];
  }[] = [];
  for (const i of history?.items ?? []) {
    const last = purchases[purchases.length - 1];
    if (last && last.orderId === i.orderId) last.items.push(i);
    else purchases.push({ orderId: i.orderId, boughtAt: i.boughtAt, invoiceNumber: i.invoiceNumber, items: [i] });
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 transition-opacity duration-150 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-purchases-title"
        className={`flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-card shadow-2xl transition-all duration-150 ${
          visible ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 id="customer-purchases-title" className="text-base font-semibold text-foreground">
              {name}
            </h2>
            <p className="text-sm text-muted-foreground">Purchase history</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!history && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
          {history && history.orderCount === 0 && (
            <p className="text-sm text-muted-foreground">This customer hasn&apos;t bought anything yet.</p>
          )}
          {history && history.orderCount > 0 && (
            <>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <button
                  type="button"
                  onClick={() => setShowInvoices((v) => !v)}
                  aria-expanded={showInvoices}
                  title="Click to see this customer's invoices"
                  className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted ${
                    showInvoices ? "border-foreground" : "border-border"
                  }`}
                >
                  <dt className="flex items-center justify-between text-xs text-muted-foreground">
                    Orders
                    <ChevronDown className={`size-3.5 transition-transform ${showInvoices ? "rotate-180" : ""}`} />
                  </dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums">{history.orderCount}</dd>
                </button>
                {[
                  ["Items bought", String(history.totalItems)],
                  ["Total spent", formatMoney(history.totalSpent)],
                  ["First / last", `${formatDay(history.firstOrderAt)} → ${formatDay(history.lastOrderAt)}`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-border p-3">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 text-sm font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>

              {showInvoices && (
                <div className="mt-4 rounded-lg border border-border">
                  <div className="flex items-center justify-between border-b border-border px-3 py-2">
                    <h3 className="text-sm font-semibold">Invoices</h3>
                    <Link
                      href={`/invoice/bulk?ids=${history.orders.map((o) => o.id).join(",")}`}
                      className="text-xs text-brand hover:underline"
                    >
                      Open all
                    </Link>
                  </div>
                  <ul className="divide-y divide-border">
                    {history.orders.map((o) => (
                      <li key={o.id}>
                        <Link
                          href={`/invoice/${o.id}`}
                          className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted"
                        >
                          <span className="font-medium text-brand">{o.invoiceNumber ?? "(no number)"}</span>
                          <span className="text-muted-foreground">{formatDateTime(o.createdAt)}</span>
                          <span className="tabular-nums">{formatMoney(o.total)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* One block per purchase: date, then the column headings, then its items. */}
              {purchases.map((p) => (
                <div key={p.orderId} className="mt-5">
                  <h3 className="text-sm font-semibold" title={p.invoiceNumber ?? undefined}>
                    {formatDateTime(p.boughtAt)}
                  </h3>
                  <table className="mt-1 w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs tracking-wide text-muted-foreground uppercase">
                        <th className="py-2">Item</th>
                        <th className="text-right">Qty</th>
                        <th className="text-right">Spent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.items.map((i, idx) => (
                        <tr key={idx} className="border-t border-border">
                          <td className="py-2 pr-3">{i.name}</td>
                          <td className="text-right tabular-nums">{i.quantity}</td>
                          <td className="text-right tabular-nums">{formatMoney(i.spent)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
