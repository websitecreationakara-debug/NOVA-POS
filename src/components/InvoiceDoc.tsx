import { Hanuman } from "next/font/google";
import type { InvoiceData } from "@/lib/supabase/queries";
import type { InvoiceBrandConfig } from "@/lib/invoiceBrands";
import { SITE_LABEL } from "@/lib/site-sync";
import type { ProductSiteLink } from "@/types/database";

// Khmer + Latin webfont for the printed document so the bilingual labels
// render consistently on screen and in the PDF. Defined once here (rather
// than per page) so the single-order and bulk invoice pages share the same
// font instance instead of each loading their own.
export const hanuman = Hanuman({
  subsets: ["khmer", "latin"],
  weight: ["400", "700"],
  display: "swap",
});

export function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

export function formatDateTime(iso: string | null) {
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

export function InvoiceDoc({
  invoice,
  brand,
  logo,
  logoHeightClass,
}: {
  invoice: InvoiceData;
  brand: InvoiceBrandConfig;
  logo: string | null;
  logoHeightClass: string;
}) {
  const { order, invoiceNumber, brandName, customerAddress, items } = invoice;

  // The layout below is tight enough (see the padding/margins throughout)
  // that a normal order needs no shrinking at all -- text prints at full,
  // readable size. `zoom` only kicks in for longer item lists, and even then
  // MIN_PAGE_FIT stops it going below a size that's still comfortable to
  // read; past that point the copy is left at that floor and allowed to flow
  // onto a second page instead (the remarks+KHQR block stays atomic -- see
  // .invoice-keep -- so it moves as a whole rather than getting cut
  // mid-block). Constants measured against an actual rendered/printed
  // 6-item invoice (270mm at zoom 1) and a 12-item one (312mm) -- re-verify
  // against a real print if the layout above changes again.
  const MIN_PAGE_FIT = 0.8;
  const rawFit = 278 / (230 + 7 * items.length);
  const pageFit = Math.max(MIN_PAGE_FIT, Math.min(1, rawFit));

  const paymentLabel = order.payment_method
    ? (PAYMENT_LABELS[order.payment_method] ?? order.payment_method)
    : "—";
  const channelLabel =
    order.channel === "online" && order.site
      ? `Online — ${SITE_LABEL[order.site as ProductSiteLink["site"]] ?? order.site}`
      : "In-Store (POS)";
  const subDetails: { kh: string; en: string; value: string }[] = [
    { kh: "ពិពណ៌នា", en: "Description", value: order.note?.trim() || "—" },
    // This used to show paid_at (when the order was placed/charged) under a
    // label that already said "delivery time," which is why it never
    // matched the real delivery field.
    { kh: "ម៉ោងដឹក", en: "Delivery Time", value: formatDateTime(order.delivery_at) },
    { kh: "កម្មង់តាម", en: "Order Channel", value: channelLabel },
    { kh: "បង់ប្រាក់តាម", en: "Payment Method", value: paymentLabel },
  ];

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
    // min-h keeps it looking like a full page without ever spilling past one
    // (A4 usable height with the 6mm @page margin is ~285mm). `zoom` shrinks
    // fuller invoices to keep the copy on one page -- it (unlike `transform`)
    // reduces the layout footprint, so the print job stays at 2 pages.
    <div style={{ zoom: pageFit }} className="flex min-h-[262mm] w-full flex-col p-[12mm]">
      {/* 1. Header -- logo left, contact line bottom-aligned to its right */}
      <header className="flex items-end justify-between gap-4">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt={brandName}
            className={`${logoHeightClass} w-auto max-w-[55%] object-contain`}
          />
        ) : (
          <h1 className="text-[32px] font-bold tracking-wide">{brandName}</h1>
        )}
        {brand.contactLine && (
          <p className="max-w-[42%] text-right text-[14px] leading-snug">{brand.contactLine}</p>
        )}
      </header>

      <div className="mt-2 border-2 border-black py-1.5 text-center text-lg font-bold tracking-wide">
        INVOICE វិក្កយបត្រ
      </div>

      {/* 2. Customer & metadata grid */}
      <div className="mt-3 grid grid-cols-2 gap-x-12 gap-y-1.5 text-[15px]">
        <Meta kh="ឈ្មោះ" value={order.customer_name || "—"} />
        <Meta kh="លេខវិក្កយបត្រ" value={invoiceNumber} />
        <Meta kh="លេខទូរស័ព្ទ" value={order.customer_phone || "—"} />
        <Meta kh="ថ្ងៃបញ្ជាទិញ" value={formatDateTime(order.paid_at)} />
        <Meta kh="អាសយដ្ឋាន" value={customerAddress || "—"} />
      </div>

      {/* 3 + 4. Items table with sub-details / summary footer */}
      <table className="mt-3 w-full border-collapse text-[14px]">
        <thead>
          <tr>
            <Th className="text-left">
              បរិយាយទំនិញ
              <span className="block text-[12px] font-normal">Product Name</span>
            </Th>
            <Th className="w-16">
              បរិមាណ
              <span className="block text-[12px] font-normal">QTY</span>
            </Th>
            <Th className="w-20">
              ឯកតា
              <span className="block text-[12px] font-normal">UOM</span>
            </Th>
            <Th className="w-24">
              តម្លៃរាយ
              <span className="block text-[12px] font-normal">Unit Price</span>
            </Th>
            <Th className="w-24">
              សរុប
              <span className="block text-[12px] font-normal">Total</span>
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
        </tbody>
        {/* Keep the whole summary block (sub-details rowspan + totals) on one
            page -- a break through the rowspan cell looks broken. */}
        <tbody className="invoice-keep">
          {summary.map((row, i) => (
            <tr key={row.en}>
              {i === 0 && (
                <td
                  rowSpan={summary.length}
                  className="border border-black align-top p-2 text-[14px]"
                >
                  <dl className="flex flex-col gap-1">
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
                className={`border border-black px-3.5 py-1 whitespace-nowrap ${
                  row.kind === "total"
                    ? "bg-green-50 text-lg font-bold text-green-700"
                    : row.kind === "subtotal"
                      ? "font-semibold"
                      : ""
                }`}
              >
                {row.kh}
              </td>
              <td
                className={`border border-black px-3.5 py-1 text-right tabular-nums ${
                  row.kind === "total"
                    ? "bg-green-50 text-xl font-bold text-green-700"
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

      {/* 5-7. Remarks, KHQR and the closing lines -- one block so a page break
          never splits them and the closing text always sits directly below
          the KHQR. flex-1 lets it fill the rest of a short page. */}
      <div className="invoice-keep flex flex-1 flex-col">
        {/* 5. Remarks */}
        <div className="mt-2 text-[14px] leading-snug">
          <p className="font-bold">Remarks: កំណត់ចំណាំ៖</p>
          {brand.remarks.map((r, i) => (
            <p key={i}>- {r}</p>
          ))}
        </div>

        {/* 6. KHQR -- centered between the Remarks and the closing lines */}
        {brand.khqrUrl && (
          <div className="flex flex-1 flex-col items-center justify-center py-2">
            <span className="rounded bg-red-600 px-3 py-1 text-[11px] font-bold tracking-wide text-white">
              KHQR
            </span>
            <div className="relative mt-1.5 p-2">
              <span className="absolute top-0 left-0 h-5 w-5 rounded-tl-md border-t-2 border-l-2 border-zinc-400" />
              <span className="absolute top-0 right-0 h-5 w-5 rounded-tr-md border-t-2 border-r-2 border-zinc-400" />
              <span className="absolute bottom-0 left-0 h-5 w-5 rounded-bl-md border-b-2 border-l-2 border-zinc-400" />
              <span className="absolute right-0 bottom-0 h-5 w-5 rounded-br-md border-r-2 border-b-2 border-zinc-400" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={brand.khqrUrl} alt="KHQR" className="h-[144px] w-[144px] object-contain" />
            </div>
            <p className="mt-2 text-xl font-bold tracking-wide">{brand.khqrLabel}</p>
          </div>
        )}

        {/* 7. Closing lines -- directly below the KHQR */}
        <div
          className={`space-y-1 text-center text-[14px] ${brand.khqrUrl ? "mt-2" : "mt-auto pt-10"}`}
        >
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
      className={`border border-black bg-zinc-100 px-3.5 py-1 align-bottom text-[13px] font-bold ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`border border-black px-3.5 py-1 align-top ${className}`}>{children}</td>;
}
