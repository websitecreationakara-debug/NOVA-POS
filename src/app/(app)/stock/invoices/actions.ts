"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { requireStockAccess } from "@/lib/stockAccess";
import { websiteStock } from "@/lib/supabase/queries";
import { adjustStockAction, setProductCostAction } from "../actions";
import type { InvoiceFormData, LedgerOption, ProductOption } from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n: number) => Math.round(n * 100) / 100;

const missingMigration = (message: string) =>
  /previous_cost|cost_recorded/.test(message)
    ? "Run migration 0099 first, then try again."
    : /description|product_or_description|"product_id"/.test(message)
    ? "Run migration 0098 first, then try again."
    : /exchange_rate|packing|\bsku\b|\bunit\b/.test(message)
    ? "Run migration 0097 first, then try again."
    : /supplier_invoice/.test(message)
      ? "Run migration 0096 first, then try again."
      : message;

// Puts an invoice's lines into the Daily Ledger (the ledger lists only its own products, so Stock alone
// never shows them there): each line's product is found there by name -- or added -- and its quantity
// goes into the P (purchase) cell of the invoice's day. sign -1 takes the quantities back out and never
// adds products. Everything is read first and written last, so a failure leaves nothing half-done.
async function syncLedger(
  brandId: string,
  invoiceDate: string,
  lines: { productId: string | null; description: string; unit: string; quantity: number; sku?: string }[],
  sign: 1 | -1
) {
  const month = invoiceDate.slice(0, 7);
  const field = `p:${invoiceDate.slice(8, 10)}`;

  const ids = [...new Set(lines.map((l) => l.productId).filter((id): id is string => !!id))];
  const prods = new Map<string, { name: string; price: number; unit: string }>();
  if (ids.length) {
    const { data, error } = await supabaseAdmin.from("products").select("id, name, price, unit").in("id", ids);
    if (error) throw new Error(error.message);
    for (const p of data ?? []) prods.set(p.id, { name: p.name, price: Number(p.price), unit: p.unit });
  }
  // The business's ledger products: by name, and by the Stock product each is linked to (migration 0100;
  // without it nothing is linked).
  const existing = new Map<string, { id: string; name: string; first_month: string | null }>();
  const linkedTo = new Map<string, { id: string; name: string; first_month: string | null }>();
  const byId = new Map<string, { id: string; name: string; first_month: string | null }>();
  let linkColumn = true;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("daily_ledger_products")
      .select(linkColumn ? "id, name, first_month, stock_product_id" : "id, name, first_month")
      .eq("brand_id", brandId)
      .order("id")
      .range(from, from + 999);
    if (error && linkColumn && /stock_product_id/.test(error.message)) {
      linkColumn = false;
      from -= 1000;
      continue;
    }
    if (error) throw new Error(error.message);
    const part = (data ?? []) as unknown as { id: string; name: string; first_month: string | null; stock_product_id?: string | null }[];
    for (const r of part) {
      const row = { id: r.id, name: r.name, first_month: r.first_month };
      existing.set(r.name.trim().toLowerCase(), row);
      byId.set(r.id, row);
      if (r.stock_product_id && !linkedTo.has(r.stock_product_id)) linkedTo.set(r.stock_product_id, row);
    }
    if (part.length < 1000) break;
  }

  // One entry per ledger product, however many lines (or invoices' worth) it has. A line for a Stock product
  // that a ledger product is linked to goes to that ledger product, whatever the two are called.
  const wanted = new Map<string, { name: string; unit: string; price: number; quantity: number; sku: string; ledgerId?: string }>();
  for (const l of lines) {
    const p = l.productId ? prods.get(l.productId) : undefined;
    const linked = l.productId ? linkedTo.get(l.productId) : undefined;
    const name = (linked?.name ?? p?.name ?? l.description).trim();
    if (!name) continue;
    const key = linked ? `ledger:${linked.id}` : name.toLowerCase();
    const w = wanted.get(key) ?? { name, unit: l.unit.trim() || p?.unit || "pcs", price: p?.price ?? 0, quantity: 0, sku: "", ledgerId: linked?.id };
    if (!w.sku) w.sku = (l.sku ?? "").trim();
    w.quantity += l.quantity;
    wanted.set(key, w);
  }
  if (wanted.size === 0) return;

  const ledgerIds = new Map<string, string>();
  const toInsert: { brand_id: string; name: string; unit: string; unit_price: number; category: null; first_month: string }[] = [];
  const toEarlier: string[] = [];
  for (const [key, w] of wanted) {
    const hit = w.ledgerId ? byId.get(w.ledgerId) : existing.get(key);
    if (hit) {
      ledgerIds.set(key, hit.id);
      // A product is listed from its first month on: an invoice dated before that moves it back.
      if (sign === 1 && hit.first_month && hit.first_month > month) toEarlier.push(hit.id);
    } else if (sign === 1) {
      toInsert.push({ brand_id: brandId, name: w.name, unit: w.unit, unit_price: w.price, category: null, first_month: month });
    }
  }

  const { data: current, error: currentError } = ledgerIds.size
    ? await supabaseAdmin
        .from("daily_ledger_product_entries")
        .select("product_id, value")
        .in("product_id", [...ledgerIds.values()])
        .eq("month", month)
        .eq("field", field)
    : { data: [], error: null };
  if (currentError) throw new Error(currentError.message);
  const typed = new Map((current ?? []).map((e) => [e.product_id, Number(e.value) || 0]));

  if (toInsert.length) {
    const { data, error } = await supabaseAdmin.from("daily_ledger_products").insert(toInsert).select("id, name");
    if (error) throw new Error(error.message);
    for (const r of data ?? []) ledgerIds.set(r.name.trim().toLowerCase(), r.id);
  }
  if (toEarlier.length) {
    const { error } = await supabaseAdmin.from("daily_ledger_products").update({ first_month: month }).in("id", toEarlier);
    if (error) throw new Error(error.message);
  }

  const now = new Date().toISOString();
  const upserts: { product_id: string; month: string; field: string; value: string; updated_at: string }[] = [];
  const clears: string[] = [];
  for (const [key, w] of wanted) {
    const id = ledgerIds.get(key);
    if (!id) continue;
    const next = round2(Math.max(0, (typed.get(id) ?? 0) + sign * w.quantity));
    if (next === 0) clears.push(id);
    else upserts.push({ product_id: id, month, field, value: String(next), updated_at: now });
  }
  if (upserts.length) {
    const { error } = await supabaseAdmin
      .from("daily_ledger_product_entries")
      .upsert(upserts, { onConflict: "product_id,month,field" });
    if (error) throw new Error(error.message);
  }
  if (clears.length) {
    const { error } = await supabaseAdmin
      .from("daily_ledger_product_entries")
      .delete()
      .in("product_id", clears)
      .eq("month", month)
      .eq("field", field);
    if (error) throw new Error(error.message);
  }

  // The SKU on the line is kept in the ledger's SKU cell (for the invoice's month), so the next invoice
  // fills it in when the product is picked. One already typed in the ledger is never replaced.
  if (sign === 1) {
    const withSku = [...wanted].filter(([key, w]) => w.sku && ledgerIds.get(key));
    if (withSku.length) {
      const skuIds = withSku.map(([key]) => ledgerIds.get(key)!);
      const { data: have, error: haveError } = await supabaseAdmin
        .from("daily_ledger_product_entries")
        .select("product_id")
        .in("product_id", skuIds)
        .eq("month", month)
        .eq("field", "sku");
      if (haveError) throw new Error(haveError.message);
      const hasSku = new Set((have ?? []).map((h) => h.product_id));
      const rows = withSku
        .filter(([key]) => !hasSku.has(ledgerIds.get(key)!))
        .map(([key, w]) => ({ product_id: ledgerIds.get(key)!, month, field: "sku", value: w.sku.slice(0, 40), updated_at: now }));
      if (rows.length) {
        const { error } = await supabaseAdmin.from("daily_ledger_product_entries").upsert(rows, { onConflict: "product_id,month,field" });
        if (error) throw new Error(error.message);
      }
    }
  }
}

type InvoiceLine = {
  productId: string | null;
  description: string;
  sku: string;
  packing: string;
  unit: string;
  quantity: number;
  unitCost: number;
};
type InvoiceInput = {
  brandId: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  paid: boolean;
  note: string;
  // Riel per $1 as printed on the invoice; null = not on it.
  exchangeRate: number | null;
  // A line with no productId is not a product of the business: only its description is recorded, Stock
  // and costs are left alone.
  lines: InvoiceLine[];
};

// Checks what was typed and tidies it: the same rules for a new invoice and an edited one.
function validateInvoice(input: InvoiceInput) {
  const supplierName = input.supplierName.trim();
  const invoiceNumber = input.invoiceNumber.trim();
  if (!supplierName) throw new Error("Type the supplier's name");
  if (supplierName.length > 80 || invoiceNumber.length > 40) throw new Error("The supplier or invoice number is too long");
  if (!DATE_RE.test(input.invoiceDate)) throw new Error("Pick the invoice date");
  if (input.exchangeRate !== null && (!Number.isFinite(input.exchangeRate) || input.exchangeRate <= 0)) {
    throw new Error("Exchange rate must be more than zero");
  }
  if (input.lines.length === 0) throw new Error("Add at least one product");
  for (const l of input.lines) {
    if (!l.productId && !l.description.trim()) throw new Error("Type a description on every line");
    if (!Number.isFinite(l.quantity) || l.quantity <= 0) throw new Error("Quantity must be more than zero");
    if (!Number.isFinite(l.unitCost) || l.unitCost < 0) throw new Error("Unit cost cannot be negative");
  }
  const lines = input.lines.map((l) => ({ ...l, quantity: round2(l.quantity), unitCost: round2(l.unitCost) }));
  const total = round2(lines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0));
  return { supplierName, invoiceNumber, lines, total };
}

const invoiceReason = (invoiceNumber: string | null, supplierName: string) =>
  `Supplier invoice${invoiceNumber ? ` ${invoiceNumber}` : ""} - ${supplierName}`;

// Records an invoice's lines and applies them: each line's quantity is added to Stock and the product's cost
// price becomes the line's unit cost (the cost before is kept on the line, so it can be put back), and the
// lines go into the Daily Ledger. If a line can't be applied, what was already applied is taken back out and
// the lines are not kept.
async function applyLines(
  invoiceId: string,
  brandId: string,
  invoiceDate: string,
  reason: string,
  lines: InvoiceLine[]
): Promise<void> {
  const applied: { productId: string; quantity: number }[] = [];
  const costed = new Set<string>();
  const previousCost = new Map<string, number | null>();
  try {
    const productIds = [...new Set(lines.map((l) => l.productId).filter((id): id is string => !!id))];
    if (productIds.length) {
      const { data: before, error: beforeError } = await supabaseAdmin.from("products").select("id, cost_price").in("id", productIds);
      if (beforeError) throw new Error(beforeError.message);
      for (const p of before ?? []) previousCost.set(p.id, p.cost_price === null ? null : Number(p.cost_price));
    }
    const { error: itemsError } = await supabaseAdmin.from("supplier_invoice_items").insert(
      lines.map((l) => ({
        invoice_id: invoiceId,
        product_id: l.productId,
        description: l.productId ? null : l.description.trim(),
        quantity: l.quantity,
        unit_cost: l.unitCost,
        sku: l.sku.trim() || null,
        packing: l.packing.trim() || null,
        unit: l.unit.trim() || null,
        previous_cost: l.productId ? (previousCost.get(l.productId) ?? null) : null,
        cost_recorded: !!l.productId,
      }))
    );
    if (itemsError) throw new Error(missingMigration(itemsError.message));
    for (const l of lines) {
      if (!l.productId) continue;
      await adjustStockAction({ productId: l.productId, delta: l.quantity, reason });
      applied.push({ productId: l.productId, quantity: l.quantity });
      await setProductCostAction({ productId: l.productId, costPrice: l.unitCost });
      costed.add(l.productId);
    }
    await syncLedger(brandId, invoiceDate, lines, 1);
  } catch (e) {
    for (const a of applied) {
      await adjustStockAction({ productId: a.productId, delta: -a.quantity, reason: `Undo: ${reason}` }).catch(() => {});
    }
    for (const id of costed) {
      await setProductCostAction({ productId: id, costPrice: previousCost.get(id) ?? null }).catch(() => {});
    }
    await supabaseAdmin.from("supplier_invoice_items").delete().eq("invoice_id", invoiceId);
    throw e;
  }
}

type StoredInvoice = {
  id: string;
  brand_id: string;
  invoice_date: string;
  supplier_name: string;
  invoice_number: string | null;
  total: number;
  paid: boolean;
  note: string | null;
  exchange_rate: number | null;
  supplier_invoice_items: {
    product_id: string | null;
    description: string | null;
    sku: string | null;
    packing: string | null;
    unit: string | null;
    quantity: number;
    unit_cost: number;
    previous_cost: number | null;
    cost_recorded: boolean;
  }[];
};

async function loadInvoice(invoiceId: string): Promise<StoredInvoice> {
  const { data, error } = await supabaseAdmin
    .from("supplier_invoices")
    .select(
      "id, brand_id, invoice_date, supplier_name, invoice_number, total, paid, note, exchange_rate, supplier_invoice_items(product_id, description, sku, packing, unit, quantity, unit_cost, previous_cost, cost_recorded)"
    )
    .eq("id", invoiceId)
    .single();
  if (error || !data) throw new Error(missingMigration(error?.message ?? "Invoice not found"));
  return data as unknown as StoredInvoice;
}

// Puts Stock back as it was before the invoice: its quantities are taken back out of Stock and the Daily
// Ledger, and each product's cost goes back to what it was before the invoice set it -- unless the cost has
// been changed since (it no longer equals the invoice's unit cost), or the invoice was saved before the
// previous cost was kept.
async function reverseInvoice(invoice: StoredInvoice, reason: string): Promise<void> {
  const items = invoice.supplier_invoice_items ?? [];
  for (const item of items) {
    if (!item.product_id) continue;
    await adjustStockAction({ productId: item.product_id, delta: -Number(item.quantity), reason });
  }
  const restorable = items.filter((i) => i.product_id && i.cost_recorded);
  if (restorable.length) {
    const { data: now, error: nowError } = await supabaseAdmin
      .from("products")
      .select("id, cost_price")
      .in("id", [...new Set(restorable.map((i) => i.product_id as string))]);
    if (nowError) throw new Error(nowError.message);
    const current = new Map((now ?? []).map((p) => [p.id, p.cost_price === null ? null : round2(Number(p.cost_price))]));
    const done = new Set<string>();
    for (const i of restorable) {
      const id = i.product_id as string;
      if (done.has(id) || current.get(id) !== round2(Number(i.unit_cost))) continue;
      done.add(id);
      await setProductCostAction({ productId: id, costPrice: i.previous_cost === null ? null : Number(i.previous_cost) });
    }
  }
  await syncLedger(
    invoice.brand_id,
    invoice.invoice_date,
    items.map((i) => ({ productId: i.product_id, description: i.description ?? "", unit: i.unit ?? "", quantity: Number(i.quantity) })),
    -1
  );
}

const storedLines = (invoice: StoredInvoice): InvoiceLine[] =>
  (invoice.supplier_invoice_items ?? []).map((i) => ({
    productId: i.product_id,
    description: i.description ?? "",
    sku: i.sku ?? "",
    packing: i.packing ?? "",
    unit: i.unit ?? "",
    quantity: Number(i.quantity),
    unitCost: Number(i.unit_cost),
  }));

// Saves a supplier's invoice and applies it (see applyLines). If it can't be applied the invoice is not kept.
export async function createSupplierInvoiceAction(input: InvoiceInput): Promise<void> {
  const user = await requireStockAccess();
  const { supplierName, invoiceNumber, lines, total } = validateInvoice(input);

  const { data: invoice, error } = await supabaseAdmin
    .from("supplier_invoices")
    .insert({
      brand_id: input.brandId,
      supplier_name: supplierName,
      invoice_number: invoiceNumber || null,
      invoice_date: input.invoiceDate,
      total,
      paid: input.paid,
      note: input.note.trim() || null,
      exchange_rate: input.exchangeRate,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error || !invoice) {
    if (error?.code === "23505") throw new Error(`Invoice ${invoiceNumber} from ${supplierName} is already entered.`);
    throw new Error(missingMigration(error?.message ?? "Failed to save the invoice"));
  }

  try {
    await applyLines(invoice.id, input.brandId, input.invoiceDate, invoiceReason(invoiceNumber, supplierName), lines);
  } catch (e) {
    await supabaseAdmin.from("supplier_invoices").delete().eq("id", invoice.id);
    throw e;
  }

  revalidatePath("/stock/invoices");
  revalidatePath("/stock/ledger");
}

// Changes a saved invoice. The old one is taken back out first (Stock, costs and the Daily Ledger as they
// were before it), then the edited one is applied -- so Stock ends up as if the edited invoice had been
// entered in the first place. If the edit can't be applied, the old invoice is put back as it was.
export async function updateSupplierInvoiceAction(input: InvoiceInput & { invoiceId: string }): Promise<void> {
  await requireStockAccess();
  const { supplierName, invoiceNumber, lines, total } = validateInvoice(input);
  const old = await loadInvoice(input.invoiceId);
  if (old.brand_id !== input.brandId) throw new Error("That invoice belongs to another business");

  await reverseInvoice(old, `Edited supplier invoice${old.invoice_number ? ` ${old.invoice_number}` : ""} - ${old.supplier_name}`);
  try {
    const { error } = await supabaseAdmin
      .from("supplier_invoices")
      .update({
        supplier_name: supplierName,
        invoice_number: invoiceNumber || null,
        invoice_date: input.invoiceDate,
        total,
        paid: input.paid,
        note: input.note.trim() || null,
        exchange_rate: input.exchangeRate,
      })
      .eq("id", old.id);
    if (error) {
      if (error.code === "23505") throw new Error(`Invoice ${invoiceNumber} from ${supplierName} is already entered.`);
      throw new Error(missingMigration(error.message));
    }
    const { error: clearError } = await supabaseAdmin.from("supplier_invoice_items").delete().eq("invoice_id", old.id);
    if (clearError) throw new Error(clearError.message);
    await applyLines(old.id, input.brandId, input.invoiceDate, invoiceReason(invoiceNumber, supplierName), lines);
  } catch (e) {
    // Put the old invoice back exactly as it was.
    try {
      await supabaseAdmin
        .from("supplier_invoices")
        .update({
          supplier_name: old.supplier_name,
          invoice_number: old.invoice_number,
          invoice_date: old.invoice_date,
          total: old.total,
          paid: old.paid,
          note: old.note,
          exchange_rate: old.exchange_rate,
        })
        .eq("id", old.id);
      await supabaseAdmin.from("supplier_invoice_items").delete().eq("invoice_id", old.id);
      await applyLines(old.id, old.brand_id, old.invoice_date, invoiceReason(old.invoice_number, old.supplier_name), storedLines(old));
    } catch {
      // Could not put it back: the error below says the edit failed.
    }
    throw e;
  }

  revalidatePath("/stock/invoices");
  revalidatePath("/stock/ledger");
}

// What the invoice form lists: the business's Stock products (only those Stock shows -- POS-only ones and ones
// still on its website) and its Daily Ledger products with their SKU and Stock link. Loaded when the form is
// opened rather than with every visit to the page, and all the reads run together.
export async function loadInvoiceFormDataAction(input: { brandId: string }): Promise<InvoiceFormData> {
  await requireStockAccess();
  const { data: brand, error: brandError } = await supabaseAdmin.from("brands").select("slug").eq("id", input.brandId).single();
  if (brandError || !brand) throw new Error(brandError?.message ?? "Business not found");

  // Every page of a table, 1000 rows at a time.
  async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await page(from, from + 999);
      if (error) throw new Error(error.message);
      const part = (data ?? []) as T[];
      out.push(...part);
      if (part.length < 1000) return out;
    }
  }

  const [site, stock, skuEntries, ledger] = await Promise.all([
    websiteStock(brand.slug),
    readAll<{
      id: string;
      name: string;
      sku: string | null;
      unit: string;
      cost_price: number | null;
      pos_only: boolean;
      product_site_links: { site_product_id: string; variation_id: string }[];
    }>((from, to) =>
      supabaseAdmin
        .from("products")
        .select("id, name, sku, unit, cost_price, pos_only, product_site_links(site_product_id, variation_id)")
        .eq("brand_id", input.brandId)
        .eq("is_active", true)
        .neq("name", "")
        .order("name")
        .range(from, to)
    ),
    // The ledger keeps SKUs per month: the newest month's is used.
    readAll<{ value: string; daily_ledger_products: { name: string } }>((from, to) =>
      supabaseAdmin
        .from("daily_ledger_product_entries")
        .select("value, month, daily_ledger_products!inner(name, brand_id)")
        .eq("field", "sku")
        .eq("daily_ledger_products.brand_id", input.brandId)
        .order("month", { ascending: false })
        .order("product_id")
        .range(from, to)
    ).catch(() => []),
    // stock_product_id is migration 0100 (the link to a Stock product); without it nothing is linked. Before the
    // ledger's own migration there are no ledger products at all.
    readAll<{ name: string; unit: string; stock_product_id?: string | null }>((from, to) =>
      supabaseAdmin
        .from("daily_ledger_products")
        .select("name, unit, stock_product_id")
        .eq("brand_id", input.brandId)
        .order("name")
        .range(from, to)
    ).catch(() =>
      readAll<{ name: string; unit: string }>((from, to) =>
        supabaseAdmin.from("daily_ledger_products").select("name, unit").eq("brand_id", input.brandId).order("name").range(from, to)
      ).catch(() => [])
    ),
  ]);

  // A POS row whose website product was deleted stays active but is not in Stock, so it is left out too.
  const products: ProductOption[] = stock
    .filter((p) => !site || p.pos_only || p.product_site_links.some((l) => site.keys.has(`${l.site_product_id}::${l.variation_id || ""}`)))
    .map((p) => ({ id: p.id, name: p.name, sku: p.sku, unit: p.unit, costPrice: p.cost_price }));

  const ledgerSkus = new Map<string, string>();
  for (const e of skuEntries) {
    const key = e.daily_ledger_products.name.trim().toLowerCase();
    if (e.value.trim() && !ledgerSkus.has(key)) ledgerSkus.set(key, e.value.trim());
  }

  // The linked Stock product's SKU, unit and cost (it can belong to another business, so it isn't in `products`).
  const ledgerRows = ledger as { name: string; unit: string; stock_product_id?: string | null }[];
  const linkedIds = [...new Set(ledgerRows.map((p) => p.stock_product_id).filter((id): id is string => !!id))];
  const linkedStock = new Map<string, { sku: string | null; unit: string; costPrice: number | null }>();
  const linkedPages = await Promise.all(
    Array.from({ length: Math.ceil(linkedIds.length / 100) }, (_, i) =>
      supabaseAdmin.from("products").select("id, sku, unit, cost_price").in("id", linkedIds.slice(i * 100, (i + 1) * 100))
    )
  );
  for (const { data } of linkedPages) for (const p of data ?? []) linkedStock.set(p.id, { sku: p.sku, unit: p.unit, costPrice: p.cost_price });

  const ledgerProducts: LedgerOption[] = ledgerRows.map((p) => ({
    name: p.name,
    unit: p.unit,
    sku: ledgerSkus.get(p.name.trim().toLowerCase()) ?? "",
    stockProductId: p.stock_product_id ?? null,
    stock: (p.stock_product_id ? linkedStock.get(p.stock_product_id) : null) ?? null,
  }));
  return { brandId: input.brandId, products, ledgerProducts };
}

// Marks an invoice paid or unpaid. Nothing else changes: Stock, costs and the ledger don't depend on it.
export async function setSupplierInvoicePaidAction(input: { invoiceId: string; paid: boolean }): Promise<void> {
  await requireStockAccess();
  const { error } = await supabaseAdmin.from("supplier_invoices").update({ paid: input.paid }).eq("id", input.invoiceId);
  if (error) throw new Error(missingMigration(error.message));
  revalidatePath("/stock/invoices");
}

// Deletes an invoice and puts Stock back as it was before it (see reverseInvoice).
export async function deleteSupplierInvoiceAction(input: { invoiceId: string }): Promise<void> {
  await requireStockAccess();
  const invoice = await loadInvoice(input.invoiceId);
  await reverseInvoice(invoice, `Removed supplier invoice${invoice.invoice_number ? ` ${invoice.invoice_number}` : ""} - ${invoice.supplier_name}`);
  const { error: deleteError } = await supabaseAdmin.from("supplier_invoices").delete().eq("id", input.invoiceId);
  if (deleteError) throw new Error(deleteError.message);

  revalidatePath("/stock/invoices");
  revalidatePath("/stock/ledger");
}
