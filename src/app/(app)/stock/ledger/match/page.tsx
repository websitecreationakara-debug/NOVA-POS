import { supabaseAdmin } from "@/lib/supabase/server";
import { getBrands } from "@/lib/supabase/queries";
import { LEDGER_OWN_PREFIX } from "@/lib/dailyLedger";
import { nameSimilarity } from "@/lib/matchNames";
import MatchProductsClient, { type MatchRow } from "./MatchProductsClient";

// Stock > Daily Ledger > Match products: the Daily Ledger's products that aren't linked to a Stock product
// yet, each with the Stock products it looks like (by name or SKU) to pick from. Linking only records that
// the two are the same product -- nothing is renamed or merged (see linkLedgerProductsAction).
const MIN_SCORE = 0.45;
const MAX_CANDIDATES = 3;

export default async function MatchProductsPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const { brand: brandParam } = await searchParams;
  const brands = await getBrands();
  if (brands.length === 0) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Match products</h1>
        <p className="mt-2 text-zinc-500">No brands configured yet.</p>
      </main>
    );
  }
  const currentBrand = brands.find((b) => b.id === brandParam) ?? brands[0];

  // Stock products of every business: one business's ledger can list another's products (beer in the
  // Premium Foods ledger that Stock keeps under SORA SAKE). `business` is set only for another business's.
  const brandName = new Map(brands.map((b) => [b.id, b.name]));
  const stock: { id: string; name: string; sku: string | null; business: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select("id, name, sku, brand_id")
      .eq("is_active", true)
      .neq("name", "")
      .order("name")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    stock.push(
      ...(data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        business: p.brand_id === currentBrand.id ? null : (brandName.get(p.brand_id) ?? "Other business"),
      }))
    );
    if (!data || data.length < 1000) break;
  }

  // Before migration 0100 there is no link column: every product counts as unlinked, and saving says to run it.
  const ledger: { id: string; name: string; category: string | null; stock_product_id: string | null }[] = [];
  let linkColumn = true;
  for (let from = 0; ; from += 1000) {
    const page = supabaseAdmin
      .from("daily_ledger_products")
      .select(linkColumn ? "id, name, category, stock_product_id" : "id, name, category")
      .eq("brand_id", currentBrand.id)
      .order("name")
      .range(from, from + 999);
    const { data, error } = await page;
    if (error && linkColumn && /stock_product_id/.test(error.message)) {
      linkColumn = false;
      from -= 1000;
      continue;
    }
    if (error) break;
    const part = (data ?? []) as unknown as { id: string; name: string; category: string | null; stock_product_id?: string | null }[];
    ledger.push(...part.map((r) => ({ ...r, stock_product_id: r.stock_product_id ?? null })));
    if (part.length < 1000) break;
  }

  // The latest SKU typed in the ledger for each product.
  const skuOf = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("daily_ledger_product_entries")
      .select("product_id, value, month, daily_ledger_products!inner(brand_id)")
      .eq("field", "sku")
      .eq("daily_ledger_products.brand_id", currentBrand.id)
      .order("month", { ascending: false })
      .order("product_id")
      .range(from, from + 999);
    if (error) break;
    for (const e of (data ?? []) as unknown as { product_id: string; value: string }[]) {
      if (e.value.trim() && !skuOf.has(e.product_id)) skuOf.set(e.product_id, e.value.trim());
    }
    if (!data || data.length < 1000) break;
  }

  const stockBySku = new Map(stock.filter((s) => s.sku?.trim()).map((s) => [s.sku!.trim().toLowerCase(), s]));
  const rows: MatchRow[] = ledger
    .filter((l) => !l.stock_product_id)
    .map((l) => {
      const sku = skuOf.get(l.id) ?? "";
      const scored = stock
        .map((s) => ({ id: s.id, name: s.name, sku: s.sku, business: s.business, score: nameSimilarity(l.name, s.name) }))
        .filter((c) => c.score >= MIN_SCORE)
        // Equally alike: the business's own product first.
        .sort((a, b) => b.score - a.score || Number(a.business !== null) - Number(b.business !== null))
        .slice(0, MAX_CANDIDATES);
      // The same SKU is the same product, whatever the names say.
      const bySku = sku ? stockBySku.get(sku.toLowerCase()) : undefined;
      if (bySku) {
        const rest = scored.filter((c) => c.id !== bySku.id);
        scored.splice(
          0,
          scored.length,
          { id: bySku.id, name: bySku.name, sku: bySku.sku, business: bySku.business, score: 1 },
          ...rest.slice(0, MAX_CANDIDATES - 1)
        );
      }
      return { ledgerId: `${LEDGER_OWN_PREFIX}${l.id}`, name: l.name, category: l.category, sku, candidates: scored };
    });

  return (
    <MatchProductsClient
      brands={brands}
      currentBrandId={currentBrand.id}
      rows={rows}
      linkedCount={ledger.length - rows.length}
    />
  );
}
