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
