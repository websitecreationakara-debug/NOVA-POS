import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvoice } from "@/lib/supabase/queries";
import OrderStatusControl from "@/components/OrderStatusControl";
import DeleteOrderButton from "@/components/DeleteOrderButton";

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const invoice = await getInvoice(orderId);

  if (!invoice) notFound();

  const { order, brandName, customerAddress, items } = invoice;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/orders" className="text-sm text-muted-foreground hover:underline">
          ← Back to Orders
        </Link>
        <div className="flex items-center gap-4">
          <Link href={`/invoice/${order.id}`} className="text-sm text-brand hover:underline">
            View printable invoice →
          </Link>
          <DeleteOrderButton orderId={order.id} redirectTo="/orders" />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h1 className="text-xl font-semibold">
              {order.invoice_number ?? `#${order.id.slice(0, 8)}`}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {order.paid_at ? new Date(order.paid_at).toLocaleString() : "—"}
            </p>
          </div>
          <OrderStatusControl orderId={order.id} status={order.fulfillment_status} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground">Phone Number</p>
            <p className="font-medium">{order.customer_phone || "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Address</p>
            <p className="font-medium">{customerAddress || "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Business</p>
            <p className="font-medium">{brandName}</p>
          </div>
        </div>

        <div className="mt-6">
          <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
            Products
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {items.length}
            </span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
                  <th className="py-2">Product Name</th>
                  <th className="py-2 text-right">Amount</th>
                  <th className="py-2">Unit</th>
                  <th className="py-2 text-right">Unit Price</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="py-2">{item.name}</td>
                    <td className="py-2 text-right">{item.quantity}</td>
                    <td className="py-2">{item.unit}</td>
                    <td className="py-2 text-right">{formatMoney(item.unitPrice)}</td>
                    <td className="py-2 text-right font-medium text-success">
                      {formatMoney(item.lineTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 ml-auto flex max-w-xs flex-col gap-1 text-sm">
          {order.discount > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Discount</span>
              <span>-{formatMoney(order.discount)}</span>
            </div>
          )}
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span>{formatMoney(order.subtotal)}</span>
          </div>
          {order.delivery_fee > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Delivery</span>
              <span>{formatMoney(order.delivery_fee)}</span>
            </div>
          )}
          <div className="mt-2 flex justify-between border-t border-border pt-2 text-base font-bold text-success">
            <span>Grand Total</span>
            <span>{formatMoney(order.total)}</span>
          </div>
        </div>
      </div>
    </main>
  );
}
