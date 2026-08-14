"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/auth-server";

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
  if (!description.trim()) throw new Error("Description is required");
  if (amount <= 0) throw new Error("Amount must be greater than 0");
  const user = await getSessionUser();

  const { error } = await supabaseAdmin.from("expenses").insert({
    brand_id: brandId,
    description: description.trim(),
    amount,
    category: category?.trim() || null,
    expense_date: date,
    created_by: user?.id ?? null,
  });

  if (error) throw error;
  revalidatePath("/accountance");
}

export async function deleteExpenseAction(expenseId: string): Promise<void> {
  const { error } = await supabaseAdmin.from("expenses").delete().eq("id", expenseId);
  if (error) throw error;
  revalidatePath("/accountance");
}
