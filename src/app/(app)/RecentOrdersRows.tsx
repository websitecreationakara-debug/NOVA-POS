"use client";

import { useRouter } from "next/navigation";
import type { DashboardStats } from "@/lib/supabase/queries";

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

// Whole-row navigation needs a click handler, so this one slice of the
// dashboard table is a client component -- the row itself is the link
// target, not just the id/total text inside it.
export default function RecentOrdersRows({
  orders,
}: {
  orders: DashboardStats["recentOrders"];
}) {
  const router = useRouter();

  if (orders.length === 0) {
    return (
      <tr>
        <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
          No orders yet.
        </td>
      </tr>
    );
  }

  return (
    <>
      {orders.map((o) => (
        <tr
          key={o.id}
          onClick={() => router.push(`/invoice/${o.id}`)}
          className="cursor-pointer border-t border-border transition-colors hover:bg-muted/60"
        >
          <td className="px-6 py-3 font-mono text-xs font-semibold text-foreground">
            {o.id.slice(0, 8)}
          </td>
          <td className="px-3 py-3 text-muted-foreground">{o.brandName}</td>
          <td className="px-3 py-3">
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 uppercase dark:text-emerald-400">
              {o.status}
            </span>
          </td>
          <td className="px-6 py-3 text-right font-bold tabular-nums">{formatMoney(o.total)}</td>
        </tr>
      ))}
    </>
  );
}
