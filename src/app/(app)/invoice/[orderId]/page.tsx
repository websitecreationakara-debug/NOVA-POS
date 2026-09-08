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

  const { order, invoiceNumber, brandName, brandSlug, brandLogoUrl, customerAddress, items } =
    invoice;
  const brand = invoiceBrandConfig(brandSlug);
  // Prefer the curated file in /public/logos over whatever brands.logo_url
  // happens to hold -- the invoice logos are managed there.
  const logo = brandLogoPath(brandSlug) ?? brandLogoUrl;

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
    kh: "ទំនិញសរុប",
    en: "Subtotal",
    value: formatMoney(order.subtotal),
    kind: "subtotal",
  });
  summary.push({
    kh: "បញ្ចុះតម្លៃ",
    en: "Discount",
    value: order.discount > 0 ? `-${formatMoney(order.discount)}` : formatMoney(0),
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
    <div className={`${hanuman.className} mx-auto w-fit max-w-full p-6 print:p-0`}>
      <div className="mb-4 flex items-center justify-end gap-3 print:hidden">
        <OrderStatusControl orderId={order.id} status={order.fulfillment_status} />
        <PrintButton />
      </div>

      {/* Printed document: one invoice fills an A4 page; always white/black
          regardless of app theme. */}
      <div className="invoice-sheet flex w-[210mm] max-w-full min-h-[297mm] flex-col rounded-xl border border-zinc-200 bg-white p-[16mm] text-black shadow-sm print:w-auto print:min-h-0 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        {/* 1. Header -- logo left, contact line bottom-aligned to its right so
            it sits just above the INVOICE bar */}
        <header className="flex items-end justify-between gap-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt={brandName}
              className="h-16 w-auto max-w-[55%] object-contain"
            />
          ) : (
            <h1 className="text-[32px] font-bold tracking-wide">{brandName}</h1>
          )}
          {brand.contactLine && (
            <p className="max-w-[42%] text-right text-[13px] leading-snug">{brand.contactLine}</p>
          )}
        </header>

        <div className="mt-2 border-2 border-black py-2.5 text-center text-lg font-bold tracking-wide">
          INVOICE វិក្កយបត្រ
        </div>

        {/* 2. Customer & metadata grid */}
        <div className="mt-6 grid grid-cols-2 gap-x-12 gap-y-2.5 text-[14px]">
          <Meta kh="ឈ្មោះ" value={order.customer_name || "—"} />
          <Meta kh="លេខវិក្កយបត្រ" value={invoiceNumber} />
          <Meta kh="លេខទូរស័ព្ទ" value={order.customer_phone || "—"} />
          <Meta kh="ថ្ងៃបញ្ជាទិញ" value={formatDateTime(order.paid_at)} />
          <Meta kh="អាសយដ្ឋាន" value={customerAddress || "—"} />
        </div>

        {/* 3 + 4. Items table with sub-details / summary footer */}
        <table className="mt-6 w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <Th className="text-left">
                បរិយាយទំនិញ
                <span className="block text-[11px] font-normal">Product Name</span>
              </Th>
              <Th className="w-16">
                បរិមាណ
                <span className="block text-[11px] font-normal">QTY</span>
              </Th>
              <Th className="w-20">
                ឯកតា
                <span className="block text-[11px] font-normal">UOM</span>
              </Th>
              <Th className="w-24">
                តម្លៃរាយ
                <span className="block text-[11px] font-normal">Unit Price</span>
              </Th>
              <Th className="w-24">
                សរុប
                <span className="block text-[11px] font-normal">Total</span>
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
                    className="border border-black align-top p-3 text-[13px]"
                  >
                    <dl className="flex flex-col gap-1.5">
                      {subDetails.map((d) => (
                        <div key={d.en} className="flex flex-wrap gap-x-1.5">
                          <dt className="font-bold">{d.kh}:</dt>
                          <dd>{d.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </td>
                )}
                <td
                  colSpan={3}
                  className={`border border-black px-3 py-2 whitespace-nowrap ${
                    row.kind === "total"
                      ? "bg-green-50 text-base font-bold text-green-700"
                      : row.kind === "subtotal"
                        ? "font-semibold"
                        : ""
                  }`}
                >
                  {row.kh}
                </td>
                <td
                  className={`border border-black px-3 py-2 text-right tabular-nums ${
                    row.kind === "total"
                      ? "bg-green-50 text-lg font-bold text-green-700"
                      : row.kind === "subtotal"
                        ? "font-semibold"
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
        <div className="mt-6 text-[13px] leading-relaxed">
          <p className="font-bold">Remarks: កំណត់ចំណាំ៖</p>
          {brand.remarks.map((r, i) => (
            <p key={i}>- {r}</p>
          ))}
        </div>

        {/* 6. KHQR -- centered in the space between the Remarks and the
            closing lines, so it fills the page without a big top gap */}
        {brand.khqrUrl && (
          <div className="flex flex-1 flex-col items-center justify-center py-8">
            <div className="relative rounded-2xl border border-zinc-200 bg-white px-7 pt-6 pb-5 shadow-sm">
              {/* "KHQR" tab, centered on the top edge */}
              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded bg-red-600 px-2.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
                KHQR
              </span>
              {/* QR with the four rounded corner brackets */}
              <div className="relative p-3.5">
                <span className="absolute top-0 left-0 h-5 w-5 rounded-tl-lg border-t-2 border-l-2 border-zinc-400" />
                <span className="absolute top-0 right-0 h-5 w-5 rounded-tr-lg border-t-2 border-r-2 border-zinc-400" />
                <span className="absolute bottom-0 left-0 h-5 w-5 rounded-bl-lg border-b-2 border-l-2 border-zinc-400" />
                <span className="absolute right-0 bottom-0 h-5 w-5 rounded-br-lg border-r-2 border-b-2 border-zinc-400" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={brand.khqrUrl} alt="KHQR" className="h-52 w-52 object-contain" />
              </div>
            </div>
            <p className="mt-3 text-lg font-bold tracking-wide">{brand.khqrLabel}</p>
          </div>
        )}

        {/* 7. Closing lines -- bottom of the page */}
        <div className={`space-y-1.5 text-center text-[13px] ${brand.khqrUrl ? "" : "mt-auto pt-10"}`}>
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

function Meta({ kh, value }: { kh: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <span className="shrink-0">{kh}:</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`border border-black bg-zinc-100 px-3 py-2 align-bottom text-[12px] font-bold ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`border border-black px-3 py-2 align-top ${className}`}>{children}</td>;
}
