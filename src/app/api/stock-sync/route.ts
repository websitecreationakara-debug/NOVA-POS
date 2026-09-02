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
// after an admin manually edits a product's stock on the site (stock,
// absolute) -- exactly one of the two must be given. See src/lib/site-sync.ts
// for the other direction (POS -> site).
export async function POST(request: NextRequest) {
  const secret = process.env.STOCK_SYNC_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { site?: string; siteProductId?: string; quantitySold?: number; stock?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { site, siteProductId, quantitySold, stock } = body;
  const isValidSite = (s: unknown): s is ProductSiteLink["site"] =>
    typeof s === "string" && VALID_SITES.includes(s as ProductSiteLink["site"]);

  const hasQuantitySold = typeof quantitySold === "number" && Number.isFinite(quantitySold) && quantitySold > 0;
  const hasStock = typeof stock === "number" && Number.isFinite(stock) && stock >= 0;

  if (!isValidSite(site) || typeof siteProductId !== "string" || hasQuantitySold === hasStock) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { data: link, error: linkError } = await supabaseAdmin
    .from("product_site_links")
    .select("product_id")
    .eq("site", site)
    .eq("site_product_id", siteProductId)
    .maybeSingle();
  if (linkError) {
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }
  if (!link) {
    // No mapping for this product -- nothing to sync, not an error.
    return NextResponse.json({ ok: true, skipped: true });
  }

  if (hasStock) {
    const { error: updateError } = await supabaseAdmin
      .from("stock_levels")
      .update({ quantity: stock, updated_at: new Date().toISOString() })
      .eq("product_id", link.product_id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, quantity: stock });
  }

  const { data: newQuantity, error: rpcError } = await supabaseAdmin.rpc("adjust_stock", {
    p_product_id: link.product_id,
    p_delta: -(quantitySold as number),
    p_reason: `Online sale (${site})`,
    p_created_by: null,
  });
  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, quantity: newQuantity });
}
