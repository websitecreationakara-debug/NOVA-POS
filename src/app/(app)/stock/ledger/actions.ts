"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { requireStockAccess } from "@/lib/stockAccess";
import { buildXlsx, type XlsxCell, type XlsxColumn } from "@/lib/xlsxWriter";
import { daysOfMonth, isLedgerField, LEDGER_OWN_PREFIX, LEDGER_TEXT_FIELDS, type LedgerSiteItem } from "@/lib/dailyLedger";
import { ensurePosProductForSiteProduct } from "@/app/(app)/sales/websiteActions";
import type { WebsiteCatalogId } from "@/lib/websiteProducts/types";
import { getBrands, getDailyLedger } from "@/lib/supabase/queries";
import { adjustStockAction } from "../actions";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// The typed-value tables only accept the fields their check constraint lists; "case_size" (Units / case) is
// added to it by migration 0108.
function caseSizeMigrationHint(error: { code?: string }, field: string): string | null {
  return error.code === "23514" && field === "case_size"
    ? "Run migration 0108_daily_ledger_case_size.sql in Supabase first, then try again."
    : null;
}

// Saves one value typed into a Daily Ledger cell -- for that product and month only; Stock, prices and
// orders are not touched. An empty value deletes the entry, so the cell goes back to its worked-out number.
export async function setLedgerEntryAction(input: {
  productId: string;
  month: string;
  field: string;
  value: string | null;
  // For a website product with no POS product yet: it is created (and linked) now, then the value saved on it.
  site?: LedgerSiteItem;
  // The number the cell showed before this change. A P / O typed on a row linked to a Stock product also
  // changes that Stock product by the difference.
  previous?: number;
}): Promise<void> {
  await requireStockAccess();
  if (!MONTH_RE.test(input.month)) throw new Error("Pick a month");
  if (!isLedgerField(input.field)) throw new Error("That cell can't be typed into");
  const value = input.value?.trim() ?? "";
  if (value.length > 40) throw new Error("That is too long");
  if (value !== "" && !LEDGER_TEXT_FIELDS.includes(input.field) && !Number.isFinite(Number(value))) {
    throw new Error("Type a number");
  }

  // A product added from the ledger itself keeps its typed values in its own table.
  if (input.productId.startsWith(LEDGER_OWN_PREFIX)) {
    const ownId = input.productId.slice(LEDGER_OWN_PREFIX.length);

    // A purchase (P) or other out (O) typed on a row linked to a Stock product is real stock: the Stock
    // product changes by what the cell changed (P adds, O takes out), logged on that day, so Stock and the
    // ledger stay the same. Sales (S) come from orders, so a typed S stays a ledger note. Clearing a cell
    // changes nothing in Stock -- type the old number back to undo.
    const dayCell = /^([po]):(0[1-9]|[12][0-9]|3[01])$/.exec(input.field);
    if (dayCell && value !== "") {
      const { data: own, error: ownError } = await supabaseAdmin
        .from("daily_ledger_products")
        .select("stock_product_id")
        .eq("id", ownId)
        .maybeSingle();
      // Before migration 0100 there is no link column, so nothing is linked.
      const stockId = ownError ? null : ((own as { stock_product_id?: string | null } | null)?.stock_product_id ?? null);
      const delta = Math.round((Number(value) - (Number.isFinite(input.previous) ? (input.previous as number) : 0)) * 100) / 100;
      if (stockId && delta !== 0) {
        const noon = new Date(`${input.month}-${dayCell[2]}T12:00:00+07:00`);
        await adjustStockAction({
          productId: stockId,
          delta: dayCell[1] === "p" ? delta : -delta,
          reason: `Daily Ledger ${dayCell[1].toUpperCase()} ${input.month}-${dayCell[2]}`,
          // Logged on the cell's day (never in the future).
          createdAt: (noon.getTime() > Date.now() ? new Date() : noon).toISOString(),
        });
      }
    }

    const q =
      value === ""
        ? supabaseAdmin
            .from("daily_ledger_product_entries")
            .delete()
            .eq("product_id", ownId)
            .eq("month", input.month)
            .eq("field", input.field)
        : supabaseAdmin
            .from("daily_ledger_product_entries")
            .upsert(
              { product_id: ownId, month: input.month, field: input.field, value, updated_at: new Date().toISOString() },
              { onConflict: "product_id,month,field" }
            );
    const { error } = await q;
    if (error) throw new Error(caseSizeMigrationHint(error, input.field) ?? error.message);
    revalidatePath("/stock/ledger");
    return;
  }

  let productId = input.productId;
  if (input.site) {
    // Nothing to clear on a product that doesn't exist yet.
    if (value === "") return;
    const linked = await ensurePosProductForSiteProduct({
      ...input.site,
      catalogId: input.site.catalogId as WebsiteCatalogId,
      variationId: input.site.variationId || null,
    });
    productId = linked.id;
  }

  if (value === "") {
    const { error } = await supabaseAdmin
      .from("daily_ledger_entries")
      .delete()
      .eq("product_id", productId)
      .eq("month", input.month)
      .eq("field", input.field);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabaseAdmin
      .from("daily_ledger_entries")
      .upsert(
        { product_id: productId, month: input.month, field: input.field, value, updated_at: new Date().toISOString() },
        { onConflict: "product_id,month,field" }
      );
    if (error) {
      throw new Error(
        caseSizeMigrationHint(error, input.field) ??
          (/daily_ledger_entries/.test(error.message) ? "Run migration 0089 first, then try again." : error.message)
      );
    }
  }
  revalidatePath("/stock/ledger");
}

// The ledger's "Import CSV" button: many typed values at once, saved exactly as setLedgerEntryAction
// would save them one by one (blank values are never sent, so an import can't erase anything).
export async function importLedgerEntriesAction(input: {
  month: string;
  entries: { productId: string; field: string; value: string; site?: LedgerSiteItem }[];
}): Promise<{ saved: number }> {
  await requireStockAccess();
  if (!MONTH_RE.test(input.month)) throw new Error("Pick a month");
  if (input.entries.length > 2000) throw new Error("Too many values in one go");
  const now = new Date().toISOString();
  const own: { product_id: string; month: string; field: string; value: string; updated_at: string }[] = [];
  const linked: typeof own = [];
  const posIds = new Map<string, string>();
  for (const e of input.entries) {
    const value = e.value.trim();
    if (!isLedgerField(e.field) || value === "" || value.length > 40) continue;
    if (!LEDGER_TEXT_FIELDS.includes(e.field) && !Number.isFinite(Number(value))) continue;
    if (e.productId.startsWith(LEDGER_OWN_PREFIX)) {
      own.push({ product_id: e.productId.slice(LEDGER_OWN_PREFIX.length), month: input.month, field: e.field, value, updated_at: now });
      continue;
    }
    let productId = e.productId;
    if (e.site) {
      let id = posIds.get(e.productId);
      if (!id) {
        id = (
          await ensurePosProductForSiteProduct({
            ...e.site,
            catalogId: e.site.catalogId as WebsiteCatalogId,
            variationId: e.site.variationId || null,
          })
        ).id;
        posIds.set(e.productId, id);
      }
      productId = id;
    }
    linked.push({ product_id: productId, month: input.month, field: e.field, value, updated_at: now });
  }
  // One row per cell: an upsert can't touch the same row twice (a file may list a product twice).
  const unique = (rows: typeof own) => [...new Map(rows.map((r) => [`${r.product_id}|${r.field}`, r])).values()];
  if (own.length) {
    const { error } = await supabaseAdmin.from("daily_ledger_product_entries").upsert(unique(own), { onConflict: "product_id,month,field" });
    if (error) throw new Error(error.message);
  }
  if (linked.length) {
    const { error } = await supabaseAdmin.from("daily_ledger_entries").upsert(unique(linked), { onConflict: "product_id,month,field" });
    if (error) {
      throw new Error(
        /daily_ledger_entries/.test(error.message) ? "Run migration 0089 first, then try again." : error.message
      );
    }
  }
  revalidatePath("/stock/ledger");
  return { saved: own.length + linked.length };
}

// Links ledger products to the Stock products they are the same as (or unlinks them: stockProductId null).
// The Stock product can be of any business: one business's ledger can list another business's products
// (e.g. beer in the Premium Foods ledger that Stock has under SORA SAKE). Nothing is renamed or merged: the
// link only tells a supplier invoice that a line for the ledger product also belongs to that Stock product.
export async function linkLedgerProductsAction(input: {
  links: { ledgerProductId: string; stockProductId: string | null }[];
}): Promise<{ linked: number }> {
  await requireStockAccess();
  if (input.links.length === 0) return { linked: 0 };
  if (input.links.length > 1000) throw new Error("Too many links in one go");
  const ledgerIds = input.links.map((l) => {
    if (!l.ledgerProductId.startsWith(LEDGER_OWN_PREFIX)) throw new Error("Only products added to the ledger can be linked");
    return l.ledgerProductId.slice(LEDGER_OWN_PREFIX.length);
  });
  const stockIds = [...new Set(input.links.map((l) => l.stockProductId).filter((id): id is string => !!id))];

  const brandOf = new Map<string, string>();
  for (let i = 0; i < ledgerIds.length; i += 100) {
    const { data, error } = await supabaseAdmin.from("daily_ledger_products").select("id, brand_id").in("id", ledgerIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) brandOf.set(r.id, r.brand_id);
  }
  const stockExists = new Set<string>();
  for (let i = 0; i < stockIds.length; i += 100) {
    const { data, error } = await supabaseAdmin.from("products").select("id").in("id", stockIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) stockExists.add(r.id);
  }

  let linked = 0;
  for (let n = 0; n < input.links.length; n++) {
    const ledgerId = ledgerIds[n];
    const stockId = input.links[n].stockProductId;
    if (!brandOf.has(ledgerId)) throw new Error("That ledger product no longer exists");
    if (stockId && !stockExists.has(stockId)) throw new Error("That Stock product no longer exists");
    const { error } = await supabaseAdmin.from("daily_ledger_products").update({ stock_product_id: stockId }).eq("id", ledgerId);
    if (error) throw new Error(/stock_product_id/.test(error.message) ? "Run migration 0100 first, then try again." : error.message);
    if (stockId) linked++;
  }
  revalidatePath("/stock/ledger");
  revalidatePath("/stock/ledger/match");
  revalidatePath("/stock/invoices");
  return { linked };
}

// The link picker's search: Stock products whose name or SKU holds the text -- the business's own first, then
// those of the other businesses (30 of each at most). `business` is set only on another business's product.
export async function searchStockProductsAction(input: {
  brandId: string;
  q: string;
}): Promise<{ id: string; name: string; sku: string | null; business: string | null }[]> {
  await requireStockAccess();
  const term = input.q.replace(/[,()%*\\]/g, " ").trim();
  const find = async (own: boolean) => {
    let query = supabaseAdmin
      .from("products")
      .select("id, name, sku, brands(name)")
      .eq("is_active", true)
      .neq("name", "")
      .order("name")
      .limit(30);
    query = own ? query.eq("brand_id", input.brandId) : query.neq("brand_id", input.brandId);
    if (term) query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%`);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as { id: string; name: string; sku: string | null; brands: { name: string } | null }[]).map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      business: own ? null : (p.brands?.name ?? "Other business"),
    }));
  };
  const [own, others] = await Promise.all([find(true), find(false)]);
  return [...own, ...others];
}

// The ledger's "Import CSV": rows whose name + SKU are not in the ledger yet become new ledger products (migration
// 0091), with their unit, price and category and every typed value from the file for the month. Products that
// are already there are updated by importLedgerEntriesAction instead -- never duplicated.
export async function importLedgerNewProductsAction(input: {
  brandId: string;
  month: string;
  products: {
    name: string;
    unit: string;
    price: number;
    category: string | null;
    entries: { field: string; value: string }[];
  }[];
}): Promise<{ created: number }> {
  await requireStockAccess();
  if (!MONTH_RE.test(input.month)) throw new Error("Pick a month");
  if (input.products.length > 2000) throw new Error("Too many new products in one go");
  const clean = input.products
    .map((p) => ({ ...p, name: p.name.trim(), unit: p.unit.trim() || "pcs", category: p.category?.trim().slice(0, 60) || null }))
    .filter((p) => p.name && Number.isFinite(p.price) && p.price >= 0);

  // The screen only lists the products of the month being viewed, so a product first added in another month
  // would look new. Check them all: one with the same name and SKU (or no SKU on either side) is the same
  // product -- it is reused, and listed from this month on if it started later.
  const existing: { id: string; name: string; first_month: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("daily_ledger_products")
      .select("id, name, first_month")
      .eq("brand_id", input.brandId)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    existing.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const skusOf = new Map<string, Set<string>>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("daily_ledger_product_entries")
      .select("product_id, value, daily_ledger_products!inner(brand_id)")
      .eq("field", "sku")
      .eq("daily_ledger_products.brand_id", input.brandId)
      .order("product_id")
      .order("month")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const e of (data ?? []) as unknown as { product_id: string; value: string }[]) {
      skusOf.set(e.product_id, (skusOf.get(e.product_id) ?? new Set()).add(e.value.trim().toLowerCase()));
    }
    if (!data || data.length < 1000) break;
  }
  const taken = new Set<string>();
  const ids: (string | undefined)[] = clean.map((p) => {
    const fileSku = (p.entries.find((e) => e.field === "sku")?.value ?? "").trim().toLowerCase();
    const same = existing.find((x) => {
      if (taken.has(x.id) || x.name.trim().toLowerCase() !== p.name.toLowerCase()) return false;
      const sk = skusOf.get(x.id);
      return !fileSku || !sk || sk.size === 0 || sk.has(fileSku);
    });
    if (same) taken.add(same.id);
    return same?.id;
  });
  const startLater = existing.filter((x) => taken.has(x.id) && x.first_month && x.first_month > input.month).map((x) => x.id);
  if (startLater.length) {
    const { error } = await supabaseAdmin.from("daily_ledger_products").update({ first_month: input.month }).in("id", startLater);
    if (error) throw new Error(error.message);
  }
  const fresh = clean.map((p, i) => ({ p, i })).filter(({ i }) => !ids[i]);
  for (let c = 0; c < fresh.length; c += 200) {
    const chunk = fresh.slice(c, c + 200);
    const { data, error } = await supabaseAdmin
      .from("daily_ledger_products")
      .insert(
        chunk.map(({ p }) => ({
          brand_id: input.brandId,
          name: p.name,
          unit: p.unit,
          unit_price: p.price,
          category: p.category,
          first_month: input.month,
        }))
      )
      .select("id");
    if (error) throw new Error(error.message);
    // insert().select() returns the rows in insert order
    (data ?? []).forEach((d, n) => {
      ids[chunk[n].i] = d.id;
    });
  }
  const created = clean;
  const now = new Date().toISOString();
  const rows: { product_id: string; month: string; field: string; value: string; updated_at: string }[] = [];
  created.forEach((p, i) => {
    const productId = ids[i];
    if (!productId) return;
    for (const e of p.entries) {
      const value = e.value.trim();
      if (!isLedgerField(e.field) || value === "" || value.length > 40) continue;
      if (!LEDGER_TEXT_FIELDS.includes(e.field) && !Number.isFinite(Number(value))) continue;
      rows.push({ product_id: productId, month: input.month, field: e.field, value, updated_at: now });
    }
  });
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await supabaseAdmin
      .from("daily_ledger_product_entries")
      .upsert(rows.slice(i, i + 1000), { onConflict: "product_id,month,field" });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/stock/ledger");
  return { created: fresh.length };
}

// The ledger's "Add product" button: a product that exists in the Daily Ledger only (migration 0091) --
// not in Stock, Sales or the website. Everything else about it is typed into the ledger.
export async function createLedgerProductAction(input: {
  brandId: string;
  name: string;
  unit: string;
  price: number;
  // The group it sits under (an existing category or a new one); blank = "Added in ledger".
  category?: string;
  // The month being viewed: the product is listed from this month on.
  month: string;
}): Promise<void> {
  await requireStockAccess();
  if (!MONTH_RE.test(input.month)) throw new Error("Pick a month");
  const name = input.name.trim();
  if (!name) throw new Error("Type the product name");
  if (!Number.isFinite(input.price) || input.price < 0) throw new Error("Price cannot be negative");
  const category = input.category?.trim() || null;
  if (category && category.length > 60) throw new Error("The category name is too long");
  const { error } = await supabaseAdmin
    .from("daily_ledger_products")
    .insert({ brand_id: input.brandId, name, unit: input.unit.trim() || "pcs", unit_price: input.price, category, first_month: input.month });
  if (error) {
    throw new Error(
      /first_month/.test(error.message)
        ? "Run migration 0093 first, then try again."
        : /category/.test(error.message)
        ? "Run migration 0092 first, then try again."
        : /daily_ledger_products/.test(error.message)
          ? "Run migration 0091 first, then try again."
          : error.message
    );
  }
  revalidatePath("/stock/ledger");
}

// The Delete button on a product added from the ledger: it and what was typed into it are removed.
export async function deleteLedgerProductAction(input: { productId: string }): Promise<void> {
  await requireStockAccess();
  if (!input.productId.startsWith(LEDGER_OWN_PREFIX)) throw new Error("Not a ledger product");
  const { error } = await supabaseAdmin
    .from("daily_ledger_products")
    .delete()
    .eq("id", input.productId.slice(LEDGER_OWN_PREFIX.length));
  if (error) throw new Error(error.message);
  revalidatePath("/stock/ledger");
}

// The Delete button on a "Removed from Stock" row: the product is dropped from the ledger only. Stock,
// its history and its orders are not touched, and a product still in Stock can't be dropped this way.
export async function hideRemovedLedgerProductAction(input: { productId: string }): Promise<void> {
  await requireStockAccess();
  const { data: product, error } = await supabaseAdmin
    .from("products")
    .select("is_active")
    .eq("id", input.productId)
    .single();
  if (error || !product) throw new Error(error?.message ?? "Product not found");
  if (product.is_active) throw new Error("This product is still in Stock -- delete it in Stock first");
  const { error: hideError } = await supabaseAdmin
    .from("daily_ledger_hidden")
    .upsert({ product_id: input.productId }, { onConflict: "product_id" });
  if (hideError) {
    throw new Error(/daily_ledger_hidden/.test(hideError.message) ? "Run migration 0090 first, then try again." : hideError.message);
  }
  revalidatePath("/stock/ledger");
}

// The month's Daily Ledger as an Excel file: one row per product, with P / S / O / R columns for every
// day, then the month totals -- the same figures as on screen. Returned as base64 so the browser can
// save it (same hand-off the Orders backup uses).
export async function exportDailyLedgerAction(
  brandId: string,
  month: string
): Promise<{ filename: string; mime: string; base64: string }> {
  await requireStockAccess();
  if (!MONTH_RE.test(month)) throw new Error("Pick a month");
  // "all" is every business, each product row tagged with its business.
  const allBrands = await getBrands();
  const brand = allBrands.find((b) => b.id === brandId);
  if (!brand && brandId !== "all") throw new Error("Pick a business");
  const shown = brand ? [brand] : allBrands;
  const rows = (
    await Promise.all(shown.map(async (b) => (await getDailyLedger(b.id, month)).map((r) => ({ ...r, brandName: b.name }))))
  ).flat();
  const days = daysOfMonth(month);

  const columns: XlsxColumn[] = [
    ...(brand ? [] : [{ header: "Business", width: 22, kind: "text" } as XlsxColumn]),
    { header: "SKU", width: 14, kind: "text" },
    { header: "Category", width: 20, kind: "text" },
    { header: "Name", width: 36, kind: "text" },
    { header: "Weight", width: 20, kind: "text" },
    { header: "Unit", width: 8, kind: "text" },
    { header: "Unit price", width: 11, kind: "money" },
    { header: "Ex-Date", width: 12, kind: "text" },
    { header: "S-Price LOKA", width: 13, kind: "money" },
    { header: "TC+10%", width: 10, kind: "money" },
    { header: "Total Cost", width: 11, kind: "money" },
    { header: "Begining stock", width: 14, kind: "number" },
  ];
  for (const d of days) {
    const dd = d.slice(8);
    for (const k of ["P", "S", "O", "R"]) columns.push({ header: `${dd} ${k}`, width: 7, kind: "number" });
  }
  columns.push(
    { header: "Total In", width: 10, kind: "number" },
    { header: "Total Sold", width: 10, kind: "number" },
    { header: "Total Other", width: 11, kind: "number" },
    { header: "Ending", width: 10, kind: "number" },
    { header: "Ending value", width: 13, kind: "money" }
  );

  const blank = (n: number): XlsxCell => (n === 0 ? null : n);
  const body: XlsxCell[][] = rows.map((r) => [
    ...(brand ? [] : [r.brandName]),
    r.sku ?? "",
    r.categoryName,
    r.name,
    r.size,
    r.unit,
    r.unitPrice,
    r.exDate || null,
    r.originalCost,
    r.cost10,
    r.totalCost,
    r.begin,
    ...r.days.flatMap((d): XlsxCell[] => [blank(d.p), blank(d.s), blank(d.o), d.r]),
    r.totalIn,
    r.totalSold,
    r.totalOther,
    r.ending,
    r.endingValue,
  ]);

  const bytes = buildXlsx("Daily Ledger", columns, body);
  return {
    filename: `daily-ledger-${brand?.slug ?? "all"}-${month}.xlsx`,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    base64: bytes.toString("base64"),
  };
}
