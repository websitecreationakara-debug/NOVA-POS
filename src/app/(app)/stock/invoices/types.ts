// What the invoice form needs about products, loaded when the form is opened (see loadInvoiceFormDataAction).
export type ProductOption = { id: string; name: string; sku: string | null; unit: string; costPrice: number | null };

// A product of the Daily Ledger: what the Description dropdown lists.
export type LedgerOption = {
  name: string;
  unit: string;
  sku: string;
  // The Stock product it is linked to (any business), with what the line fills in from it.
  stockProductId: string | null;
  stock: { sku: string | null; unit: string; costPrice: number | null } | null;
};

export type InvoiceFormData = { brandId: string; products: ProductOption[]; ledgerProducts: LedgerOption[] };
