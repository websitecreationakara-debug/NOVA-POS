import { supabaseAdmin } from "@/lib/supabase/server";
import type { WebsiteProduct } from "@/lib/websiteProducts/types";

import { POS_ONLY_CATEGORY_ID, POS_ONLY_ENTRY_PREFIX } from "@/lib/posOnlyEntry";

// A business's active, sellable POS-only products as Sales grid entries. Stock is the
// POS stock count, so a product with none left shows as out of stock. Empty (not an
// error) if migration 0083 isn't applied yet.
export async function listPosOnlyAsWebsiteProducts(brandSlug: string): Promise<WebsiteProduct[]> {
  const { data, error } = await supabaseAdmin
    .from("products")
    .select("*, stock_levels(quantity), brands!inner(slug)")
    .eq("brands.slug", brandSlug)
    .eq("pos_only", true)
    .eq("is_active", true)
    .eq("is_ingredient", false)
    // a product whose name hasn't been typed yet isn't offered for sale
    .neq("name", "")
    .order("name");
  if (error) return [];
  type Row = {
    id: string;
    name: string;
    price: number;
    image_url: string | null;
    stock_untracked?: boolean;
    stock_levels: { quantity: number } | { quantity: number }[] | null;
  };
  return ((data ?? []) as unknown as Row[]).map((p, i) => {
    const level = Array.isArray(p.stock_levels) ? p.stock_levels[0] : p.stock_levels;
    return {
      id: `${POS_ONLY_ENTRY_PREFIX}${p.id}`,
      title: p.name,
      description: null,
      price: Number(p.price),
      sale_price: null,
      category_id: POS_ONLY_CATEGORY_ID,
      // null = not counted: never out of stock in Sales
      stock: p.stock_untracked ? null : (level?.quantity ?? 0),
      status: "published",
      image_url: p.image_url,
      badge: null,
      rating: null,
      weight: null,
      pcs: null,
      type: "simple",
      sort_order: i,
      featured: false,
      promotion_id: null,
      video_url: null,
    };
  });
}
