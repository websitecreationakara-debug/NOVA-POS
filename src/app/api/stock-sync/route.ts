import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { ProductSiteLink } from "@/types/database";

const VALID_SITES: ProductSiteLink["site"][] = [
  "bosba-premium-foods",
  "bosba-drink-snack",
  "sora-sake",
];

// Inbound side of Phase 7's stock sync: a storefront calls this either after
// an online order decrements its own D1 stock (quantitySold, relative), or
// after an admin manually edits a product's stock/price on the site (stock,
// absolute; and/or price) -- quantitySold and stock are mutually exclusive,
// but price can accompany either. An optional variationId targets one size of
// a "variable" product's linked POS product instead of the simple-product
// link (empty variation_id). See src/lib/site-sync.ts for the other direction
// (POS -> site) and migration 0018 for the variation_id column.
export async function POST(request: NextRequest) {
  const secret = process.env.STOCK_SYNC_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    site?: string;
    siteProductId?: string;
    variationId?: string;
    quantitySold?: number;
    stock?: number;
    price?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { site, siteProductId, variationId, quantitySold, stock, price } = body;
  const isValidSite = (s: unknown): s is ProductSiteLink["site"] =>
    typeof s === "string" && VALID_SITES.includes(s as ProductSiteLink["site"]);

  const hasQuantitySold =
    typeof quantitySold === "number" && Number.isFinite(quantitySold) && quantitySold > 0;
  const hasStock = typeof stock === "number" && Number.isFinite(stock) && stock >= 0;
  const hasPrice = typeof price === "number" && Number.isFinite(price) && price >= 0;

  if (
    !isValidSite(site) ||
    typeof siteProductId !== "string" ||
    (hasQuantitySold && hasStock) ||
    (!hasQuantitySold && !hasStock && !hasPrice)
  ) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Empty string for the simple-product link; a real id targets one size of
  // a "variable" product's own linked POS product (see migration 0018).
  const variationIdValue = typeof variationId === "string" && variationId ? variationId : "";

  const { data: link, error: linkError } = await supabaseAdmin
    .from("product_site_links")
    .select("product_id")
    .eq("site", site)
    .eq("site_product_id", siteProductId)
    .eq("variation_id", variationIdValue)
    .maybeSingle();
  if (linkError) {
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }
  if (!link) {
    // No mapping for this product/size -- nothing to sync, not an error.
    return NextResponse.json({ ok: true, skipped: true });
  }

  if (hasPrice) {
    const { error: priceError } = await supabaseAdmin
      .from("products")
      .update({ price })
      .eq("id", link.product_id);
    if (priceError) {
      return NextResponse.json({ error: priceError.message }, { status: 500 });
    }
  }

  if (hasStock) {
    const { error: updateError } = await supabaseAdmin
      .from("stock_levels")
      .update({ quantity: stock, updated_at: new Date().toISOString() })
      .eq("product_id", link.product_id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, quantity: stock, price: hasPrice ? price : undefined });
  }

  if (hasQuantitySold) {
    const { data: newQuantity, error: rpcError } = await supabaseAdmin.rpc("adjust_stock", {
      p_product_id: link.product_id,
      p_delta: -quantitySold,
      p_reason: `Online sale (${site})`,
      p_created_by: null,
    });
    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, quantity: newQuantity, price: hasPrice ? price : undefined });
  }

  // price-only update.
  return NextResponse.json({ ok: true, price });
}
