import { notFound } from "next/navigation";
import { Hanuman } from "next/font/google";
import { getInvoice } from "@/lib/supabase/queries";
import { invoiceBrandConfig, brandLogoPath } from "@/lib/invoiceBrands";
import PrintButton from "@/components/PrintButton";
import OrderStatusControl from "@/components/OrderStatusControl";

// Khmer + Latin webfont for the printed document so the bilingual labels
// render consistently on screen and in the PDF.
const hanuman = Hanuman({
  subsets: ["khmer", "latin"],
  weight: ["400", "700"],
  display: "swap",
});

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
  const deliveryTerms = order.delivery_fee > 0 ? formatMoney(order.delivery_fee) : "Free Delivery";

  // Left block under the items -- the four sub-detail lines.
  const subDetails: { kh: string; en: string; value: string }[] = [
    { kh: "ពិពណ៌នា", en: "Description", value: deliveryTerms },
    { kh: "ម៉ោងដឹក", en: "Order Time", value: formatDateTime(order.paid_at) },
    { kh: "កម្មង់តាម", en: "Order Channel", value: "—" },
    { kh: "បង់ប្រាក់តាម", en: "Payment Method", value: paymentLabel },
  ];

  // Right block under the items -- the financial summary. Grand Total is always
  // last; Discount/Tax only appear when non-zero.
  type SumRow = { kh: string; en: string; value: string; kind?: "subtotal" | "total" };
  const summary: SumRow[] = [];
  summary.push({
    kh: "បញ្ចុះតម្លៃ",
    en: "Discount",
    value: order.discount > 0 ? `-${formatMoney(order.discount)}` : formatMoney(0),
  });
  summary.push({
    kh: "ទំនិញសរុប",
    en: "Subtotal",
    value: formatMoney(order.subtotal),
    kind: "subtotal",
  });
  if (order.tax > 0) summary.push({ kh: "ពន្ធ", en: "Tax", value: formatMoney(order.tax) });
  summary.push({
    kh: "ដឹកជញ្ជូន និងវេចខ្ចប់",
    en: "Delivery",
    value: order.delivery_fee > 0 ? formatMoney(order.delivery_fee) : "",
  });
  summary.push({
    kh: "ថ្លៃសរុប",
    en: "Total",
    value: formatMoney(order.total),
    kind: "total",
  });

  return (
    <div className={`${hanuman.className} mx-auto max-w-2xl p-8 print:p-0`}>
      <div className="mb-6 flex items-center justify-end gap-3 print:hidden">
        <OrderStatusControl orderId={order.id} status={order.fulfillment_status} />
        <PrintButton />
      </div>

      {/* Printed document: always white/black regardless of app theme. */}
      <div className="invoice-sheet rounded-2xl border border-zinc-200 bg-white p-8 text-black print:rounded-none print:border-0 print:p-0">
        {/* 1. Header */}
        <header className="flex items-start justify-between gap-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={brandName} className="h-14 w-auto object-contain" />
          ) : (
            <h1 className="text-2xl font-bold tracking-wide">{brandName}</h1>
          )}
          {brand.contactLine && (
            <p className="max-w-[46%] pt-1 text-right text-[11px] leading-relaxed">
              {brand.contactLine}
            </p>
          )}
        </header>

        <div className="mt-4 border-2 border-black py-2 text-center text-sm font-bold tracking-wide">
          INVOICE វិក្កយបត្រ
        </div>

        {/* 2. Customer & metadata grid */}
        <div className="mt-4 grid grid-cols-2 gap-x-10 gap-y-1.5 text-[12px]">
          <Meta kh="ឈ្មោះ" en="Name" value={order.customer_name || "—"} />
          <Meta
            kh="លេខវិក្កយបត្រ"
            en="Invoice Number"
            value={order.invoice_number ?? `#${order.id.slice(0, 8)}`}
          />
          <Meta kh="លេខទូរស័ព្ទ" en="Phone Number" value={order.customer_phone || "—"} />
          <Meta kh="ថ្ងៃបញ្ជាទិញ" en="Order Date" value={formatDateTime(order.paid_at)} />
          <Meta kh="អាសយដ្ឋាន" en="Address" value={customerAddress || "—"} />
        </div>

        {/* 3 + 4. Items table with sub-details / summary footer */}
        <table className="mt-4 w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <Th className="text-left">
                បរិយាយទំនិញ
                <span className="block text-[10px] font-normal">Product Name</span>
              </Th>
              <Th className="w-14">
                បរិមាណ
                <span className="block text-[10px] font-normal">QTY</span>
              </Th>
              <Th className="w-16">
                ឯកតា
                <span className="block text-[10px] font-normal">UOM</span>
              </Th>
              <Th className="w-20">
                តម្លៃរាយ
                <span className="block text-[10px] font-normal">Unit Price</span>
              </Th>
              <Th className="w-20">
                សរុប
                <span className="block text-[10px] font-normal">Total</span>
              </Th>
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

            {summary.map((row, i) => (
              <tr key={row.en}>
                {i === 0 && (
                  <td
                    rowSpan={summary.length}
                    className="border border-black align-top p-2 text-[11px]"
                  >
                    <dl className="flex flex-col gap-1">
                      {subDetails.map((d) => (
                        <div key={d.en} className="flex flex-wrap gap-x-1.5">
                          <dt className="font-bold">
                            {d.kh} / {d.en}:
                          </dt>
                          <dd>{d.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </td>
                )}
                <td
                  colSpan={3}
                  className={`border border-black px-2 py-1 whitespace-nowrap ${
                    row.kind === "total" ? "text-sm font-bold" : ""
                  } ${row.kind === "subtotal" ? "bg-green-50 font-semibold text-green-700" : ""}`}
                >
                  {row.kh} <span className="text-[10px] font-normal">/ {row.en}</span>
                </td>
                <td
                  className={`border border-black px-2 py-1 text-right tabular-nums ${
                    row.kind === "total"
                      ? "text-base font-bold text-green-600"
                      : row.kind === "subtotal"
                        ? "bg-green-50 font-semibold text-green-700"
                        : ""
                  }`}
                >
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 5. Remarks */}
        <div className="mt-4 text-[11px] leading-relaxed">
          <p className="font-bold">Remarks: កំណត់ចំណាំ៖</p>
          {brand.remarks.map((r, i) => (
            <p key={i}>- {r}</p>
          ))}
        </div>

        {/* 6. KHQR + footer */}
        {brand.khqrUrl && (
          <div className="mt-6 flex flex-col items-center">
            <div className="relative rounded-lg border border-black/70 p-3">
              <span className="absolute -top-2 left-3 bg-red-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
                KHQR
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={brand.khqrUrl} alt="KHQR" className="h-44 w-44 object-contain" />
            </div>
            <p className="mt-2 text-sm font-bold tracking-wide">{brand.khqrLabel}</p>
          </div>
        )}

        <div className="mt-8 space-y-1 text-center text-[11px]">
          {brand.closing.map((line, i) => (
            <p key={i} className={i === 0 ? "font-bold" : ""}>
              {line}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function Meta({ kh, en, value }: { kh: string; en: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <span className="shrink-0">
        {kh} / {en}:
      </span>
      <span className="font-bold">{value}</span>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`border border-black bg-zinc-100 px-2 py-1.5 align-bottom text-[11px] font-bold ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`border border-black px-2 py-1.5 align-top ${className}`}>{children}</td>;
}
