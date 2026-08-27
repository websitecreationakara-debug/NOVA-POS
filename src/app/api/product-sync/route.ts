import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { ProductSiteLink } from "@/types/database";

const VALID_SITES: ProductSiteLink["site"][] = [
  "bosba-premium-foods",
  "bosba-drink-snack",
  "sora-sake",
];

// Inbound side of Phase 7's product creation sync: a storefront calls this
// right after creating a brand-new simple (non-variable) product, so it
// shows up in POS automatically instead of needing someone to add it and
// link it by hand. Unlike the fuzzy name-matching used for existing
// products, this is unambiguous -- the site is telling us directly "this is
// a new product," so we create + link it immediately.
export async function POST(request: NextRequest) {
  const secret = process.env.STOCK_SYNC_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { site?: string; siteProductId?: string; title?: string; price?: number; stock?: number | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { site, siteProductId, title, price, stock } = body;
  const isValidSite = (s: unknown): s is ProductSiteLink["site"] =>
    typeof s === "string" && VALID_SITES.includes(s as ProductSiteLink["site"]);

  if (
    !isValidSite(site) ||
    typeof siteProductId !== "string" ||
    typeof title !== "string" ||
    !title.trim() ||
    typeof price !== "number" ||
    !Number.isFinite(price)
  ) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Idempotent: if this site product is already linked (e.g. a retried
  // webhook), don't create a second POS product for it.
  const { data: existingLink } = await supabaseAdmin
    .from("product_site_links")
    .select("product_id")
    .eq("site", site)
    .eq("site_product_id", siteProductId)
    .maybeSingle();
  if (existingLink) {
    return NextResponse.json({ ok: true, productId: existingLink.product_id, skipped: true });
  }

  const { data: brand, error: brandError } = await supabaseAdmin
    .from("brands")
    .select("id")
    .eq("slug", site)
    .single();
  if (brandError || !brand) {
    return NextResponse.json({ error: "No matching POS brand for this site" }, { status: 500 });
  }

  const { data: product, error: productError } = await supabaseAdmin
    .from("products")
    .insert({
      brand_id: brand.id,
      category_id: null,
      name: title.trim(),
      sku: null,
      price,
      unit: "pcs",
      image_url: null,
      is_active: true,
    })
    .select("id")
    .single();
  if (productError || !product) {
    return NextResponse.json({ error: productError?.message ?? "Failed to create product" }, { status: 500 });
  }

  const { error: linkError } = await supabaseAdmin.from("product_site_links").insert({
    product_id: product.id,
    site,
    site_product_id: siteProductId,
    matched_name: title.trim(),
    match_confidence: "exact",
  });
  if (linkError) {
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }

  if (typeof stock === "number" && Number.isFinite(stock)) {
    await supabaseAdmin
      .from("stock_levels")
      .update({ quantity: Math.max(0, stock), updated_at: new Date().toISOString() })
      .eq("product_id", product.id);
  }

  return NextResponse.json({ ok: true, productId: product.id });
}
