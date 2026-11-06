import { supabaseAdmin } from "@/lib/supabase/server";
import { getBrands } from "@/lib/supabase/queries";
import { ppToday } from "@/lib/phnomPenhTime";
import SupplierInvoicesClient, { type InvoiceRow } from "./SupplierInvoicesClient";

// Stock > Supplier Invoices: bills from suppliers for products bought in, for the business picked with
// ?brand=. Saving one adds its quantities to Stock and sets the products' costs (see ./actions.ts).
// Search, filters and paging live in the URL: ?q=&status=paid|unpaid&from=&to=&page=&limit=.
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZES = [10, 25, 50, 100];

export default async function SupplierInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; q?: string; status?: string; from?: string; to?: string; page?: string; limit?: string }>;
}) {
  const sp = await searchParams;
  const brandParam = sp.brand;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const status = sp.status === "paid" || sp.status === "unpaid" ? sp.status : "";
  const fromDay = sp.from && DAY_RE.test(sp.from) ? sp.from : "";
  const toDay = sp.to && DAY_RE.test(sp.to) ? sp.to : "";
  const limit = PAGE_SIZES.includes(Number(sp.limit)) ? Number(sp.limit) : 25;
  const requestedPage = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const brands = await getBrands();
  if (brands.length === 0) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Supplier Invoices</h1>
        <p className="mt-2 text-zinc-500">No brands configured yet.</p>
      </main>
    );
  }
  const currentBrand = brands.find((b) => b.id === brandParam) ?? brands[0];

  // The search matches the supplier, the invoice number, and the SKU or name of a product on the invoice.
  // `,()%*` are stripped: they'd break the filter text below.
  const term = q.replace(/[,()%*\\]/g, " ").trim();
  let filter = "";
  if (term) {
    const [bySku, byProduct] = await Promise.all([
      supabaseAdmin
        .from("supplier_invoice_items")
        .select("invoice_id")
        .or(`sku.ilike.%${term}%,description.ilike.%${term}%`)
        .limit(1000),
      supabaseAdmin
        .from("supplier_invoice_items")
        .select("invoice_id, products!inner(name)")
        .ilike("products.name", `%${term}%`)
        .limit(1000),
    ]);
    const ids = [...new Set([...(bySku.data ?? []), ...(byProduct.data ?? [])].map((r) => r.invoice_id))];
    filter = `supplier_name.ilike.%${term}%,invoice_number.ilike.%${term}%${ids.length ? `,id.in.(${ids.join(",")})` : ""}`;
  }

  // Newest invoices first. Before migration 0096 the tables don't exist: show an empty list, and saving
  // says to run the migration.
  const load = (page: number) => {
    let query = supabaseAdmin
      .from("supplier_invoices")
      .select("*, supplier_invoice_items(id, product_id, quantity, unit_cost, sku, packing, unit, description, products(name))", {
        count: "exact",
      })
      .eq("brand_id", currentBrand.id);
    if (filter) query = query.or(filter);
    if (status) query = query.eq("paid", status === "paid");
    if (fromDay) query = query.gte("invoice_date", fromDay);
    if (toDay) query = query.lte("invoice_date", toDay);
    return query
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
  };
  const first = await load(requestedPage);
  const matching = first.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(matching / limit));
  const page = Math.min(requestedPage, pageCount);
  // A page past the end (e.g. a filter narrowed the list): show the last one instead of nothing.
  const rows = page === requestedPage ? first.data : (await load(page)).data;
  const invoices: InvoiceRow[] = (rows ?? []).map((r) => ({
    id: r.id,
    supplierName: r.supplier_name,
    invoiceNumber: r.invoice_number,
    invoiceDate: r.invoice_date,
    total: Number(r.total),
    paid: r.paid,
    note: r.note,
    exchangeRate: r.exchange_rate === null ? null : Number(r.exchange_rate),
    items: (r.supplier_invoice_items ?? []).map((i) => ({
      id: i.id,
      sku: i.sku,
      packing: i.packing,
      unit: i.unit,
      productName: (i.products as { name: string } | null)?.name ?? i.description ?? "—",
      productId: i.product_id,
      inStock: i.product_id !== null,
      quantity: Number(i.quantity),
      unitCost: Number(i.unit_cost),
    })),
  }));

  return (
    <SupplierInvoicesClient
      brands={brands}
      currentBrandId={currentBrand.id}
      today={ppToday()}
      invoices={invoices}
      list={{ q, status, from: fromDay, to: toDay, page, pageCount, limit, matching, pageSizes: PAGE_SIZES }}
    />
  );
}
