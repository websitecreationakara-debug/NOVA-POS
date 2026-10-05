"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, FileDown, Search, Truck, X } from "lucide-react";
import type { OrderListRow } from "@/lib/supabase/queries";
import type { FulfillmentStatus } from "@/types/database";
import { updateFulfillmentStatusAction } from "@/app/(app)/orders/actions";
import { notifyOrdersChanged } from "@/lib/ordersChanged";
import { COUNTED_FULFILLMENT_STATUSES, FULFILLMENT_STATUSES, STATUS_LABELS, settledDayLabel } from "@/lib/orderStatus";
import OrderStatusControl from "@/components/OrderStatusControl";
import OrderRowMenu from "@/components/OrderRowMenu";

const PAGE_SIZE_OPTIONS = [10, 25, 50];

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

// "10/4/2026" -- the Phnom Penh day an order was placed.
function dayLabel(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: "Asia/Phnom_Penh" }) : "—";
}

// The header above each day's orders: the date, that day's revenue and how
// many orders it covers.
function DayHeader({ day, revenue, orders }: { day: string; revenue: number; orders: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <CalendarDays className="size-4 text-brand" />
      <span className="text-sm font-bold tracking-tight">{day}</span>
      <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-green-700 dark:bg-green-950 dark:text-green-300">
        Revenue {formatMoney(revenue)}
      </span>
      <span className="text-xs text-muted-foreground">
        {orders} {orders === 1 ? "order" : "orders"}
      </span>
    </div>
  );
}

// What the order counts for in revenue: its total once it has moved past
// Pre-Order / New Order, and nothing while it's still one of those or cancelled
// (same rule as the reports -- see COUNTED_FULFILLMENT_STATUSES).
function orderRevenue(o: OrderListRow) {
  return COUNTED_FULFILLMENT_STATUSES.includes(o.fulfillmentStatus) ? o.total : 0;
}

// "Wed, Sep 11, 2:00 PM" from an ISO timestamp.
function formatDeliveryAt(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "Asia/Phnom_Penh",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const MONTH_RE =/^\d{4}-(0[1-9]|1[0-2])$/;

function monthEnd(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

// The month ("YYYY-MM") when from/to cover exactly one whole month, else "".
function wholeMonth(from: string, to: string) {
  const ym = from.slice(0, 7);
  return MONTH_RE.test(ym) && from === `${ym}-01` && to === monthEnd(ym) ? ym : "";
}

function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export default function OrdersTable({
  orders,
  total,
  page,
  limit,
  filters,
  defaultRange = false,
  allTime = false,
  currentMonth,
  activeStatus,
  brands,
}: {
  // One page of orders -- search/brand/date filters and paging are applied by
  // the server from the URL (?q=&brand=&from=&to=&page=&limit=).
  orders: OrderListRow[];
  total: number;
  page: number;
  limit: number;
  filters: { q: string; brandId: string; from: string; to: string };
  // True when from/to are just the current-month default, not a chosen filter.
  defaultRange?: boolean;
  // "All time" is selected (no date limit), and this month in Cambodia ("YYYY-MM").
  allTime?: boolean;
  currentMonth: string;
  activeStatus: FulfillmentStatus | null;
  brands: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState(filters.q);
  const { brandId, from, to } = filters;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Merge changes into the current query string (keeps ?status=). Any change
  // other than the page itself drops back to page 1.
  function navigate(patch: Record<string, string>) {
    const params = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    if (!("page" in patch)) params.delete("page");
    const qs = params.toString();
    router.push(qs ? `/orders?${qs}` : "/orders", { scroll: false });
  }

  // Always show the effective page and page size in the URL (e.g. on first
  // open, or after a filter drops back to page 1). replaceState keeps the
  // current list on screen -- no extra fetch or history entry.
  const urlParams = useSearchParams();
  useEffect(() => {
    if (urlParams.has("page") && urlParams.has("limit")) return;
    const params = new URLSearchParams(window.location.search);
    params.set("page", String(page));
    params.set("limit", String(limit));
    window.history.replaceState(null, "", `/orders?${params.toString()}`);
  }, [urlParams, page, limit]);

  // Type-as-you-go search: applied to the URL once typing pauses.
  useEffect(() => {
    const term = search.trim();
    if (term === filters.q.trim()) return;
    const id = setTimeout(() => navigate({ q: term }), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filters.q]);

  const hasFilter =
    search.trim() !== "" || allTime || (!defaultRange && (from !== "" || to !== "")) || brandId !== "";

  const selectedMonth = wholeMonth(from, to);
  // Month the arrows step from: the chosen month, else the month of "From", else this month.
  const baseMonth = selectedMonth || (MONTH_RE.test(from.slice(0, 7)) ? from.slice(0, 7) : currentMonth);
  // Picking a day shows just that day: To follows From, unless a custom range is
  // already set (not the whole month / all time / a single day) -- then only From
  // moves, and To is pulled along only if it would end up before From.
  function selectFrom(day: string) {
    if (!day) return navigate({ from: "", range: "" });
    const customRange = to !== "" && !allTime && !selectedMonth && to !== from;
    navigate({ from: day, to: customRange && day <= to ? to : day, range: "" });
  }
  function selectMonth(ym: string) {
    if (!MONTH_RE.test(ym)) return;
    navigate({ from: `${ym}-01`, to: monthEnd(ym), range: "" });
  }

  const pageCount = Math.max(1, Math.ceil(total / limit));
  const paged = orders;

  // Orders are listed newest first, so each day's orders sit together under one
  // header showing that day's revenue (of the orders on this page).
  const dayStats = new Map<string, { revenue: number; orders: number }>();
  for (const o of paged) {
    const day = dayLabel(o.paidAt);
    const s = dayStats.get(day) ?? { revenue: 0, orders: 0 };
    s.revenue += orderRevenue(o);
    s.orders += 1;
    dayStats.set(day, s);
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

  const visibleIds = useMemo(() => paged.map((o) => o.id), [paged]);
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
    <div className="flex flex-col lg:min-h-0 lg:flex-1">
      <div className="flex flex-wrap items-center gap-2 px-3 pb-3 sm:px-6">
        <div className="relative min-w-0 basis-full sm:max-w-xs sm:min-w-[14rem] sm:flex-1 sm:basis-auto">
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
          onChange={(e) => navigate({ brand: e.target.value })}
          className="rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-sm text-foreground"
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
            onClick={() => selectMonth(shiftMonth(baseMonth, -1))}
            title="Previous month"
            aria-label="Previous month"
            className="rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
          <input
            type="month"
            value={selectedMonth}
            max={currentMonth}
            onChange={(e) => selectMonth(e.target.value)}
            title="Show one month"
            aria-label="Month"
            className={dateInputClass}
          />
          <button
            type="button"
            disabled={baseMonth >= currentMonth}
            onClick={() => selectMonth(shiftMonth(baseMonth, 1))}
            title="Next month"
            aria-label="Next month"
            className="rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            disabled={selectedMonth === currentMonth}
            onClick={() => selectMonth(currentMonth)}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-40"
          >
            This month
          </button>
          <button
            type="button"
            disabled={allTime}
            onClick={() => navigate({ from: "", to: "", range: "all" })}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-40"
          >
            All time
          </button>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          From
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => selectFrom(e.target.value)}
            className={dateInputClass}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          To
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => navigate({ to: e.target.value, range: "" })}
            className={dateInputClass}
          />
        </label>
        {(hasFilter || activeStatus) && (
          <button
            type="button"
            onClick={() => {
              setSelected(new Set());
              router.push("/orders", { scroll: false });
              setSearch("");
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
            Clear
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {total} {hasFilter || activeStatus ? "matching" : total === 1 ? "order" : "orders"}
        </span>
      </div>

      {selected.size > 0 && (
        <div className="mx-3 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 sm:mx-6 bg-brand/10 px-4 py-2.5 text-sm">
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

      <div className="px-3 pb-6 sm:px-6 lg:flex-1 lg:overflow-auto">
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {hasFilter || activeStatus || page > 1 ? "No orders match your filters." : "No orders found."}
          </p>
        ) : (
          <>
          {/* Phones: one card per order -- a wide table is unreadable there. */}
          <ul className="space-y-2 md:hidden">
            {paged.map((o, i) => (
              <Fragment key={o.id}>
              {(i === 0 || dayLabel(paged[i - 1].paidAt) !== dayLabel(o.paidAt)) && (
                <li className="px-1 pt-3">
                  <DayHeader day={dayLabel(o.paidAt)} {...(dayStats.get(dayLabel(o.paidAt)) ?? { revenue: 0, orders: 0 })} />
                </li>
              )}
              <li
                onClick={() => router.push(`/orders/${o.id}`)}
                className={`cursor-pointer rounded-xl border border-border bg-card p-3 ${
                  selected.has(o.id) ? "border-brand/50 bg-brand/5" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${o.invoiceNumber ?? o.id}`}
                    checked={selected.has(o.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggle(o.id)}
                    className="mt-1 accent-[var(--brand)]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link
                        href={`/orders/${o.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-semibold text-brand hover:underline"
                      >
                        {o.invoiceNumber ?? `#${o.id.slice(0, 8)}`}
                      </Link>
                      <span className="font-semibold tabular-nums">{formatMoney(o.total)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm">{o.customerName || "—"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {o.customerPhone || "—"} · {o.brandName}
                    </p>
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    <OrderRowMenu orderId={o.id} />
                  </div>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
                  <div onClick={(e) => e.stopPropagation()}>
                    <OrderStatusControl
                      key={`${o.id}-${o.fulfillmentStatus}`}
                      orderId={o.id}
                      status={o.fulfillmentStatus}
                      variant="compact"
                    />
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>{dayLabel(o.paidAt)}</div>
                    {settledDayLabel(o.settledAt, o.paidAt) && (
                      <div className="mt-0.5">
                        {STATUS_LABELS[o.fulfillmentStatus]}: {settledDayLabel(o.settledAt, o.paidAt)}
                      </div>
                    )}
                    {o.deliveryAt && (
                      <div className="mt-0.5 flex items-center justify-end gap-1">
                        <Truck className="size-3" />
                        {formatDeliveryAt(o.deliveryAt)}
                      </div>
                    )}
                  </div>
                </div>
              </li>
              </Fragment>
            ))}
          </ul>
          <table className="hidden w-full text-sm md:table">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
                <th className="w-8 py-2 pr-2">
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
                <th className="hidden py-2 pr-4 lg:table-cell">Phone</th>
                <th className="py-2 pr-4 text-right">Total</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Date</th>
                <th className="w-10 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {paged.map((o, i) => (
                <Fragment key={o.id}>
                {(i === 0 || dayLabel(paged[i - 1].paidAt) !== dayLabel(o.paidAt)) && (
                  <tr className="border-b border-border bg-muted/50">
                    <td colSpan={9} className="border-l-[3px] border-l-brand py-3 pl-3">
                      <DayHeader day={dayLabel(o.paidAt)} {...(dayStats.get(dayLabel(o.paidAt)) ?? { revenue: 0, orders: 0 })} />
                    </td>
                  </tr>
                )}
                <tr
                  onClick={() => router.push(`/orders/${o.id}`)}
                  className={`cursor-pointer border-b border-border hover:bg-muted ${
                    selected.has(o.id) ? "bg-brand/5" : ""
                  }`}
                >
                  <td className="py-2 pr-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${o.invoiceNumber ?? o.id}`}
                      checked={selected.has(o.id)}
                      onChange={() => toggle(o.id)}
                      className="align-middle accent-[var(--brand)]"
                    />
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    <Link
                      href={`/orders/${o.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-semibold text-brand hover:underline"
                    >
                      {o.invoiceNumber ?? `#${o.id.slice(0, 8)}`}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{o.brandName}</td>
                  <td className="py-2 pr-4">
                    {o.customerName || "—"}
                    {/* The Phone column is hidden on tablets to give the rest room,
                        so the number sits under the name there instead. */}
                    <div className="text-xs text-muted-foreground lg:hidden">{o.customerPhone || "—"}</div>
                  </td>
                  <td className="hidden py-2 pr-4 text-muted-foreground lg:table-cell">{o.customerPhone || "—"}</td>
                  <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">{formatMoney(o.total)}</td>
                  <td className="py-2 pr-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
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
                  <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                    <div>{dayLabel(o.paidAt)}</div>
                    {settledDayLabel(o.settledAt, o.paidAt) && (
                      <div className="mt-0.5 text-xs font-medium">
                        {STATUS_LABELS[o.fulfillmentStatus]}: {settledDayLabel(o.settledAt, o.paidAt)}
                      </div>
                    )}
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
                  <td className="py-2" onClick={(e) => e.stopPropagation()}>
                    <OrderRowMenu orderId={o.id} />
                  </td>
                </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
          </>
        )}
      </div>

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-3 text-sm sm:px-6">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Items per page
            <select
              value={limit}
              onChange={(e) => navigate({ limit: e.target.value, page: "1" })}
              className="rounded border border-border bg-transparent px-2 py-1 text-xs text-foreground"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate({ page: String(page - 1) })}
              disabled={page <= 1}
              className="flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs disabled:opacity-30"
            >
              <ChevronLeft className="size-3.5" />
              Prev
            </button>
            <span className="tabular-nums text-muted-foreground">
              Page {page} of {pageCount}
            </span>
            <button
              type="button"
              onClick={() => navigate({ page: String(page + 1) })}
              disabled={page >= pageCount}
              className="flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs disabled:opacity-30"
            >
              Next
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
