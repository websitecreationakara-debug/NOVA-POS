import { notFound } from "next/navigation";
import { getInvoice } from "@/lib/supabase/queries";
import PrintButton from "@/components/PrintButton";

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const invoice = await getInvoice(orderId);

  if (!invoice) notFound();

  const { order, brandName, items } = invoice;

  return (
    <div className="mx-auto max-w-2xl p-8 print:p-0">
      <div className="mb-6 flex justify-end print:hidden">
        <PrintButton />
      </div>

      <div className="rounded-2xl border border-border bg-card p-8 print:rounded-none print:border-0 print:p-0">
        <div className="flex items-start justify-between border-b border-border pb-6">
          <div>
            <h1 className="font-display text-2xl font-bold">{brandName}</h1>
          </div>
          <div className="text-right">
            <h2 className="font-display text-xl font-bold text-brand">INVOICE</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {order.invoice_number ?? `#${order.id.slice(0, 8)}`}
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
              Date
            </p>
            <p className="mt-1">
              {order.paid_at ? new Date(order.paid_at).toLocaleString() : "—"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
              Payment method
            </p>
            <p className="mt-1 capitalize">{order.payment_method?.replace("_", " / ") ?? "—"}</p>
          </div>
        </div>

        <table className="mt-8 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-bold tracking-widest text-muted-foreground uppercase">
              <th className="py-2">Item</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit Price</th>
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} className="border-b border-border/60">
                <td className="py-2">{item.name}</td>
                <td className="py-2 text-right">
                  {item.quantity} {item.unit}
                </td>
                <td className="py-2 text-right">{formatMoney(item.unitPrice)}</td>
                <td className="py-2 text-right">{formatMoney(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 ml-auto flex max-w-xs flex-col gap-1 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span>{formatMoney(order.subtotal)}</span>
          </div>
          {order.discount > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Discount</span>
              <span>-{formatMoney(order.discount)}</span>
            </div>
          )}
          {order.tax > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Tax</span>
              <span>{formatMoney(order.tax)}</span>
            </div>
          )}
          <div className="mt-2 flex justify-between border-t border-border pt-2 text-base font-bold">
            <span>Total</span>
            <span>{formatMoney(order.total)}</span>
          </div>
        </div>

        <p className="mt-10 text-center text-xs text-muted-foreground">Thank you for your purchase.</p>
      </div>
    </div>
  );
}
