import { supabaseAdmin } from "@/lib/supabase/server";
import type { WebsiteProduct } from "./types";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// The website is where a product's picture and selling price are managed, but the POS keeps its
// own copy (products.image_url / products.price) that was only filled in when the product was
// first linked -- so a picture or price changed on the website later differed in the POS. This
// copies both onto each linked POS product (a size's own picture/price for a size of a variable
// product, else the product's own). A website picture that's missing, or a price that's 0 or
// blank, is skipped so it never wipes what the POS has.
// `siteProducts` must come from listWebsiteProducts (its media URLs are already absolute).
// Returns how many POS products were updated.
export async function syncWebsiteToPos(brandSlug: string, siteProducts: WebsiteProduct[]): Promise<number> {
  const siteByKey = new Map<string, { image: string | null; price: number | null }>();
  const priceOf = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? round2(n) : null);
  for (const wp of siteProducts) {
    const isVariable = (wp.type === "variable" || wp.type === "variant") && (wp.variations?.length ?? 0) > 0;
    if (isVariable) {
      for (const v of wp.variations!) {
        siteByKey.set(`${wp.id}::${v.id}`, { image: v.image_url || wp.image_url || null, price: priceOf(Number(v.price)) });
      }
    } else {
      siteByKey.set(`${wp.id}::`, { image: wp.image_url || null, price: priceOf(Number(wp.price)) });
    }
  }
  if (siteByKey.size === 0) return 0;

  type Link = { site_product_id: string; variation_id: string | null };
  type Row = {
    id: string;
    image_url: string | null;
    price: number;
    product_site_links: Link[] | Link | null;
  };
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select("id, image_url, price, brands!inner(slug), product_site_links(site_product_id, variation_id)")
      .eq("brands.slug", brandSlug)
      .eq("is_active", true)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }

  const updates: { id: string; patch: { image_url?: string; price?: number } }[] = [];
  for (const p of rows) {
    const links = Array.isArray(p.product_site_links) ? p.product_site_links : p.product_site_links ? [p.product_site_links] : [];
    const link = links[0];
    if (!link) continue;
    const site = siteByKey.get(`${link.site_product_id}::${link.variation_id ?? ""}`);
    if (!site) continue;
    const patch: { image_url?: string; price?: number } = {};
    if (site.image && site.image !== p.image_url) patch.image_url = site.image;
    if (site.price !== null && Math.abs(site.price - Number(p.price)) >= 0.005) patch.price = site.price;
    if (Object.keys(patch).length > 0) updates.push({ id: p.id, patch });
  }

  for (let i = 0; i < updates.length; i += 20) {
    await Promise.all(
      updates.slice(i, i + 20).map(async (u) => {
        const { error } = await supabaseAdmin.from("products").update(u.patch).eq("id", u.id);
        if (error) throw error;
      })
    );
  }
  return updates.length;
}
