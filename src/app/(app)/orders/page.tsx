import Link from "next/link";
import { getOrdersList } from "@/lib/supabase/queries";
import { FULFILLMENT_STATUSES, STATUS_LABELS } from "@/lib/orderStatus";
import OrderStatusControl from "@/components/OrderStatusControl";
import DeleteOrderButton from "@/components/DeleteOrderButton";
import type { FulfillmentStatus } from "@/types/database";

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusParam } = await searchParams;
  const status = FULFILLMENT_STATUSES.includes(statusParam as FulfillmentStatus)
    ? (statusParam as FulfillmentStatus)
    : undefined;

  const orders = await getOrdersList(status);

  return (
    <main className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-black/[.08] px-6 py-3 dark:border-white/[.145]">
        <h1 className="text-lg font-medium">Orders</h1>
        <span className="text-sm text-muted-foreground">
          Orders staff prepare for pickup/delivery
        </span>
      </header>

      <div className="flex flex-wrap gap-2 px-6 py-4">
        <Link
          href="/orders"
          className={`rounded-full px-3 py-1.5 text-sm font-medium ${
            !status ? "bg-brand text-black" : "bg-muted text-muted-foreground"
          }`}
        >
          All
        </Link>
        {FULFILLMENT_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/orders?status=${s}`}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              status === s ? "bg-brand text-black" : "bg-muted text-muted-foreground"
            }`}
          >
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No orders found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
                <th className="py-2 pr-4">Invoice</th>
                <th className="py-2 pr-4">Business</th>
                <th className="py-2 pr-4">Customer</th>
                <th className="py-2 pr-4">Phone</th>
                <th className="py-2 pr-4 text-right">Total</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Date</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-border hover:bg-muted">
                  <td className="py-2 pr-4">
                    <Link href={`/orders/${o.id}`} className="font-medium text-brand">
                      {o.invoiceNumber ?? `#${o.id.slice(0, 8)}`}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{o.brandName}</td>
                  <td className="py-2 pr-4">{o.customerName || "—"}</td>
                  <td className="py-2 pr-4">{o.customerPhone || "—"}</td>
                  <td className="py-2 pr-4 text-right">{formatMoney(o.total)}</td>
                  <td className="py-2 pr-4">
                    <OrderStatusControl orderId={o.id} status={o.fulfillmentStatus} variant="compact" />
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {o.paidAt ? new Date(o.paidAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="py-2">
                    <DeleteOrderButton orderId={o.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
