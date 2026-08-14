import { supabaseAdmin } from "@/lib/supabase/server";
import type { Brand, CashReconciliation, Category, Expense, Order, Product } from "@/types/database";

export type ProductWithStock = Product & {
  stock_quantity: number;
  low_stock_threshold: number;
};

export async function getBrands(): Promise<Brand[]> {
  const { data, error } = await supabaseAdmin.from("brands").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getCatalogForBrand(brandId: string): Promise<{
  categories: Category[];
  products: ProductWithStock[];
}> {
  const [{ data: categories, error: catError }, { data: products, error: prodError }] =
    await Promise.all([
      supabaseAdmin
        .from("categories")
        .select("*")
        .eq("brand_id", brandId)
        .order("sort_order"),
      // Embed stock_levels via its FK to products instead of a second
      // query with .in(productIds) -- that broke once a brand's catalog
      // grew past a few hundred products (URL length limit on the GET).
      supabaseAdmin
        .from("products")
        .select("*, stock_levels(quantity, low_stock_threshold)")
        .eq("brand_id", brandId)
        .eq("is_active", true)
        .order("name"),
    ]);

  if (catError) throw catError;
  if (prodError) throw prodError;

  type ProductRow = Product & {
    stock_levels: { quantity: number; low_stock_threshold: number } | null;
  };
  const productsWithStock: ProductWithStock[] = ((products ?? []) as ProductRow[]).map((p) => {
    const { stock_levels, ...product } = p;
    return {
      ...product,
      stock_quantity: stock_levels?.quantity ?? 0,
      low_stock_threshold: stock_levels?.low_stock_threshold ?? 0,
    };
  });

  return { categories: categories ?? [], products: productsWithStock };
}

export type DailySalesSummary = {
  cashTotal: number;
  bankQrTotal: number;
  orderCount: number;
  total: number;
};

export async function getDailySales(
  brandId: string,
  date: string
): Promise<{ summary: DailySalesSummary; orders: Order[] }> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("brand_id", brandId)
    .eq("status", "paid")
    .gte("paid_at", `${date}T00:00:00.000Z`)
    .lte("paid_at", `${date}T23:59:59.999Z`)
    .order("paid_at", { ascending: false });

  if (error) throw error;
  const orders = data ?? [];
  const cashTotal = orders
    .filter((o) => o.payment_method === "cash")
    .reduce((sum, o) => sum + o.total, 0);
  const bankQrTotal = orders
    .filter((o) => o.payment_method === "bank_qr")
    .reduce((sum, o) => sum + o.total, 0);

  return {
    summary: { cashTotal, bankQrTotal, orderCount: orders.length, total: cashTotal + bankQrTotal },
    orders,
  };
}

export async function getReconciliation(
  brandId: string,
  date: string
): Promise<CashReconciliation | null> {
  const { data, error } = await supabaseAdmin
    .from("cash_reconciliations")
    .select("*")
    .eq("brand_id", brandId)
    .eq("reconciliation_date", date)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getExpensesForDate(brandId: string, date: string): Promise<Expense[]> {
  const { data, error } = await supabaseAdmin
    .from("expenses")
    .select("*")
    .eq("brand_id", brandId)
    .eq("expense_date", date)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}
