import { supabaseAdmin } from "@/lib/supabase/server";
import { parseGrams } from "@/lib/weight";
import type { WebsiteProduct } from "./types";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// The website is where a product's name, picture, weight and selling price are managed, but the
// POS keeps its own copy (products.name / image_url / weight_grams / price) that was only filled
// in when the product was first linked -- so anything changed on the website (or in Stock) later
// differed in the POS, and Cost Control, Sales and the Margin Report kept showing the old values.
// This copies them onto each linked POS product (a size's own picture/price/name for a size of a
// variable product, else the product's own). The name is the website title, with "(<size>)" after
// it for a size -- the same naming Sales and Stock use. The weight is read from the listing's
// weight text ("100g", "1kg", "1pc (125g)") when it states grams. A website picture that's
// missing, a name that's blank, a weight with no grams, or a price that's 0 or blank, is skipped
// so it never wipes what the POS has.
// `siteProducts` must come from listWebsiteProducts (its media URLs are already absolute).
// Returns how many POS products were updated.
export async function syncWebsiteToPos(brandSlug: string, siteProducts: WebsiteProduct[]): Promise<number> {
  const siteByKey = new Map<
    string,
    { image: string | null; price: number | null; name: string | null; weightGrams: number | null }
  >();
  const priceOf = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? round2(n) : null);
  for (const wp of siteProducts) {
    const isVariable = (wp.type === "variable" || wp.type === "variant") && (wp.variations?.length ?? 0) > 0;
    if (isVariable) {
      for (const v of wp.variations!) {
        const title = wp.title?.trim() ?? "";
        const size = v.weight?.trim();
        siteByKey.set(`${wp.id}::${v.id}`, {
          image: v.image_url || wp.image_url || null,
          price: priceOf(Number(v.price)),
          name: title ? (size ? `${title} (${size})` : title) : null,
          weightGrams: v.weight ? parseGrams(v.weight) : null,
        });
      }
    } else {
      siteByKey.set(`${wp.id}::`, {
        image: wp.image_url || null,
        price: priceOf(Number(wp.price)),
        name: wp.title?.trim() || null,
        weightGrams: wp.weight ? parseGrams(wp.weight) : null,
      });
    }
  }
  if (siteByKey.size === 0) return 0;

  type Link = { site_product_id: string; variation_id: string | null };
  type Row = {
    id: string;
    name: string;
    image_url: string | null;
    price: number;
    weight_grams: number | null;
    product_site_links: Link[] | Link | null;
  };
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select("id, name, image_url, price, weight_grams, brands!inner(slug), product_site_links(site_product_id, variation_id)")
      .eq("brands.slug", brandSlug)
      .eq("is_active", true)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }

  type Patch = { name?: string; image_url?: string; price?: number; weight_grams?: number };
  const updates: { id: string; patch: Patch }[] = [];
  for (const p of rows) {
    const links = Array.isArray(p.product_site_links) ? p.product_site_links : p.product_site_links ? [p.product_site_links] : [];
    const link = links[0];
    if (!link) continue;
    const site = siteByKey.get(`${link.site_product_id}::${link.variation_id ?? ""}`);
    if (!site) continue;
    const patch: Patch = {};
    if (site.name && site.name !== p.name) patch.name = site.name;
    if (site.weightGrams !== null && site.weightGrams !== Number(p.weight_grams)) patch.weight_grams = site.weightGrams;
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
