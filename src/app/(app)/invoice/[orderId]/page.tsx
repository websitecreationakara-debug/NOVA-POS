import { notFound } from "next/navigation";
import { getInvoice } from "@/lib/supabase/queries";
import { invoiceBrandConfig, brandLogoPath } from "@/lib/invoiceBrands";
import PrintButton from "@/components/PrintButton";
import OrderStatusControl from "@/components/OrderStatusControl";

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

const PAYMENT_LABELS: Record<string, string> = {
  bank_qr: "BANK TRS",
  cash: "CASH",
};

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const invoice = await getInvoice(orderId);

  if (!invoice) notFound();

  const { order, brandName, brandSlug, brandLogoUrl, customerAddress, items } = invoice;
  const brand = invoiceBrandConfig(brandSlug);
  const logo = brandLogoUrl ?? brandLogoPath(brandSlug);

  const paymentLabel = order.payment_method
    ? (PAYMENT_LABELS[order.payment_method] ?? order.payment_method)
    : "—";
  const termsLabel = order.delivery_fee > 0 ? formatMoney(order.delivery_fee) : "Free Delivery";

  // Right-hand totals column. Grand Total is always last; the rest only show
  // when they carry a value, except Subtotal which is always useful.
  const totals: { label: string; value: string; strong?: boolean; accent?: boolean }[] = [];
  if (order.discount > 0) {
    totals.push({ label: "បញ្ចុះតម្លៃ / Discount", value: `-${formatMoney(order.discount)}` });
  }
  totals.push({ label: "ទំនិញសរុប / Subtotal", value: formatMoney(order.subtotal), accent: true });
  if (order.tax > 0) totals.push({ label: "Tax", value: formatMoney(order.tax) });
  totals.push({ label: "ដឹកជញ្ជូន / Delivery", value: formatMoney(order.delivery_fee) });
  totals.push({
    label: "ថ្លៃសរុប / Grand Total",
    value: formatMoney(order.total),
    strong: true,
    accent: true,
  });

  const info: { label: string; value: string }[] = [
    { label: "លក្ខ័ណ្ឌ / Terms", value: termsLabel },
    { label: "ម៉ោងដឹក / Delivery time", value: formatDateTime(order.paid_at) },
    { label: "កម្មង់តាម / Ordered via", value: "—" },
    { label: "បង់ប្រាក់តាម / Payment", value: paymentLabel },
  ];

  return (
    <div className="mx-auto max-w-2xl p-8 print:p-0">
      <div className="mb-6 flex justify-end gap-3 print:hidden">
        <OrderStatusControl orderId={order.id} status={order.fulfillment_status} />
        <PrintButton />
      </div>

      {/* Printed document: always white/black regardless of app theme. */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-zinc-900 print:rounded-none print:border-0 print:p-0">
        {/* Letterhead */}
        <div className="flex items-start justify-between gap-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={brandName} className="h-14 w-auto object-contain" />
          ) : (
            <h1 className="text-2xl font-bold tracking-wide">{brandName}</h1>
          )}
          {brand.contactLine && (
            <p className="max-w-[45%] pt-1 text-right text-xs leading-relaxed text-zinc-600">
              {brand.contactLine}
            </p>
          )}
        </div>

        {/* Title bar */}
        <div className="mt-5 border border-zinc-800 py-2 text-center">
          <span className="text-sm font-bold tracking-wide">INVOICE វិក័យបត្រ</span>
        </div>

        {/* Bill-to / invoice meta */}
        <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-2 text-[13px]">
          <Field label="ជូន / To" value={order.customer_name || "—"} />
          <Field
            label="លេខវិក័យបត្រ / Invoice No"
            value={order.invoice_number ?? `#${order.id.slice(0, 8)}`}
          />
          <Field label="លេខទូរស័ព្ទ / Phone" value={order.customer_phone || "—"} />
          <Field label="ថ្ងៃបញ្ជាទិញ / Date" value={formatDateTime(order.paid_at)} />
          <Field label="អាសយដ្ឋាន / Address" value={customerAddress || "—"} />
        </div>

        {/* Items + totals */}
        <table className="mt-5 w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-zinc-50 text-center align-bottom">
              <Th className="text-left">Product Name បរិយាយទំនិញ</Th>
              <Th className="w-14">QTY បរិមាណ</Th>
              <Th className="w-16">UOM ឯកតា</Th>
              <Th className="w-20">Unit Price តម្លៃឯកតា</Th>
              <Th className="w-20">Total សរុប</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i}>
                <Td>{item.name}</Td>
                <Td className="text-center tabular-nums">{item.quantity.toFixed(2)}</Td>
                <Td className="text-center">{item.unit || "—"}</Td>
                <Td className="text-right tabular-nums">{formatMoney(item.unitPrice)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(item.lineTotal)}</Td>
              </tr>
            ))}

            {totals.map((row, i) => (
              <tr key={row.label}>
                {i === 0 && (
                  <td
                    rowSpan={totals.length}
                    className="border border-zinc-400 p-0 align-top"
                  >
                    <dl className="flex h-full flex-col gap-1.5 p-2 text-[12px]">
                      {info.map((f) => (
                        <div key={f.label} className="flex gap-1.5">
                          <dt className="shrink-0 font-semibold">{f.label}:</dt>
                          <dd className="text-zinc-700">{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </td>
                )}
                <td
                  className={`border border-zinc-400 px-2 py-1 ${
                    row.strong ? "font-bold" : ""
                  }`}
                >
                  {row.label}
                </td>
                <td
                  className={`border border-zinc-400 px-2 py-1 text-right tabular-nums ${
                    row.strong ? "font-bold" : ""
                  } ${row.accent ? "text-green-600" : ""}`}
                >
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Remarks */}
        <div className="mt-4 text-[12px] leading-relaxed">
          <p className="font-semibold">Remarks: កំណត់ចំណាំៈ</p>
          {brand.remarks.map((r, i) => (
            <p key={i}>- {r}</p>
          ))}
        </div>

        {/* KHQR */}
        {brand.khqrUrl && (
          <div className="mt-6 flex flex-col items-center">
            <div className="rounded-lg border border-zinc-300 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={brand.khqrUrl}
                alt="KHQR"
                className="h-44 w-44 object-contain"
              />
            </div>
            <p className="mt-2 text-sm font-bold tracking-wide">{brand.khqrLabel}</p>
          </div>
        )}

        {/* Closing */}
        <div className="mt-8 space-y-1 text-center text-[12px] text-zinc-700">
          {brand.closing.map((line, i) => (
            <p key={i} className={i === 0 ? "font-semibold text-zinc-900" : ""}>
              {line}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <span className="shrink-0 text-zinc-500">{label}:</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`border border-zinc-400 px-2 py-1.5 text-[11px] font-bold ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`border border-zinc-400 px-2 py-1.5 ${className}`}>{children}</td>;
}
