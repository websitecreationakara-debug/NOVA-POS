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

  const { order, brandName, brandLogoUrl, items } = invoice;

  return (
    <div className="mx-auto max-w-2xl p-8 print:p-0">
      <div className="mb-6 flex justify-end print:hidden">
        <PrintButton />
      </div>

      {/* Printed document: always white/black regardless of app theme. */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-zinc-900 print:rounded-none print:border-0 print:p-0">
        <div className="flex items-center justify-between border-b-2 border-zinc-900 pb-4">
          {brandLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brandLogoUrl} alt={brandName} className="h-16 w-auto object-contain" />
          ) : (
            <h1 className="text-2xl font-bold">{brandName}</h1>
          )}
          <div className="text-right">
            <h2 className="text-xl font-bold text-amber-600">INVOICE វិក្កយបត្រ</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {order.invoice_number ?? `#${order.id.slice(0, 8)}`}
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <span className="text-zinc-500">ជូន / To: </span>
            <span className="font-medium">{order.customer_name || "—"}</span>
          </div>
          <div className="text-right">
            <span className="text-zinc-500">លេខវិក្កយបត្រ / Invoice No: </span>
            <span className="font-medium">{order.invoice_number ?? "—"}</span>
          </div>
          <div>
            <span className="text-zinc-500">លេខទូរស័ព្ទ / Phone: </span>
            <span className="font-medium">{order.customer_phone || "—"}</span>
          </div>
          <div className="text-right">
            <span className="text-zinc-500">ថ្ងៃបញ្ជាទិញ / Date: </span>
            <span className="font-medium">
              {order.paid_at ? new Date(order.paid_at).toLocaleString() : "—"}
            </span>
          </div>
        </div>

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-900 text-left text-xs font-bold text-zinc-600">
              <th className="py-2">Product Name បរិយាយទំនិញ</th>
              <th className="py-2 text-right">QTY បរិមាណ</th>
              <th className="py-2 text-right">UOM ឯកតា</th>
              <th className="py-2 text-right">Unit Price តម្លៃឯកតា</th>
              <th className="py-2 text-right">Total សរុប</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} className="border-b border-zinc-200">
                <td className="py-2">{item.name}</td>
                <td className="py-2 text-right">{item.quantity}</td>
                <td className="py-2 text-right">{item.unit}</td>
                <td className="py-2 text-right">{formatMoney(item.unitPrice)}</td>
                <td className="py-2 text-right">{formatMoney(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 ml-auto flex max-w-xs flex-col gap-1 text-sm">
          {order.discount > 0 && (
            <div className="flex justify-between text-zinc-600">
              <span>បញ្ចុះតម្លៃ / Discount</span>
              <span>-{formatMoney(order.discount)}</span>
            </div>
          )}
          <div className="flex justify-between text-zinc-600">
            <span>ទំនិញសរុប / Subtotal</span>
            <span>{formatMoney(order.subtotal)}</span>
          </div>
          {order.tax > 0 && (
            <div className="flex justify-between text-zinc-600">
              <span>Tax</span>
              <span>{formatMoney(order.tax)}</span>
            </div>
          )}
          <div className="mt-2 flex justify-between border-t-2 border-zinc-900 pt-2 text-base font-bold text-amber-600">
            <span>ថ្លៃសរុប / Grand Total</span>
            <span>{formatMoney(order.total)}</span>
          </div>
        </div>

        <p className="mt-10 text-center text-xs text-zinc-500">
          Thank you for your purchase. អរគុណសម្រាប់ការគាំទ្រ
        </p>
      </div>
    </div>
  );
}
