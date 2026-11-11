import { supabaseAdmin } from "@/lib/supabase/server";
import { COUNTED_FULFILLMENT_STATUSES } from "@/lib/orderStatus";
import { ppDay, ppDayEnd, ppDayStart, ppToday } from "@/lib/phnomPenhTime";
import { catalogForBrandSlug } from "@/lib/websiteProducts/catalogs";
import { listWebsiteAddons, listWebsiteProducts } from "@/lib/websiteProducts/client";
import { HISTORY_DAYS, type ReorderProduct } from "@/lib/reorder";
import { daysOfMonth, recalcRow } from "@/lib/dailyLedger";
import { getDailyLedger } from "@/lib/supabase/queries";

export type ReorderData = {
  today: string;
  products: ReorderProduct[];
  // Products of the business with no sales in the look-back window (left off the list).
  withoutSales: number;
};

const DAY_MS = 24 * 3600 * 1000;
// Names are compared ignoring case, spacing and punctuation (the same item is spelled slightly differently in the ledger and in POS).
const norm = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

// Every row of a query, 1000 at a time (the database caps a request); the query needs a stable .order().
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

// The products of the business that are in Stock / POS but not in its Daily Ledger: their sales and stock come from
// orders and stock movements. (A product that is in the ledger is read from the ledger instead -- see getReorderData.)
async function getStockBasedProducts(
  brandId: string,
  brandSlug: string,
  inLedger: { linkedIds: Set<string>; names: Set<string> }
): Promise<{ products: ReorderProduct[]; withoutSales: number }> {
  const today = ppToday();
  const firstDay = addDays(today, -HISTORY_DAYS);
  const days = Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(firstDay, i)); // oldest .. yesterday
  const dayIndex = new Map(days.map((d, i) => [d, i]));

  type ProductRow = {
    id: string;
    sku: string | null;
    name: string;
    unit: string;
    cost_price: number | null;
    created_at: string;
    stock_levels: { quantity: number } | { quantity: number }[] | null;
    product_site_links: { site_product_id: string; variation_id: string }[];
  };
  const [productRows, soldLines, movements, setRes] = await Promise.all([
    readAll<ProductRow>((from, to) =>
      supabaseAdmin
        .from("products")
        .select("id, sku, name, unit, cost_price, created_at, stock_levels(quantity), product_site_links(site_product_id, variation_id)")
        .eq("brand_id", brandId)
        .eq("is_active", true)
        .neq("name", "")
        .order("id")
        .range(from, to)
    ),
    readAll<{ product_id: string; quantity: number; products: { stock_units_per_sale: number } | null; orders: { list_at: string | null } | null }>((from, to) =>
      supabaseAdmin
        .from("order_items")
        .select("product_id, quantity, products!inner(brand_id, stock_units_per_sale), orders!inner(status, list_at, fulfillment_status)")
        .eq("products.brand_id", brandId)
        .eq("orders.status", "paid")
        .in("orders.fulfillment_status", COUNTED_FULFILLMENT_STATUSES)
        .gte("orders.list_at", ppDayStart(firstDay))
        .lte("orders.list_at", ppDayEnd(addDays(today, -1)))
        .order("id")
        .range(from, to)
    ),
    readAll<{ product_id: string; delta: number; created_at: string }>((from, to) =>
      supabaseAdmin
        .from("stock_movements")
        .select("product_id, delta, created_at, products!inner(brand_id)")
        .eq("products.brand_id", brandId)
        .gte("created_at", ppDayStart(firstDay))
        .order("id")
        .range(from, to)
    ),
    supabaseAdmin.from("sets").select("linked_product_id").eq("brand_id", brandId).not("linked_product_id", "is", null),
  ]);

  // A "Set" (a bundle sold as one product) has no stock of its own.
  const setProductIds = new Set<string>((setRes.data ?? []).map((s) => s.linked_product_id as string));
  // Products that are in the ledger (linked to it, or with the same name) are read from the ledger instead.
  const rows = productRows.filter(
    (p) =>
      !setProductIds.has(p.id) &&
      !/\bset\b/i.test(p.name) &&
      !inLedger.linkedIds.has(p.id) &&
      !inLedger.names.has(norm(p.name))
  );

  // Units sold per day, by product.
  const soldBy = new Map<string, number[]>();
  for (const l of soldLines) {
    const i = l.orders?.list_at ? dayIndex.get(ppDay(l.orders.list_at)) : undefined;
    if (i === undefined) continue;
    const arr = soldBy.get(l.product_id) ?? new Array<number>(HISTORY_DAYS).fill(0);
    arr[i] += Number(l.quantity) * (Number(l.products?.stock_units_per_sale) || 1);
    soldBy.set(l.product_id, arr);
  }

  // Stock movements by product and day (today included, to work back from the stock now).
  const moveBy = new Map<string, Map<string, { net: number; up: number }>>();
  for (const m of movements) {
    const byDay = moveBy.get(m.product_id) ?? new Map<string, { net: number; up: number }>();
    const day = ppDay(m.created_at);
    const e = byDay.get(day) ?? { net: 0, up: 0 };
    e.net += Number(m.delta);
    if (Number(m.delta) > 0) e.up += Number(m.delta);
    byDay.set(day, e);
    moveBy.set(m.product_id, byDay);
  }

  // Website items with no stock number are unlimited: their count isn't real, so they get no suggestion.
  const unlimited = await unlimitedSiteKeys(brandSlug);

  // Units per case: the Daily Ledger's Units / case of a ledger product linked to the Stock product.
  const caseSizes = await caseSizesFor(rows.map((r) => r.id));

  const products: ReorderProduct[] = [];
  let withoutSales = 0;
  for (const p of rows) {
    const sold = soldBy.get(p.id);
    if (!sold || sold.every((n) => n === 0)) {
      withoutSales++;
      continue;
    }
    const level = Array.isArray(p.stock_levels) ? p.stock_levels[0] : p.stock_levels;
    const stock = Number(level?.quantity ?? 0);

    // Work back from the stock now to the stock at the start of each day.
    const byDay = moveBy.get(p.id);
    const outOfStock = new Array<boolean>(HISTORY_DAYS).fill(false);
    let endOfDay = stock - (byDay?.get(today)?.net ?? 0); // the stock at the end of yesterday = the start of today
    for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
      const m = byDay?.get(days[i]);
      const opening = endOfDay - (m?.net ?? 0);
      // No stock to sell at the start of the day, and nothing sold that day.
      outOfStock[i] = opening <= 0 && sold[i] === 0;
      endOfDay = opening;
    }

    const isUnlimited = p.product_site_links.some((l) => unlimited.has(`${l.site_product_id}::${l.variation_id || ""}`));
    // Sales that never moved the stock: the count isn't real either.
    const tracked = !isUnlimited && (byDay?.size ?? 0) > 0;
    const createdDays = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${ppDay(p.created_at)}T00:00:00Z`)) / DAY_MS);

    products.push({
      id: p.id,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      stock,
      caseSize: caseSizes.get(p.id) ?? null,
      unitCost: p.cost_price === null ? null : Number(p.cost_price),
      tracked,
      source: "stock",
      historyDays: Math.min(HISTORY_DAYS, Math.max(0, createdDays)),
      daily: sold.map((n) => Math.round(n * 100) / 100),
      outOfStock,
    });
  }
  return { products, withoutSales };
}

// What the reorder page needs for one business: each product that sold in the last HISTORY_DAYS days, with its units
// sold per day, the days it had no stock to sell, its stock now, its cost and its case size.
//
// The Daily Ledger is the source: it is where the stock is kept (its Ending), where every sale is recorded (the POS
// only sees some of them), and where the cost and Units / case are typed. Months are chained, so a month whose
// Begining stock hasn't been typed yet starts from the month before's Ending. Products that aren't in the ledger
// (matched by link or by name) are added from Stock / POS.
async function computeReorderData(brandId: string, brandSlug: string): Promise<ReorderData> {
  const today = ppToday();
  const firstDay = addDays(today, -HISTORY_DAYS);
  const days = Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(firstDay, i)); // oldest .. yesterday
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const months = [...new Set([...days, today].map((d) => d.slice(0, 7)))].sort();

  const ledgerMonths = await Promise.all(months.map((m) => getDailyLedger(brandId, m)));

  type Series = {
    name: string;
    sku: string | null;
    unit: string;
    caseSize: number | null;
    unitCost: number | null;
    stock: number;
    stockLinkId: string | null;
    daily: number[];
    opening: number[];
    seen: boolean[];
  };
  const series = new Map<string, Series>();
  const previousEnding = new Map<string, number>();
  for (let mi = 0; mi < months.length; mi++) {
    const monthDays = daysOfMonth(months[mi]);
    for (const row of ledgerMonths[mi]) {
      // A month without its own typed Begining stock carries on from the month before.
      const carried = previousEnding.get(row.productId);
      if (!row.stockLink && !row.edited.includes("begin") && carried !== undefined) {
        row.begin = carried;
        recalcRow(row);
      }
      const s: Series = series.get(row.productId) ?? {
        name: row.name,
        sku: row.sku,
        unit: row.unit,
        caseSize: null,
        unitCost: null,
        stock: 0,
        stockLinkId: null,
        daily: new Array<number>(HISTORY_DAYS).fill(0),
        opening: new Array<number>(HISTORY_DAYS).fill(0),
        seen: new Array<boolean>(HISTORY_DAYS).fill(false),
      };
      let running = row.begin;
      row.days.forEach((d, i) => {
        const idx = dayIndex.get(monthDays[i]);
        if (idx !== undefined) {
          s.daily[idx] += d.s;
          s.opening[idx] = running;
          s.seen[idx] = true;
        }
        running = d.r ?? running;
      });
      s.name = row.name;
      s.sku = row.sku ?? s.sku;
      s.unit = row.unit || s.unit;
      s.caseSize = row.caseSize ?? s.caseSize;
      s.unitCost = row.totalCost ?? s.unitCost;
      s.stock = row.ending;
      s.stockLinkId = row.stockLink?.id ?? s.stockLinkId;
      series.set(row.productId, s);
      previousEnding.set(row.productId, row.ending);
    }
  }

  const products: ReorderProduct[] = [];
  let withoutSales = 0;
  const linkedIds = new Set<string>();
  const names = new Set<string>();
  for (const [id, s] of series) {
    if (s.stockLinkId) linkedIds.add(s.stockLinkId);
    names.add(norm(s.name));
    if (s.daily.every((n) => n === 0)) {
      withoutSales++;
      continue;
    }
    // The ledger's stock is only a guide to stock-outs when it ever shows stock on the shelf; a product that is bought
    // and sold the same day (stock always 0) has no stock-out days to leave out.
    const stockSeen = s.opening.some((o) => o > 0);
    const outOfStock = s.daily.map((sold, i) => stockSeen && s.seen[i] && s.opening[i] <= 0 && sold === 0);
    const firstActive = s.daily.findIndex((sold, i) => sold > 0 || s.opening[i] > 0);
    products.push({
      id,
      name: s.name,
      sku: s.sku,
      unit: s.unit,
      stock: s.stock,
      caseSize: s.caseSize,
      unitCost: s.unitCost,
      tracked: true,
      source: "ledger",
      historyDays: firstActive <= 0 ? HISTORY_DAYS : HISTORY_DAYS - firstActive,
      daily: s.daily.map((n) => Math.round(n * 100) / 100),
      outOfStock,
    });
  }

  const fromStock = await getStockBasedProducts(brandId, brandSlug, { linkedIds, names });
  products.push(...fromStock.products);
  products.sort((a, b) => a.name.localeCompare(b.name));
  return { today, products, withoutSales: withoutSales + fromStock.withoutSales };
}

// Reading four months of the ledger takes several seconds, so a business's result is kept for two minutes (a reload, or
// another person opening the page, reuses it).
const CACHE_MS = 2 * 60 * 1000;
const cache = new Map<string, { at: number; value: Promise<ReorderData> }>();

export function getReorderData(brandId: string, brandSlug: string): Promise<ReorderData> {
  const hit = cache.get(brandId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = computeReorderData(brandId, brandSlug);
  const entry = { at: Date.now(), value };
  cache.set(brandId, entry);
  // A failed read isn't kept.
  value.catch(() => {
    if (cache.get(brandId) === entry) cache.delete(brandId);
  });
  return value;
}

// "siteProductId::variationId" of the business's website items (and add-ons) that have no stock number.
async function unlimitedSiteKeys(brandSlug: string): Promise<Set<string>> {
  const keys = new Set<string>();
  const catalog = catalogForBrandSlug(brandSlug);
  if (!catalog) return keys;
  const none = (v: number | null | undefined) => v === null || v === undefined;
  try {
    const [products, addons] = await Promise.all([listWebsiteProducts(catalog.id), listWebsiteAddons(catalog.id).catch(() => [])]);
    for (const wp of products) {
      if ((wp.type === "variable" || wp.type === "variant") && (wp.variations?.length ?? 0) > 0) {
        for (const v of wp.variations!) if (none(v.stock)) keys.add(`${wp.id}::${v.id}`);
      } else if (none(wp.stock)) keys.add(`${wp.id}::`);
    }
    for (const a of addons) if (none(a.stock)) keys.add(`${a.id}::`);
  } catch {
    // Storefront unreachable: every product is treated as tracked.
  }
  return keys;
}

// stock product id -> units per case, from the ledger products linked to it (the latest month typed wins).
async function caseSizesFor(stockIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (stockIds.length === 0) return out;
  const linkOf = new Map<string, string>(); // ledger product id -> stock product id
  for (let i = 0; i < stockIds.length; i += 100) {
    const { data, error } = await supabaseAdmin
      .from("daily_ledger_products")
      .select("id, stock_product_id")
      .in("stock_product_id", stockIds.slice(i, i + 100));
    // Before migration 0100 there is no link column: no case sizes.
    if (error) return out;
    for (const r of data ?? []) if (r.stock_product_id) linkOf.set(r.id, r.stock_product_id);
  }
  const ledgerIds = [...linkOf.keys()];
  const seen = new Set<string>();
  for (let i = 0; i < ledgerIds.length; i += 100) {
    const { data, error } = await supabaseAdmin
      .from("daily_ledger_product_entries")
      .select("product_id, month, value")
      .eq("field", "case_size")
      .in("product_id", ledgerIds.slice(i, i + 100))
      .order("month", { ascending: false });
    if (error) return out;
    for (const e of data ?? []) {
      const stockId = linkOf.get(e.product_id);
      const size = Number(e.value);
      if (!stockId || seen.has(`${e.product_id}`) || !(size > 0)) continue;
      seen.add(e.product_id);
      if (!out.has(stockId)) out.set(stockId, size);
    }
  }
  return out;
}
