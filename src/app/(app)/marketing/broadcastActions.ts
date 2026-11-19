"use server";

import { supabaseAdmin } from "@/lib/supabase/server";
import { getBrands, getCatalogForBrand } from "@/lib/supabase/queries";
import { readAllPages } from "@/lib/supabase/readAllPages";
import { COUNTED_FULFILLMENT_STATUSES } from "@/lib/orderStatus";
import { buildBroadcast, configForSlug, type BroadcastSection } from "@/lib/broadcast";
import { requireMarketingAccess } from "./actions";

const WINDOW_DAYS = 90;

// What the Broadcast page lists for one business: its active products that are in stock and priced, in the
// business's tree (lib/broadcast.ts), most-ordered first (orders of the last 90 days that count towards sales).
export async function getBroadcastSectionsAction(brandId: string): Promise<BroadcastSection[]> {
  await requireMarketingAccess();

  const since = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString();
  const [{ products, categories }, brands, lines] = await Promise.all([
    getCatalogForBrand(brandId),
    getBrands(),
    readAllPages<{ product_id: string; order_id: string }>((withCount) =>
      supabaseAdmin
        .from("order_items")
        .select("product_id, order_id, products!inner(brand_id), orders!inner(list_at)", withCount ? { count: "exact" } : undefined)
        .eq("products.brand_id", brandId)
        .eq("orders.status", "paid")
        .in("orders.fulfillment_status", COUNTED_FULFILLMENT_STATUSES)
        .gte("orders.list_at", since)
        .order("id")
    ),
  ]);

  const config = configForSlug(brands.find((b) => b.id === brandId)?.slug ?? "");
  if (!config) throw new Error("Broadcast isn't set up for this business");
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const ordersOf = new Map<string, Set<string>>();
  for (const l of lines) {
    const set = ordersOf.get(l.product_id) ?? new Set<string>();
    set.add(l.order_id);
    ordersOf.set(l.product_id, set);
  }

  return buildBroadcast(
    products
      .filter((p) => !p.is_ingredient)
      .map((p) => ({
        id: p.id,
        name: p.name,
        price: Number(p.price),
        stock: p.stock_quantity,
        orders: ordersOf.get(p.id)?.size ?? 0,
        category: p.category_id ? categoryName.get(p.category_id) : null,
      })),
    config
  );
}
