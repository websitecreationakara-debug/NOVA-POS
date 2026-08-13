import { supabaseAdmin } from "@/lib/supabase/server";
import type { Brand, Category, Product } from "@/types/database";

export async function getBrands(): Promise<Brand[]> {
  const { data, error } = await supabaseAdmin.from("brands").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getCatalogForBrand(brandId: string): Promise<{
  categories: Category[];
  products: Product[];
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

  return { categories: categories ?? [], products: products ?? [] };
}
