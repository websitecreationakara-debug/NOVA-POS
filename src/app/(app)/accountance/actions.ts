"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/auth-server";
import { requireFullStockAccess, requireStockAccess } from "@/lib/stockAccess";
import { adjustStockAction } from "@/app/(app)/stock/actions";
import { ALL_BUSINESSES_ID, getBrands, getStockPickerItems, type StockPickerItem } from "@/lib/supabase/queries";

// The "+ Add waste item" product list (POS products plus the brand's live storefront
// catalog). Loaded when the form is opened, not with the page: it reads the
// storefront, which made every visit to the COGS tab wait about a second for a list
// most visits never use.
export async function getWasteItemsAction(brandId: string): Promise<StockPickerItem[]> {
  await requireStockAccess();
  const brand = (await getBrands()).find((b) => b.id === brandId);
  if (!brand) return [];
  return getStockPickerItems(brand.id, brand.slug);
}

export async function saveReconciliationAction(input: {
  brandId: string;
  date: string;
  countedCash: number;
  expectedCash: number;
  expectedBankQr: number;
  notes?: string;
}): Promise<void> {
  const { brandId, date, countedCash, expectedCash, expectedBankQr, notes } = input;
  const variance = countedCash - expectedCash;
  const user = await getSessionUser();

  const { error } = await supabaseAdmin.from("cash_reconciliations").upsert(
    {
      brand_id: brandId,
      reconciliation_date: date,
      expected_cash: expectedCash,
      expected_bank_qr: expectedBankQr,
      counted_cash: countedCash,
      variance,
      notes: notes || null,
      created_by: user?.id ?? null,
    },
    { onConflict: "brand_id,reconciliation_date" }
  );

  if (error) throw error;
  revalidatePath("/accountance");
}

export async function addExpenseAction(input: {
  brandId: string;
  description: string;
  amount: number;
  category?: string;
  date: string;
}): Promise<void> {
  const { brandId, description, amount, category, date } = input;
  if (amount <= 0) throw new Error("Amount must be greater than 0");
  const user = await getSessionUser();

  const { error } = await supabaseAdmin.from("expenses").insert({
    // The "All Businesses" pseudo-id is stored as no business (migration 0057).
    brand_id: brandId === ALL_BUSINESSES_ID ? null : brandId,
    description: description.trim(),
    amount,
    category: category?.trim() || null,
    expense_date: date,
    created_by: user?.id ?? null,
  });

  if (error) throw error;
  revalidatePath("/accountance");
}

export async function updateExpenseAction(
  expenseId: string,
  input: {
    brandId: string;
    description: string;
    amount: number;
    category?: string;
    date: string;
  }
): Promise<void> {
  const { brandId, description, amount, category, date } = input;
  if (amount <= 0) throw new Error("Amount must be greater than 0");

  const { error } = await supabaseAdmin
    .from("expenses")
    .update({
      brand_id: brandId === ALL_BUSINESSES_ID ? null : brandId,
      description: description.trim(),
      amount,
      category: category?.trim() || null,
      expense_date: date,
    })
    .eq("id", expenseId);

  if (error) throw error;
  revalidatePath("/accountance");
}

export async function deleteExpenseAction(expenseId: string): Promise<void> {
  const { error } = await supabaseAdmin.from("expenses").delete().eq("id", expenseId);
  if (error) throw error;
  revalidatePath("/accountance");
}

async function loadWasteRow(id: string): Promise<{ productId: string; delta: number }> {
  const { data: row, error } = await supabaseAdmin
    .from("stock_adjustments")
    .select("product_id, delta, category")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!row || row.category !== "waste") throw new Error("Waste entry not found");
  return { productId: row.product_id, delta: row.delta };
}

// Fully undoes a logged waste entry -- adds the wasted quantity back to
// stock (and pushes that restored count out to the storefront too, if the
// product is linked -- see adjustStockAction/pushStockToSites) before
// removing the row, so deleting one doesn't leave stock permanently short.
export async function deleteWasteLogAction(id: string): Promise<void> {
  await requireFullStockAccess();
  const { productId, delta } = await loadWasteRow(id);

  if (delta !== 0) {
    await adjustStockAction({
      productId,
      delta: -delta,
      reason: "Waste entry deleted",
      category: "other",
    });
  }

  const { error } = await supabaseAdmin.from("stock_adjustments").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/accountance");
}

// Same net effect as deleting the old entry and logging a fresh one --
// reverses the old quantity, removes the old row, then logs the edited
// values as a brand-new waste entry (reusing adjustStockAction for both
// halves keeps stock and the storefront in sync exactly like any other
// waste edit would).
export async function updateWasteLogAction(input: {
  id: string;
  quantity: number;
  reason: string;
  date: string;
}): Promise<void> {
  await requireFullStockAccess();
  const { id, quantity, reason, date } = input;
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive number");
  }
  if (!date) throw new Error("Date is required");

  const { productId, delta } = await loadWasteRow(id);

  if (delta !== 0) {
    await adjustStockAction({
      productId,
      delta: -delta,
      reason: "Waste entry edited",
      category: "other",
    });
  }

  const { error } = await supabaseAdmin.from("stock_adjustments").delete().eq("id", id);
  if (error) throw error;

  await adjustStockAction({
    productId,
    delta: -quantity,
    reason: reason.trim() || "Waste",
    category: "waste",
    createdAt: `${date}T12:00:00.000Z`,
  });

  revalidatePath("/accountance");
}
