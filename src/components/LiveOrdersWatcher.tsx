"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getRecentOrderActivityAction } from "@/app/(app)/orders/actions";
import { notifyOrdersChanged } from "@/lib/ordersChanged";

// A website order arrives via /api/order-sync and a status change via
// /api/order-status-sync -- both server-to-server calls that never touch a
// staff member's browser, so nothing normally tells an already-open POS tab
// (the orders list, an order/invoice page, the dashboard) to refetch. This
// polls a cheap fingerprint of recent order activity and, the moment it
// differs from the last poll, refreshes the current page's server data and
// fires the same ORDERS_CHANGED event a local action would -- so the result
// shows up on its own, no manual reload needed.
const POLL_MS = 4_000;

export default function LiveOrdersWatcher() {
  const router = useRouter();
  // null until the first poll lands -- that first result is a baseline, not
  // a "change" to react to.
  const lastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    async function check() {
      if (document.visibilityState !== "visible") return;
      let rows: Awaited<ReturnType<typeof getRecentOrderActivityAction>>;
      try {
        rows = await getRecentOrderActivityAction();
      } catch {
        return; // transient network hiccup -- next tick tries again
      }
      const signature = rows.map((r) => `${r.id}:${r.fulfillmentStatus}`).join("|");
      if (lastSignatureRef.current !== null && lastSignatureRef.current !== signature) {
        router.refresh();
        notifyOrdersChanged();
      }
      lastSignatureRef.current = signature;
    }

    void check();
    timer = setInterval(check, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, [router]);

  return null;
}
