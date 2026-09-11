import { getInvoice, type InvoiceData } from "@/lib/supabase/queries";
import { invoiceBrandConfig, brandLogoPath, brandLogoHeightClass } from "@/lib/invoiceBrands";
import PrintButton from "@/components/PrintButton";
import { InvoiceDoc, hanuman } from "@/components/InvoiceDoc";

// Bulk "Save as PDF" for the Orders list's multi-select bar: one combined
// print job with each selected order's invoice (both duplicate-voucher
// copies, same as the single invoice page) back to back, so staff can print
// or save a batch instead of opening each order one at a time.
export default async function BulkInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids: idsParam } = await searchParams;
  const ids = (idsParam ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const invoices = (await Promise.all(ids.map((id) => getInvoice(id)))).filter(
    (invoice): invoice is InvoiceData => invoice !== null
  );

  return (
    <div
      className={`${hanuman.className} mx-auto w-fit max-w-full p-6 print:w-full print:max-w-none print:p-0`}
    >
      <div className="mb-4 flex items-center justify-end gap-3 print:hidden">
        <PrintButton filename={`Invoices-${invoices.length}-orders`} />
      </div>

      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground print:hidden">No orders selected.</p>
      ) : (
        <div className="space-y-8 print:space-y-0">
          {invoices.map((invoice, orderIndex) => {
            const brand = invoiceBrandConfig(invoice.brandSlug);
            const logo = brandLogoPath(invoice.brandSlug) ?? invoice.brandLogoUrl;
            const logoHeightClass = brandLogoHeightClass(invoice.brandSlug);

            return [0, 1].map((copyIndex) => (
              <div
                key={`${invoice.order.id}-${copyIndex}`}
                className={`invoice-sheet w-[210mm] max-w-full overflow-hidden rounded-xl border border-zinc-200 bg-white text-black shadow-sm print:w-full print:max-w-none print:overflow-visible print:rounded-none print:border-0 print:shadow-none ${
                  orderIndex > 0 || copyIndex > 0 ? "break-before-page" : ""
                }`}
              >
                <InvoiceDoc
                  invoice={invoice}
                  brand={brand}
                  logo={logo}
                  logoHeightClass={logoHeightClass}
                />
              </div>
            ));
          })}
        </div>
      )}
    </div>
  );
}
