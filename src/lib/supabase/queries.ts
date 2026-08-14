import { supabaseAdmin } from "@/lib/supabase/server";
import type { Brand, Category, Product } from "@/types/database";

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
      supabaseAdmin
        .from("products")
        .select("*")
        .eq("brand_id", brandId)
        .eq("is_active", true)
        .order("name"),
    ]);

  if (catError) throw catError;
  if (prodError) throw prodError;

  const productIds = (products ?? []).map((p) => p.id);
  if (productIds.length === 0) {
    return { categories: categories ?? [], products: [] };
  }

  const { data: stockRows, error: stockError } = await supabaseAdmin
    .from("stock_levels")
    .select("product_id, quantity, low_stock_threshold")
    .in("product_id", productIds);
  if (stockError) throw stockError;

  const stockByProduct = new Map(stockRows?.map((s) => [s.product_id, s]) ?? []);
  const productsWithStock: ProductWithStock[] = (products ?? []).map((p) => ({
    ...p,
    stock_quantity: stockByProduct.get(p.id)?.quantity ?? 0,
    low_stock_threshold: stockByProduct.get(p.id)?.low_stock_threshold ?? 0,
  }));

  return { categories: categories ?? [], products: productsWithStock };
}
