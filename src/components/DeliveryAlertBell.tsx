"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Receipt } from "lucide-react";
import { getDueDeliveries, type DueDelivery } from "@/app/(app)/orders/actions";
import { ORDERS_CHANGED } from "@/lib/ordersChanged";
import { SALE_CHARGED, type SaleChargedDetail } from "@/lib/saleCharged";

const POLL_MS = 60_000;
// While an order is overdue and still not marked done, nag again this often.
const OVERDUE_REPEAT_MS = 30 * 60_000;

// Escalation step for a delivery time: 0 = entered the 1h window, 1 = under
// 30 min, 2 = under 15 min, 3 = overdue. The alert re-fires each time an
// order moves up a step (and keeps nagging once overdue).
function alertStep(iso: string): number {
  const mins = (new Date(iso).getTime() - Date.now()) / 60_000;
  if (mins < 0) return 3;
  if (mins < 15) return 2;
  if (mins < 30) return 1;
  return 0;
}

// "in 1h 20m" / "in 15m" / "overdue 40m" for a delivery timestamp.
function relTime(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const body = [h ? `${h}h` : "", m || !h ? `${m}m` : ""].filter(Boolean).join(" ");
  return diff < 0 ? `overdue ${body}` : `in ${body}`;
}

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

// "just now" / "5m ago" for a charge timestamp (epoch ms).
function agoLabel(at: number): string {
  const mins = Math.floor((Date.now() - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

type RecentSale = SaleChargedDetail & { id: string; at: number };
const MAX_RECENT_SALES = 5;

// Polls for orders whose requested delivery time is within 1 hour (or past)
// and not finished, and alerts staff -- a badge count, a list, and a browser
// notification (if permission was already granted) when a new one enters the
// window. No sound -- just the visual badge/list/notification.
export default function DeliveryAlertBell() {
  const [items, setItems] = useState<DueDelivery[]>([]);
  // Sales charged in this tab -- newest first, capped. Fired synchronously by
  // the charge action itself (see notifySaleCharged), so this updates the
  // instant the cashier clicks Charge rather than on the next poll.
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [unseenSales, setUnseenSales] = useState(0);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Per order: the escalation step we last alerted at, and when. Re-alert when
  // an order moves up a step, or (once overdue) every OVERDUE_REPEAT_MS. Stays
  // mounted across page navigation, so this persists too.
  const alertedRef = useRef<Map<string, { step: number; at: number }>>(new Map());

  const load = useCallback(async () => {
    let data: DueDelivery[];
    try {
      data = await getDueDeliveries();
    } catch {
      return;
    }
    setItems(data);

    const now = Date.now();

    const toAlert = data.filter((d) => {
      const step = alertStep(d.deliveryAt);
      const prev = alertedRef.current.get(d.id);
      if (!prev) return true; // new to the list
      if (step > prev.step) return true; // crossed into 1h / 30m / overdue
      if (step === 3 && now - prev.at >= OVERDUE_REPEAT_MS) return true; // still overdue
      return false;
    });

    // Record the current step for everything still in the list; only bump the
    // timestamp for the ones we're alerting on now.
    const alerting = new Set(toAlert.map((d) => d.id));
    const nextState = new Map<string, { step: number; at: number }>();
    for (const d of data) {
      const step = alertStep(d.deliveryAt);
      const prev = alertedRef.current.get(d.id);
      nextState.set(d.id, { step, at: alerting.has(d.id) ? now : (prev?.at ?? now) });
    }
    // Orders no longer in `data` are dropped from state, so one that re-enters
    // the window (e.g. its status was reverted) alerts again.
    alertedRef.current = nextState;

    if (toAlert.length > 0 && typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(
        `${toAlert.length} delivery${toAlert.length === 1 ? "" : " orders"} due`,
        {
          body: toAlert
            .map((f) => `${f.customerName ?? f.invoiceNumber ?? "Order"} — ${relTime(f.deliveryAt)}`)
            .join("\n"),
          tag: "nova-delivery-due",
        }
      );
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onFocus = () => void load();
    // Re-pull immediately when an order changes anywhere in the app (deleted,
    // status updated, bulk-updated) instead of waiting for the next poll.
    const onOrdersChanged = () => void load();
    window.addEventListener("focus", onFocus);
    window.addEventListener(ORDERS_CHANGED, onOrdersChanged);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(ORDERS_CHANGED, onOrdersChanged);
    };
  }, [load]);

  // A sale charged in this tab -- shows up in the list and notifies
  // immediately, same as a delivery crossing into its alert window.
  useEffect(() => {
    function onSaleCharged(e: Event) {
      const detail = (e as CustomEvent<SaleChargedDetail>).detail;
      if (!detail) return;
      setRecentSales((prev) =>
        [{ ...detail, id: `${detail.orderId}-${Date.now()}`, at: Date.now() }, ...prev].slice(
          0,
          MAX_RECENT_SALES
        )
      );
      setUnseenSales((n) => n + 1);
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(`Sale charged — ${formatMoney(detail.amount)}`, {
          body: [detail.customerName, detail.invoiceNumber].filter(Boolean).join(" · ") || undefined,
          tag: `nova-sale-${detail.orderId}`,
        });
      }
    }
    window.addEventListener(SALE_CHARGED, onSaleCharged);
    return () => window.removeEventListener(SALE_CHARGED, onSaleCharged);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = items.length + unseenSales;
  const anyUrgent = items.some((i) => alertStep(i.deliveryAt) >= 2);

  function toggleOpen() {
    setOpen((v) => {
      const next = !v;
      // Opening the bell counts as having seen the recent sales -- the badge
      // settles back down to just the delivery count until the next charge.
      if (next) setUnseenSales(0);
      // A real click, so the browser allows the permission prompt -- lets
      // someone opt into desktop notifications without a dedicated toggle.
      if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission();
      }
      return next;
    });
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        aria-label={`Alerts${count ? ` (${count})` : ""}`}
        className="relative grid size-9 place-items-center rounded-full bg-muted text-muted-foreground hover:text-foreground"
      >
        <Bell className="size-4" />
        {count > 0 && (
          <span
            className={`absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold text-white ${
              anyUrgent ? "bg-red-600" : "bg-amber-500"
            }`}
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          <div className="border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold">Alerts</span>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {recentSales.length > 0 && (
              <>
                <p className="bg-muted/50 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Recent sales
                </p>
                {recentSales.map((s) => (
                  <Link
                    key={s.id}
                    href={`/invoice/${s.orderId}`}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-3 border-b border-border px-4 py-2.5 last:border-b-0 hover:bg-muted"
                  >
                    <Receipt className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {s.customerName || s.invoiceNumber || "Sale"}
                      </span>
                      <span className="block text-xs text-muted-foreground">{agoLabel(s.at)}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatMoney(s.amount)}
                    </span>
                  </Link>
                ))}
              </>
            )}
            {recentSales.length > 0 && items.length > 0 && (
              <p className="bg-muted/50 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Deliveries due soon
              </p>
            )}
            {items.length === 0 && recentSales.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Nothing due in the next hour.
              </p>
            ) : (
              items.map((d) => {
                // Red once it's inside 30 min or overdue, amber otherwise.
                const urgent = alertStep(d.deliveryAt) >= 2;
                return (
                  <Link
                    key={d.id}
                    href={`/orders/${d.id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-3 border-b border-border px-4 py-2.5 last:border-b-0 hover:bg-muted"
                  >
                    <span
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${
                        urgent ? "bg-red-500" : "bg-amber-500"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {d.customerName || d.invoiceNumber || "Order"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {d.brandName} · {whenLabel(d.deliveryAt)}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-xs font-semibold ${
                        urgent
                          ? "text-red-600 dark:text-red-400"
                          : "text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      {relTime(d.deliveryAt)}
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
