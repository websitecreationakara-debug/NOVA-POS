"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { requireStockAccess } from "@/lib/stockAccess";
import { buildXlsx, type XlsxCell, type XlsxColumn } from "@/lib/xlsxWriter";
import { daysOfMonth, isLedgerField, LEDGER_OWN_PREFIX, LEDGER_TEXT_FIELDS, type LedgerSiteItem } from "@/lib/dailyLedger";
import { ensurePosProductForSiteProduct } from "@/app/(app)/sales/websiteActions";
import type { WebsiteCatalogId } from "@/lib/websiteProducts/types";
import { getBrands, getDailyLedger } from "@/lib/supabase/queries";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Saves one value typed into a Daily Ledger cell -- for that product and month only; Stock, prices and
// orders are not touched. An empty value deletes the entry, so the cell goes back to its worked-out number.
export async function setLedgerEntryAction(input: {
  productId: string;
  month: string;
  field: string;
  value: string | null;
  // For a website product with no POS product yet: it is created (and linked) now, then the value saved on it.
  site?: LedgerSiteItem;
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
    if (error) throw new Error(error.message);
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
        /daily_ledger_entries/.test(error.message) ? "Run migration 0089 first, then try again." : error.message
      );
    }
  }
  revalidatePath("/stock/ledger");
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
