"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { OrderListRow } from "@/lib/supabase/queries";
import { formatUsd } from "@/lib/formatNumber";
import { STATUS_LABELS, STATUS_STYLES } from "@/lib/orderStatus";

function dayLabel(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: "Asia/Phnom_Penh" }) : "—";
}

// The same row the Orders page shows (invoice, business, customer, phone, total,
// status, date), read-only. Whole-row navigation needs a click handler, so this
// slice of the dashboard table is a client component -- the row itself opens the
// order, like on the Orders page.
export default function RecentOrdersRows({ orders }: { orders: OrderListRow[] }) {
  const router = useRouter();
  // An order opened from here sends the Dashboard's address (filters included) along,
  // so its "Back" returns to this table instead of the Orders list.
  const query = useSearchParams().toString();
  const back = `/${query ? `?${query}` : ""}#recent-orders`;
  const orderHref = (id: string) => `/orders/${id}?back=${encodeURIComponent(back)}`;

  if (orders.length === 0) {
    return (
      <tr>
        <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground sm:px-6">
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
          onClick={() => router.push(orderHref(o.id))}
          className="cursor-pointer border-t border-border transition-colors hover:bg-muted/60"
        >
          <td className="py-3 pr-2 pl-4 whitespace-nowrap sm:px-6">
            <Link
              href={orderHref(o.id)}
              onClick={(e) => e.stopPropagation()}
              className="font-semibold text-brand hover:underline"
            >
              {o.invoiceNumber ?? `#${o.id.slice(0, 8)}`}
            </Link>
          </td>
          <td className="px-2 py-3 sm:px-3">{o.brandName}</td>
          <td className="px-2 py-3 sm:px-3">
            {o.customerName || "—"}
            {/* The Phone column is hidden below lg, so the number sits under the name there. */}
            <div className="text-xs text-muted-foreground lg:hidden">{o.customerPhone || "—"}</div>
          </td>
          <td className="hidden px-2 py-3 text-muted-foreground sm:px-3 lg:table-cell">{o.customerPhone || "—"}</td>
          <td className="px-2 py-3 text-right whitespace-nowrap tabular-nums sm:px-3">{formatUsd(o.total)}</td>
          <td className="px-2 py-3 whitespace-nowrap sm:px-3">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[o.fulfillmentStatus]}`}
            >
              {STATUS_LABELS[o.fulfillmentStatus]}
            </span>
          </td>
          <td className="py-3 pr-4 pl-2 whitespace-nowrap text-muted-foreground sm:px-6">{dayLabel(o.listAt)}</td>
        </tr>
      ))}
    </>
  );
}
