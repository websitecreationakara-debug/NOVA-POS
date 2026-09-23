"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getRecentOrderActivityAction } from "@/app/(app)/orders/actions";
import { getCategoriesFingerprintAction } from "@/app/(app)/stock/actions";
import { notifyOrdersChanged } from "@/lib/ordersChanged";

// A website order arrives via /api/order-sync and a status change via
// /api/order-status-sync -- both server-to-server calls that never touch a
// staff member's browser, so nothing normally tells an already-open POS tab
// (the orders list, an order/invoice page, the dashboard) to refetch. This
// polls a cheap fingerprint of recent order activity and, the moment it
// differs from the last poll, refreshes the current page's server data and
// fires the same ORDERS_CHANGED event a local action would -- so the result
// shows up on its own, no manual reload needed.
//
// Categories ride along on the same tick for the same reason: they're
// server-rendered props (Sales/Stock both get them from getCatalogForBrand),
// so a category created/renamed/reordered/deleted in an already-open Stock
// tab never reaches an already-open Sales tab on its own -- revalidatePath
// only invalidates the Next.js cache, it doesn't push into a mounted page.
//
// This is the one poll every other "did anything change" consumer (the
// Orders sidebar badge, in particular) piggybacks on via ORDERS_CHANGED
// instead of running its own timer -- so this interval is the actual
// request-rate knob for the whole app. It's mounted globally (TopBar) and
// running on every open tab of every signed-in staff member, all day, so it
// was previously the single biggest driver of Worker CPU usage: 4s meant
// ~900 requests/hour *per open tab*. 15s cuts that to ~240/hour with barely
// any perceptible change in how "live" the app feels for a POS.
const POLL_MS = 15_000;

export default function LiveOrdersWatcher() {
  const router = useRouter();
  // null until the first poll lands -- that first result is a baseline, not
  // a "change" to react to.
  const lastSignatureRef = useRef<string | null>(null);
  // Same baseline convention as above, for categories -- piggybacked onto
  // this same tick (see the file-level comment) rather than its own poll.
  const lastCategoriesRef = useRef<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    async function check() {
      if (document.visibilityState !== "visible") return;
      const [ordersResult, categoriesResult] = await Promise.allSettled([
        getRecentOrderActivityAction(),
        getCategoriesFingerprintAction(),
      ]);

      let changed = false;

      if (ordersResult.status === "fulfilled") {
        const signature = ordersResult.value.map((r) => `${r.id}:${r.fulfillmentStatus}`).join("|");
        if (lastSignatureRef.current !== null && lastSignatureRef.current !== signature) {
          changed = true;
          notifyOrdersChanged();
        }
        lastSignatureRef.current = signature;
      } // a rejected fetch just leaves the baseline as-is -- next tick retries

      if (categoriesResult.status === "fulfilled") {
        const signature = categoriesResult.value;
        if (lastCategoriesRef.current !== null && lastCategoriesRef.current !== signature) {
          changed = true;
        }
        lastCategoriesRef.current = signature;
      }

      if (changed) router.refresh();
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
