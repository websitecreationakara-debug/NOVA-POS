import { notFound } from "next/navigation";
import { getInvoice } from "@/lib/supabase/queries";
import { invoiceBrandConfig, brandLogoPath, brandLogoHeightClass } from "@/lib/invoiceBrands";
import PrintButton from "@/components/PrintButton";
import OrderStatusControl from "@/components/OrderStatusControl";
import { InvoiceDoc, hanuman } from "@/components/InvoiceDoc";

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const invoice = await getInvoice(orderId);

  if (!invoice) notFound();

  const brand = invoiceBrandConfig(invoice.brandSlug);
  // Prefer the curated file in /public/logos over whatever brands.logo_url
  // happens to hold -- the invoice logos are managed there.
  const logo = brandLogoPath(invoice.brandSlug) ?? invoice.brandLogoUrl;
  const logoHeightClass = brandLogoHeightClass(invoice.brandSlug);

  return (
    <div
      className={`${hanuman.className} mx-auto w-fit max-w-full p-6 print:w-full print:max-w-none print:p-0`}
    >
      <div className="mb-4 flex items-center justify-end gap-3 print:hidden">
        <OrderStatusControl orderId={invoice.order.id} status={invoice.order.fulfillment_status} />
        <PrintButton filename={`Invoice-${invoice.invoiceNumber.replace(/^#/, "")}`} />
      </div>

      {/* Two identical copies -- a "duplicate voucher" (customer + shop), each
          its own page. The print job is 2 A4 pages, so Chrome's
          "Pages per sheet: 2" tiles both onto one sheet. */}
      <div className="space-y-8 print:space-y-0">
        {[0, 1].map((n) => (
          <div
            key={n}
            data-copy={n === 1 ? "2" : "1"}
            className={`invoice-sheet w-[210mm] max-w-full overflow-hidden rounded-xl border border-zinc-200 bg-white text-black shadow-sm print:w-full print:max-w-none print:overflow-visible print:rounded-none print:border-0 print:shadow-none ${
              n === 1 ? "break-before-page" : ""
            }`}
          >
            <InvoiceDoc invoice={invoice} brand={brand} logo={logo} logoHeightClass={logoHeightClass} />
          </div>
        ))}
      </div>
    </div>
  );
}
