"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getLiveChangeStampAction } from "@/app/(app)/orders/actions";
import { notifyOrdersChanged } from "@/lib/ordersChanged";

// A website order arrives via /api/order-sync and a status change via
// /api/order-status-sync -- both server-to-server calls that never touch a
// staff member's browser, and an edit made on another device never reaches
// this one either, so nothing normally tells an already-open POS tab (orders,
// stock, customers, the dashboard...) to refetch. This polls one cheap stamp
// that changes whenever anything in the database is written and, the moment it
// differs from the last poll, refreshes the current page's server data and
// fires the same ORDERS_CHANGED event a local action would -- so the result
// shows up on its own, no manual reload needed. (Categories are covered too:
// they're server-rendered props, and revalidatePath only invalidates the
// Next.js cache, it doesn't push into a mounted page.)
//
// This is the one poll every other "did anything change" consumer (the
// Orders sidebar badge, in particular) piggybacks on via ORDERS_CHANGED
// instead of running its own timer -- so this interval is the actual
// request-rate knob for the whole app. It's mounted globally (TopBar) and
// running on every open tab of every signed-in staff member, all day, so keep
// it to one request per tick: 5s is ~720 requests/hour per open tab (4s with
// the old three-request tick was the biggest driver of Worker CPU usage).
const POLL_MS = 5_000;

export default function LiveOrdersWatcher() {
  const router = useRouter();
  // null until the first poll lands -- that first result is a baseline, not
  // a "change" to react to.
  const lastStampRef = useRef<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    async function check() {
      if (document.visibilityState !== "visible") return;
      let stamp: string;
      try {
        stamp = await getLiveChangeStampAction();
      } catch {
        return; // a failed fetch leaves the baseline as-is -- next tick retries
      }

      if (lastStampRef.current !== null && lastStampRef.current !== stamp) {
        notifyOrdersChanged();
        router.refresh();
      }
      lastStampRef.current = stamp;
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
