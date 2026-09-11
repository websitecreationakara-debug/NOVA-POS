"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileDown, Search, Truck, X } from "lucide-react";
import type { OrderListRow } from "@/lib/supabase/queries";
import type { FulfillmentStatus } from "@/types/database";
import { updateFulfillmentStatusAction } from "@/app/(app)/orders/actions";
import { notifyOrdersChanged } from "@/lib/ordersChanged";
import { FULFILLMENT_STATUSES, STATUS_LABELS } from "@/lib/orderStatus";
import OrderStatusControl from "@/components/OrderStatusControl";
import OrderRowMenu from "@/components/OrderRowMenu";

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

// Local calendar day (YYYY-MM-DD) for a paid_at timestamp, so the date-range
// inputs compare like-for-like.
function localDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA");
}

// "Wed, Sep 11, 2:00 PM" from an ISO timestamp.
function formatDeliveryAt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function OrdersTable({
  orders,
  activeStatus,
  brands,
}: {
  orders: OrderListRow[];
  activeStatus: FulfillmentStatus | null;
  brands: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [brandId, setBrandId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (activeStatus && o.fulfillmentStatus !== activeStatus) return false;
      if (brandId && o.brandId !== brandId) return false;
      if (q) {
        const hay = `${o.invoiceNumber ?? ""} ${o.customerName ?? ""} ${o.customerPhone ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (from || to) {
        if (!o.paidAt) return false;
        const day = localDay(o.paidAt);
        if (from && day < from) return false;
        if (to && day > to) return false;
      }
      return true;
    });
  }, [orders, activeStatus, brandId, search, from, to]);

  const hasFilter = search.trim() !== "" || from !== "" || to !== "" || brandId !== "";

  function clearFilters() {
    setSearch("");
    setFrom("");
    setTo("");
    setBrandId("");
  }

  // Filename for the bulk PDF export -- business + the active date range, so
  // staff can tell one saved report from another without opening it. Falls
  // back to a generic name when nothing's filtered (e.g. mixed businesses).
  const bulkPdfUrl = useMemo(() => {
    const params = new URLSearchParams({ ids: Array.from(selected).join(",") });
    const businessName = brands.find((b) => b.id === brandId)?.name;
    if (businessName) params.set("business", businessName);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return `/invoice/bulk?${params.toString()}`;
  }, [selected, brands, brandId, from, to]);

  const visibleIds = useMemo(() => filtered.map((o) => o.id), [filtered]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function bulkSetStatus(status: FulfillmentStatus) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    await Promise.allSettled(ids.map((id) => updateFulfillmentStatusAction(id, status)));
    setBulkBusy(false);
    setSelected(new Set());
    notifyOrdersChanged();
    router.refresh();
  }

  const dateInputClass =
    "rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-sm text-foreground [color-scheme:light] dark:[color-scheme:dark]";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-6 pb-3">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer, phone, or invoice…"
            className="w-full rounded-lg border border-border bg-transparent py-1.5 pr-3 pl-8 text-sm"
          />
        </div>
        <select
          value={brandId}
          onChange={(e) => setBrandId(e.target.value)}
          className="rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-sm text-foreground"
        >
          <option value="">All businesses</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          From
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            className={dateInputClass}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          To
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className={dateInputClass}
          />
        </label>
        {(hasFilter || activeStatus) && (
          <button
            type="button"
            onClick={() => {
              clearFilters();
              if (activeStatus) router.push("/orders");
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
            Clear
          </button>
        )}
        {(hasFilter || activeStatus) && (
          <span className="ml-auto text-xs text-muted-foreground">
            Showing {filtered.length} of {orders.length}
          </span>
        )}
      </div>

      {selected.size > 0 && (
        <div className="mx-6 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/10 px-4 py-2.5 text-sm">
          <span className="font-semibold">{selected.size} selected</span>
          <span className="text-xs text-muted-foreground">Mark as</span>
          {FULFILLMENT_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={bulkBusy}
              onClick={() => bulkSetStatus(s)}
              className="rounded-full border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
          {bulkBusy && <span className="text-xs text-muted-foreground">Updating…</span>}
          <a
            href={bulkPdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
          >
            <FileDown className="size-3.5" />
            Save as PDF
          </a>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto px-6 pb-6">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {orders.length === 0 ? "No orders found." : "No orders match your filters."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
                <th className="w-8 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    className="align-middle accent-[var(--brand)]"
                  />
                </th>
                <th className="py-2 pr-4">Invoice</th>
                <th className="py-2 pr-4">Business</th>
                <th className="py-2 pr-4">Customer</th>
                <th className="py-2 pr-4">Phone</th>
                <th className="py-2 pr-4 text-right">Total</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Date</th>
                <th className="w-10 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr
                  key={o.id}
                  className={`border-b border-border hover:bg-muted ${
                    selected.has(o.id) ? "bg-brand/5" : ""
                  }`}
                >
                  <td className="py-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${o.invoiceNumber ?? o.id}`}
                      checked={selected.has(o.id)}
                      onChange={() => toggle(o.id)}
                      className="align-middle accent-[var(--brand)]"
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <Link
                      href={`/orders/${o.id}`}
                      className="font-semibold text-brand hover:underline"
                    >
                      {o.invoiceNumber ?? `#${o.id.slice(0, 8)}`}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{o.brandName}</td>
                  <td className="py-2 pr-4">{o.customerName || "—"}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{o.customerPhone || "—"}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(o.total)}</td>
                  <td className="py-2 pr-4">
                    {/* key includes the status so a bulk change (which updates
                        the server prop after router.refresh) remounts this with
                        the fresh value rather than keeping stale local state. */}
                    <OrderStatusControl
                      key={`${o.id}-${o.fulfillmentStatus}`}
                      orderId={o.id}
                      status={o.fulfillmentStatus}
                      variant="compact"
                    />
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    <div>{o.paidAt ? new Date(o.paidAt).toLocaleDateString() : "—"}</div>
                    {o.deliveryAt &&
                      (() => {
                        const due = new Date(o.deliveryAt).getTime() <= Date.now();
                        const settled =
                          o.fulfillmentStatus === "delivered" ||
                          o.fulfillmentStatus === "complete" ||
                          o.fulfillmentStatus === "cancelled";
                        return (
                          <div
                            className={`mt-0.5 flex items-center gap-1 text-xs font-medium ${
                              due && !settled
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground"
                            }`}
                          >
                            <Truck className="size-3" />
                            {formatDeliveryAt(o.deliveryAt)}
                          </div>
                        );
                      })()}
                  </td>
                  <td className="py-2">
                    <OrderRowMenu orderId={o.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
