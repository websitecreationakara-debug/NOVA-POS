import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/server";
import { catalogForBrandSlug, configuredCatalogs } from "@/lib/websiteProducts/catalogs";
import { getWebsiteProduct, listWebsiteAddons, listWebsiteProducts } from "@/lib/websiteProducts/client";
import { countLowStock } from "@/lib/websiteProducts/stock";
import type { WebsiteCatalogId } from "@/lib/websiteProducts/types";
import { formatInvoiceNumber, invoiceMonthStamp, invoiceMonthStartIso } from "@/lib/invoiceNumber";
import { ppDay, ppDayEnd, ppDayStart } from "@/lib/phnomPenhTime";
import { COUNTED_FULFILLMENT_STATUSES } from "@/lib/orderStatus";
import { ALL_PAYMENT_METHODS, type PaymentMethod } from "@/lib/paymentMethods";
import { aggregateStrictCogs, computeGrossMargin } from "@/lib/cogs";
import { productWeightGrams } from "@/lib/costControl";
import { getEffectiveProductCost } from "@/lib/websiteProducts/purchaseCosts";
import type {
  Brand,
  CashReconciliation,
  Category,
  Expense,
  FulfillmentStatus,
  Order,
  Product,
} from "@/types/database";

export type ProductWithStock = Product & {
  stock_quantity: number;
  low_stock_threshold: number;
  site_link: { site: string; site_product_id: string; variation_id: string } | null;
};

// Sales/Stock fall back to brands[0] as the default brand when no ?brand= is
// given -- Bosba Premium Foods is the primary business, so it goes first
// regardless of alphabetical order (which would otherwise put BOSBA
// Drink&Snack first).
export const DEFAULT_BRAND_SLUG = "bosba-premium-foods";

// Sentinel "brand id" the Accountance page uses for its "All Businesses"
// view -- the queries below drop their brand_id filter entirely when they
// see it, combining all brands' rows instead of scoping to one.
export const ALL_BUSINESSES_ID = "all";

// The database returns at most 1000 rows per request, so a plain select over a
// big table is silently cut short (once there were >1000 orders, whole months
// vanished from the Dashboard). Reads every row, 1000 at a time -- the query
// needs a stable .order() so the pages don't overlap.
type RowPage<T> = {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
};
async function selectAll<T>(query: RowPage<T>): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query.range(from, from + 999);
    if (error) return { data: out, error };
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return { data: out, error: null };
  }
}

// selectAll's faster sibling for the big dashboard scans: requests several 1000-row
// pages at once instead of one after another. Each page gets its own freshly built
// query (range() mutates the builder's URL, so a shared one can't run in parallel).
async function selectAllParallel<T>(
  makeQuery: () => RowPage<T>
): Promise<{ data: T[]; error: { message: string } | null }> {
  const BATCH = 4;
  const out: T[] = [];
  for (let from = 0; ; from += 1000 * BATCH) {
    const pages = await Promise.all(
      Array.from({ length: BATCH }, (_, i) => makeQuery().range(from + i * 1000, from + i * 1000 + 999))
    );
    for (const { data, error } of pages) {
      if (error) return { data: out, error };
      out.push(...(data ?? []));
      if (!data || data.length < 1000) return { data: out, error: null };
    }
  }
}

export async function getBrands(): Promise<Brand[]> {
  const { data, error } = await supabaseAdmin.from("brands").select("*").order("name");
  if (error) throw error;
  const brands = data ?? [];
  return brands.toSorted((a, b) =>
    a.slug === DEFAULT_BRAND_SLUG ? -1 : b.slug === DEFAULT_BRAND_SLUG ? 1 : 0
  );
}

type ProductRow = Product & {
  stock_levels: { quantity: number; low_stock_threshold: number } | null;
  product_site_links: { site: string; site_product_id: string; variation_id: string }[];
};

function mapProductRows(products: ProductRow[]): ProductWithStock[] {
  return products.map((p) => {
    const { stock_levels, product_site_links, ...product } = p;
    return {
      ...product,
      stock_quantity: stock_levels?.quantity ?? 0,
      low_stock_threshold: stock_levels?.low_stock_threshold ?? 0,
      site_link: product_site_links?.[0] ?? null,
    };
  });
}

export async function getCatalogForBrand(brandId: string): Promise<{
  categories: Category[];
  products: ProductWithStock[];
}> {
  const [{ data: categories, error: catError }, { data: products, error: prodError }] =
    await Promise.all([
      supabaseAdmin
        .from("categories")
        .select("*")
        .eq("brand_id", brandId)
        .order("sort_order"),
      // Embed stock_levels via its FK to products instead of a second
      // query with .in(productIds) -- that broke once a brand's catalog
      // grew past a few hundred products (URL length limit on the GET).
      supabaseAdmin
        .from("products")
        .select(
          "*, stock_levels(quantity, low_stock_threshold), product_site_links(site, site_product_id, variation_id)"
        )
        .eq("brand_id", brandId)
        .eq("is_active", true)
        .order("name"),
    ]);

  if (catError) throw catError;
  if (prodError) throw prodError;

  return { categories: categories ?? [], products: mapProductRows((products ?? []) as ProductRow[]) };
}

// Same as getCatalogForBrand, but filters by the brand's slug via an embedded
// join instead of its id -- lets the default-brand page load (no ?brand= in
// the URL, e.g. clicking Sales/Stock in the sidebar) start this fetch
// immediately in parallel with getBrands(), instead of waiting on getBrands()
// first just to resolve which id "the default brand" even is.
export async function getCatalogForBrandSlug(slug: string): Promise<{
  categories: Category[];
  products: ProductWithStock[];
}> {
  const [{ data: categories, error: catError }, { data: products, error: prodError }] =
    await Promise.all([
      supabaseAdmin
        .from("categories")
        .select("*, brands!inner(slug)")
        .eq("brands.slug", slug)
        .order("sort_order"),
      supabaseAdmin
        .from("products")
        .select(
          "*, stock_levels(quantity, low_stock_threshold), product_site_links(site, site_product_id, variation_id), brands!inner(slug)"
        )
        .eq("brands.slug", slug)
        .eq("is_active", true)
        .order("name"),
    ]);

  if (catError) throw catError;
  if (prodError) throw prodError;

  const cleanCategories = (categories ?? []).map(({ brands: _brands, ...c }) => c) as Category[];
  const cleanProducts = ((products ?? []) as (ProductRow & { brands: { slug: string } })[]).map(
    ({ brands: _brands, ...p }) => p as ProductRow
  );

  return { categories: cleanCategories, products: mapProductRows(cleanProducts) };
}

export type DailySalesSummary = {
  cashTotal: number;
  // Every non-cash method combined -- the "expected non-cash" figure cash
  // reconciliation needs. Was bankQrTotal back when bank_qr was the only
  // non-cash method.
  nonCashTotal: number;
  // Per-method totals (cash included), for the Reports view's payment
  // breakdown -- only methods with a nonzero total are included.
  paymentBreakdown: { method: PaymentMethod; total: number }[];
  orderCount: number;
  total: number;
};

export async function getDailySales(
  brandId: string,
  fromDate: string,
  toDate: string
): Promise<{ summary: DailySalesSummary; orders: Order[] }> {
  let query = supabaseAdmin
    .from("orders")
    .select("*")
    .eq("status", "paid")
    .in("fulfillment_status", COUNTED_FULFILLMENT_STATUSES)
    .gte("paid_at", ppDayStart(fromDate))
    .lte("paid_at", ppDayEnd(toDate))
    .order("paid_at", { ascending: false })
    .order("id");
  if (brandId !== ALL_BUSINESSES_ID) query = query.eq("brand_id", brandId);
  const { data, error } = await selectAll(query);

  if (error) throw error;
  const orders = data;
  // A paid order with no payment_method recorded (create_online_order()
  // allows it, and it can be cleared via Edit) still got paid somehow --
  // counted as cash, the POS's own default, rather than left out of every
  // bucket and only ever showing up in the Total revenue card.
  const totalsByMethod = new Map<PaymentMethod, number>();
  for (const o of orders) {
    const method = (o.payment_method ?? "cash") as PaymentMethod;
    totalsByMethod.set(method, (totalsByMethod.get(method) ?? 0) + o.total);
  }
  const cashTotal = totalsByMethod.get("cash") ?? 0;
  const paymentBreakdown = ALL_PAYMENT_METHODS.filter((m) => totalsByMethod.has(m)).map((method) => ({
    method,
    total: totalsByMethod.get(method) ?? 0,
  }));
  // Every paid order's own total -- i.e. what its invoice says. Kept as its
  // own sum (rather than summing the per-method buckets) so it stays
  // correct even if a method is ever missing from ALL_PAYMENT_METHODS.
  const total = orders.reduce((sum, o) => sum + o.total, 0);
  const nonCashTotal = total - cashTotal;

  return {
    summary: { cashTotal, nonCashTotal, paymentBreakdown, orderCount: orders.length, total },
    orders,
  };
}

export async function getReconciliation(
  brandId: string,
  date: string
): Promise<CashReconciliation | null> {
  // Reconciling counted cash only makes sense against one business's own
  // till -- there's no single "counted cash" figure across all 3 combined.
  if (brandId === ALL_BUSINESSES_ID) return null;
  const { data, error } = await supabaseAdmin
    .from("cash_reconciliations")
    .select("*")
    .eq("brand_id", brandId)
    .eq("reconciliation_date", date)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// Dashboard "Top Products" only counts items sold at a unit price above this ($).
export const TOP_PRODUCT_MIN_PRICE = 20;

export type DashboardStats = {
  totalRevenue: number;
  orderCount: number;
  totalProducts: number;
  dailyRevenue: { date: string; total: number }[];
  dailyOrders: { date: string; total: number }[];
  // Same two series, split out per brand -- lets the dashboard charts switch
  // between "all businesses" (the series above) and a single business's own
  // day/month/year earnings.
  byBrand: {
    brandId: string;
    brandName: string;
    dailyRevenue: { date: string; total: number }[];
    dailyOrders: { date: string; total: number }[];
  }[];
  recentOrders: {
    id: string;
    brandName: string;
    status: string;
    total: number;
    paidAt: string | null;
  }[];
  // Best sellers in the selected range: branches ranked by revenue, top 10
  // products ranked by units sold.
  topBranches: { name: string; revenue: number; orders: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
  // Same [fromDate, toDate] scope as totalRevenue/orderCount -- see
  // getCogsSummary, which this reuses the same filtering logic from, for the
  // equivalent numbers scoped to Accountance's own picker instead.
  totalCogs: number;
  hasUnknownCost: boolean;
  grossProfit: number;
  grossMarginPct: number | null;
  wasteCost: number;
  promotionCost: number;
  // Delivery fees charged on the paid orders in the selected range (a part of
  // each order's total, so it's already inside totalRevenue).
  deliveryFees: number;
};

// Total products across the three storefront catalogs (what the Sales/Stock
// screens actually sell), not the POS `products` table, which still holds a
// much larger seeded catalog that no longer matches the websites. Hits 3
// external APIs, so the dashboard streams this in separately rather than
// blocking its first paint on it.
export async function getWebsiteProductTotal(): Promise<number | null> {
  const catalogs = configuredCatalogs();
  if (catalogs.length === 0) return null;
  const results = await Promise.allSettled(catalogs.map((c) => listWebsiteProducts(c.id)));
  const ok = results.filter(
    (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof listWebsiteProducts>>> =>
      r.status === "fulfilled"
  );
  if (ok.length === 0) return null;
  return ok.reduce((sum, r) => sum + r.value.length, 0);
}

// Matches the Stock page: for a brand with a storefront, the site's own
// `stock` field (what staff actually see and edit there) is the number that
// counts, not the internal stock_levels table -- otherwise this stat
// disagrees with what the Stock page itself shows for the same brands. Only
// a brand with no storefront configured falls back to the internal
// per-product threshold.
//
// Hits the storefront APIs, so the dashboard streams it in its own Suspense
// boundaries (card + banner) instead of blocking the stats on it; `cache`
// shares the one lookup between them within a request.
export const getLowStockCount = cache(async (): Promise<number> => {
  const catalogs = configuredCatalogs();

  const [websiteResults, brands] = await Promise.all([
    Promise.allSettled(catalogs.map((c) => listWebsiteProducts(c.id))),
    getBrands(),
  ]);

  // Count per sellable unit (each size of a "variable" product separately),
  // the same way the Stock page's own "Low stock" filter does -- counting only
  // parent products here made this stat disagree with what staff see there.
  const websiteLowStock = websiteResults
    .filter((r) => r.status === "fulfilled")
    .reduce((sum, r) => sum + countLowStock(r.value), 0);

  const linkedSlugs = new Set(catalogs.map((c) => c.brandSlug));
  const unlinkedBrandIds = brands.filter((b) => !linkedSlugs.has(b.slug)).map((b) => b.id);
  if (unlinkedBrandIds.length === 0) return websiteLowStock;

  const { data: stockRows, error } = await supabaseAdmin
    .from("stock_levels")
    .select("quantity, low_stock_threshold, products!inner(is_active, brand_id)")
    .eq("products.is_active", true)
    .in("products.brand_id", unlinkedBrandIds)
    .gt("low_stock_threshold", 0);
  if (error) throw error;

  // Excludes quantity 0 -- most products in this system have never had a
  // real count entered and sit at 0 by default, so counting those as "low"
  // would make this stat mostly reflect untracked inventory instead of
  // products that are actually running out.
  const internalLowStock = (stockRows ?? []).filter(
    (s) => s.quantity > 0 && s.quantity <= s.low_stock_threshold
  ).length;

  return websiteLowStock + internalLowStock;
});

// One paid-order total per business per Phnom Penh day (all history) -- the only
// shape the dashboard's cards, Top Branch list and daily charts need.
type OrderDayRow = {
  brand_id: string;
  brand_name: string;
  day: string;
  revenue: number;
  orders: number;
  delivery_fees: number;
};

// Summed in the database (migration 0053's dashboard_order_days). If that
// function isn't there yet, fall back to reading every order and summing here --
// same numbers, just slower.
async function loadOrderDays(brandId: string): Promise<{ data: OrderDayRow[]; error: { message: string } | null }> {
  const { data, error } = await supabaseAdmin.rpc("dashboard_order_days", {
    p_statuses: COUNTED_FULFILLMENT_STATUSES,
    p_brand_id: brandId === ALL_BUSINESSES_ID ? null : brandId,
  });
  if (!error) {
    return {
      data: ((data ?? []) as OrderDayRow[]).map((r) => ({
        ...r,
        revenue: Number(r.revenue),
        orders: Number(r.orders),
        delivery_fees: Number(r.delivery_fees),
      })),
      error: null,
    };
  }

  const { data: rows, error: scanError } = await selectAllParallel<{
    total: number;
    delivery_fee: number | null;
    paid_at: string | null;
    brand_id: string;
    brands: { name: string } | null;
  }>(() => {
    let q = supabaseAdmin
      .from("orders")
      .select("total, delivery_fee, paid_at, brand_id, brands(name)")
      .eq("status", "paid")
      .in("fulfillment_status", COUNTED_FULFILLMENT_STATUSES);
    if (brandId !== ALL_BUSINESSES_ID) q = q.eq("brand_id", brandId);
    return q.order("id");
  });
  const byKey = new Map<string, OrderDayRow>();
  for (const o of rows) {
    const day = ppDay(o.paid_at);
    if (!day) continue;
    const key = `${o.brand_id}|${day}`;
    const e = byKey.get(key) ?? {
      brand_id: o.brand_id,
      brand_name: o.brands?.name ?? "—",
      day,
      revenue: 0,
      orders: 0,
      delivery_fees: 0,
    };
    e.revenue += o.total;
    e.orders += 1;
    e.delivery_fees += Number(o.delivery_fee ?? 0);
    byKey.set(key, e);
  }
  return { data: Array.from(byKey.values()), error: scanError };
}

export async function getDashboardStats(
  brandId: string,
  fromDate: string,
  toDate: string
): Promise<DashboardStats> {
  let productsQuery = supabaseAdmin
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  if (brandId !== ALL_BUSINESSES_ID) productsQuery = productsQuery.eq("brand_id", brandId);

  let recentOrdersQuery = supabaseAdmin
    .from("orders")
    .select("id, status, total, paid_at, brands(name)")
    .eq("status", "paid")
    .order("paid_at", { ascending: false })
    .limit(5);
  if (brandId !== ALL_BUSINESSES_ID) recentOrdersQuery = recentOrdersQuery.eq("brand_id", brandId);

  // COGS -- joined to paid orders; filtered down to the selected range below
  // with the same inRange() check as the revenue query above, so both mean
  // the same period (and the same business, via orders.brand_id here).
  // Only the selected range is read (same bounds getCogsSummary uses) -- the
  // inRange() check below stays as the exact day-level filter.
  const makeOrderItemsQuery = () => {
    let q = supabaseAdmin
      .from("order_items")
      .select("product_id, quantity, unit_price, cogs, line_total, products(name), orders!inner(status, paid_at, brand_id)")
      .eq("orders.status", "paid")
      .in("orders.fulfillment_status", COUNTED_FULFILLMENT_STATUSES)
      .gte("orders.paid_at", ppDayStart(fromDate))
      .lte("orders.paid_at", ppDayEnd(toDate));
    if (brandId !== ALL_BUSINESSES_ID) q = q.eq("orders.brand_id", brandId);
    return q.order("id");
  };

  // Waste/promotions -- joined to the product they were logged against so
  // this can be scoped to one business the same way getCogsSummary's
  // equivalent query is (see its comment for why cost_impact is required).
  let adjustmentsQuery = supabaseAdmin
    .from("stock_adjustments")
    .select("category, cost_impact, created_at, products!inner(brand_id)")
    .not("cost_impact", "is", null)
    .gte("created_at", ppDayStart(fromDate))
    .lte("created_at", ppDayEnd(toDate));
  if (brandId !== ALL_BUSINESSES_ID) adjustmentsQuery = adjustmentsQuery.eq("products.brand_id", brandId);

  const [
    { data: orderDays, error: ordersError },
    { count: totalProducts, error: prodError },
    { data: recentOrdersData, error: recentError },
    { data: orderItemsData, error: itemsError },
    { data: adjustmentsData, error: adjError },
  ] = await Promise.all([
    loadOrderDays(brandId),
    productsQuery,
    recentOrdersQuery,
    selectAllParallel(makeOrderItemsQuery),
    selectAll(adjustmentsQuery.order("id")),
  ]);

  if (ordersError) throw ordersError;
  if (prodError) throw prodError;
  if (recentError) throw recentError;
  if (itemsError) throw itemsError;
  if (adjError) throw adjError;

  // Scoped to the selected [fromDate, toDate] range (the Dashboard's own
  // Day/Week/Month/Quarter/Year picker, same semantics as Accountance's) --
  // not all-time, so these headline numbers match whatever period is picked
  // instead of only ever growing.
  const inRange = (dateStr: string) => dateStr >= fromDate && dateStr <= toDate;
  const daysInRange = orderDays.filter((d) => inRange(d.day));
  const totalRevenue = daysInRange.reduce((sum, d) => sum + d.revenue, 0);
  const orderCount = daysInRange.reduce((sum, d) => sum + d.orders, 0);
  const deliveryFees = round2(daysInRange.reduce((sum, d) => sum + d.delivery_fees, 0));

  type OrderItemCogsRow = {
    product_id: string;
    quantity: number;
    unit_price: number;
    cogs: number | null;
    line_total: number;
    products: { name: string } | null;
    orders: { status: string; paid_at: string | null } | null;
  };
  const itemsInRange = ((orderItemsData ?? []) as OrderItemCogsRow[]).filter((i) =>
    inRange(ppDay(i.orders?.paid_at))
  );

  // Best sellers in the selected range, both ranked by revenue (units sold
  // shown alongside for products).
  const branchTotals = new Map<string, { name: string; revenue: number; orders: number }>();
  for (const d of daysInRange) {
    const e = branchTotals.get(d.brand_id) ?? { name: d.brand_name, revenue: 0, orders: 0 };
    e.revenue += d.revenue;
    e.orders += d.orders;
    branchTotals.set(d.brand_id, e);
  }
  const topBranches = Array.from(branchTotals.values())
    .map((b) => ({ ...b, revenue: round2(b.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);

  const productTotals = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const i of itemsInRange) {
    // The Top Products list is only for items priced above the cut-off, so cheap
    // add-ons and small items don't crowd out the real earners. (COGS and the
    // other totals still use every line.)
    if (!(i.unit_price > TOP_PRODUCT_MIN_PRICE)) continue;
    const e = productTotals.get(i.product_id) ?? { name: i.products?.name ?? "—", quantity: 0, revenue: 0 };
    e.quantity += i.quantity;
    e.revenue += i.line_total;
    productTotals.set(i.product_id, e);
  }
  const topProducts = Array.from(productTotals.values())
    .map((p) => ({ ...p, revenue: round2(p.revenue) }))
    .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)
    .slice(0, 10);
  const { totalCogs, hasUnknownCost } = await sumCogsWithFallback(itemsInRange);
  // Delivery fees are in each order's total but aren't earnings on the goods
  // sold, so gross profit and margin work from the revenue without them.
  const salesRevenue = round2(totalRevenue - deliveryFees);
  const grossProfit = round2(salesRevenue - totalCogs);
  const grossMarginPct = salesRevenue === 0 ? null : round2((grossProfit / salesRevenue) * 10000) / 100;

  type AdjustmentRow = { category: string; cost_impact: number | null; created_at: string };
  const adjustmentsInRange = ((adjustmentsData ?? []) as AdjustmentRow[]).filter((a) =>
    inRange(ppDay(a.created_at))
  );
  const wasteCost = round2(
    adjustmentsInRange.filter((a) => a.category === "waste").reduce((sum, a) => sum + (a.cost_impact ?? 0), 0)
  );
  const promotionCost = round2(
    adjustmentsInRange.filter((a) => a.category === "promotion").reduce((sum, a) => sum + (a.cost_impact ?? 0), 0)
  );

  // One row per calendar day that had any revenue -- the client buckets this
  // into weeks/months/years and lets staff page back through history, rather
  // than the server only ever computing "this week/month/year".
  const dailyTotals = new Map<string, number>();
  for (const o of orderDays) {
    dailyTotals.set(o.day, (dailyTotals.get(o.day) ?? 0) + o.revenue);
  }
  const dailyRevenue = Array.from(dailyTotals.entries())
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // Same idea, but counting orders instead of summing their totals.
  const dailyOrderCounts = new Map<string, number>();
  for (const o of orderDays) {
    dailyOrderCounts.set(o.day, (dailyOrderCounts.get(o.day) ?? 0) + o.orders);
  }
  const dailyOrders = Array.from(dailyOrderCounts.entries())
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // Same two series again, this time bucketed per brand -- so "how much did
  // this one business earn" can be read off the same charts as the
  // all-businesses total above, instead of only ever showing the combined
  // number.
  const brandRevenue = new Map<string, { name: string; daily: Map<string, number> }>();
  const brandOrderCounts = new Map<string, { name: string; daily: Map<string, number> }>();
  for (const o of orderDays) {
    const name = o.brand_name;

    const revEntry = brandRevenue.get(o.brand_id) ?? { name, daily: new Map<string, number>() };
    revEntry.daily.set(o.day, (revEntry.daily.get(o.day) ?? 0) + o.revenue);
    brandRevenue.set(o.brand_id, revEntry);

    const countEntry = brandOrderCounts.get(o.brand_id) ?? { name, daily: new Map<string, number>() };
    countEntry.daily.set(o.day, (countEntry.daily.get(o.day) ?? 0) + o.orders);
    brandOrderCounts.set(o.brand_id, countEntry);
  }
  const byBrand = Array.from(brandRevenue.keys()).map((brandId) => {
    const rev = brandRevenue.get(brandId)!;
    const counts = brandOrderCounts.get(brandId);
    return {
      brandId,
      brandName: rev.name,
      dailyRevenue: Array.from(rev.daily.entries())
        .map(([date, total]) => ({ date, total }))
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
      dailyOrders: Array.from(counts?.daily.entries() ?? [])
        .map(([date, total]) => ({ date, total }))
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
    };
  });

  type RecentOrderRow = {
    id: string;
    status: string;
    total: number;
    paid_at: string | null;
    brands: { name: string } | null;
  };
  const recentOrders = ((recentOrdersData ?? []) as RecentOrderRow[]).map((o) => ({
    id: o.id,
    brandName: o.brands?.name ?? "—",
    status: o.status,
    total: o.total,
    paidAt: o.paid_at,
  }));

  return {
    totalRevenue,
    orderCount,
    totalProducts: totalProducts ?? 0,
    dailyRevenue,
    dailyOrders,
    byBrand,
    recentOrders,
    topBranches,
    topProducts,
    totalCogs,
    hasUnknownCost,
    grossProfit,
    grossMarginPct,
    wasteCost,
    promotionCost,
    deliveryFees,
  };
}

export type OrderListRow = {
  id: string;
  invoiceNumber: string | null;
  brandId: string;
  brandName: string;
  customerName: string | null;
  customerPhone: string | null;
  total: number;
  fulfillmentStatus: FulfillmentStatus;
  paidAt: string | null;
  deliveryAt: string | null;
};

export type OrdersListParams = {
  status?: FulfillmentStatus;
  brandId?: string;
  q?: string;
  from?: string; // YYYY-MM-DD, Phnom Penh day
  to?: string; // YYYY-MM-DD, Phnom Penh day
  page?: number;
  limit?: number;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// [start, end) of a YYYYMM invoice month as UTC ISO instants (Phnom Penh, UTC+7).
function invoiceMonthRange(stamp: string): { start: string; end: string } {
  const y = Number(stamp.slice(0, 4));
  const m = Number(stamp.slice(4, 6)) - 1;
  const off = 7 * 60 * 60_000;
  return {
    start: new Date(Date.UTC(y, m, 1) - off).toISOString(),
    end: new Date(Date.UTC(y, m + 1, 1) - off).toISOString(),
  };
}

// One page of paid orders (filters + paging applied in the database) plus the
// total number of matches, so the page never loads the whole orders table.
export async function getOrdersList(
  params: OrdersListParams = {}
): Promise<{ rows: OrderListRow[]; total: number }> {
  const { status, brandId, from, to } = params;
  const limit = params.limit ?? 50;
  const offset = ((params.page ?? 1) - 1) * limit;
  const q = params.q?.trim() ?? "";

  // `*` rather than an explicit column list so the page still loads if the
  // 0020 delivery_at migration hasn't been applied yet (o.delivery_at is
  // just undefined until then).
  let query = supabaseAdmin
    .from("orders")
    .select("*, brands(name)", { count: "exact" })
    .eq("status", "paid")
    .order("paid_at", { ascending: false })
    .order("id")
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("fulfillment_status", status);
  if (brandId) query = query.eq("brand_id", brandId);
  if (from && DAY_RE.test(from)) query = query.gte("paid_at", `${from}T00:00:00+07:00`);
  if (to && DAY_RE.test(to)) query = query.lte("paid_at", `${to}T23:59:59.999+07:00`);

  if (q) {
    // A full invoice number (YYYYMM-N) is derived, not stored: resolve it to
    // the N-th paid order of that month.
    const invoice = /^(\d{4})(0[1-9]|1[0-2])-(\d+)$/.exec(q);
    if (invoice) {
      const { start, end } = invoiceMonthRange(invoice[1] + invoice[2]);
      const n = Number(invoice[3]);
      const { data: hit } = await supabaseAdmin
        .from("orders")
        .select("id")
        .eq("status", "paid")
        .gte("paid_at", start)
        .lt("paid_at", end)
        .order("paid_at", { ascending: true })
        .order("id")
        .range(n - 1, n - 1);
      if (!hit?.length) return { rows: [], total: 0 };
      query = query.eq("id", hit[0].id);
    } else {
      // Quoted so a comma/parenthesis in the search isn't parsed as filter syntax.
      const pattern = `"%${q.replace(/[\\"]/g, "\\$&")}%"`;
      query = query.or(`customer_name.ilike.${pattern},customer_phone.ilike.${pattern}`);
    }
  }

  const { data, error, count } = await query;
  if (error) throw error;

  type Row = {
    id: string;
    brand_id: string;
    customer_name: string | null;
    customer_phone: string | null;
    total: number;
    fulfillment_status: FulfillmentStatus;
    paid_at: string | null;
    delivery_at: string | null;
    brands: { name: string } | null;
  };

  const rows: OrderListRow[] = ((data ?? []) as Row[]).map((o) => ({
    id: o.id,
    invoiceNumber: null,
    brandId: o.brand_id,
    brandName: o.brands?.name ?? "—",
    customerName: o.customer_name,
    customerPhone: o.customer_phone,
    total: o.total,
    fulfillmentStatus: o.fulfillment_status,
    paidAt: o.paid_at,
    deliveryAt: o.delivery_at ?? null,
  }));

  // Date-based invoice numbers (YYYYMM-N): an order's number is its position
  // among ALL paid orders of its Phnom Penh month, oldest first. For each month
  // on this page, count the earlier orders (base) and list the orders from the
  // page's oldest to newest, so numbering matches regardless of filters/paging.
  const byMonth = new Map<string, OrderListRow[]>();
  for (const r of rows) {
    if (!r.paidAt) continue;
    const key = invoiceMonthStamp(r.paidAt);
    const group = byMonth.get(key);
    if (group) group.push(r);
    else byMonth.set(key, [r]);
  }
  await Promise.all(
    [...byMonth.entries()].map(async ([stamp, group]) => {
      const times = group.map((r) => r.paidAt!).sort();
      const minPaid = times[0];
      const maxPaid = times[times.length - 1];
      const { start } = invoiceMonthRange(stamp);
      const [{ count: before }, { data: span }] = await Promise.all([
        supabaseAdmin
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("status", "paid")
          .gte("paid_at", start)
          .lt("paid_at", minPaid),
        supabaseAdmin
          .from("orders")
          .select("id")
          .eq("status", "paid")
          .gte("paid_at", minPaid)
          .lte("paid_at", maxPaid)
          .order("paid_at", { ascending: true })
          .order("id"),
      ]);
      const seq = new Map((span ?? []).map((o, i) => [o.id as string, (before ?? 0) + i + 1]));
      for (const r of group) {
        const n = seq.get(r.id);
        if (n) r.invoiceNumber = formatInvoiceNumber(r.paidAt, n);
      }
    })
  );

  return { rows, total: count ?? 0 };
}

// Counts for the Orders summary cards + header badge, over every paid order
// (head-only count queries, no rows transferred).
export async function getOrdersSummary(): Promise<{
  total: number;
  newToday: number;
  preOrders: number;
  inProgress: number;
}> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Phnom_Penh" });
  const paid = () =>
    supabaseAdmin.from("orders").select("id", { count: "exact", head: true }).eq("status", "paid");
  const [total, newToday, preOrders, inProgress] = await Promise.all([
    paid(),
    paid().eq("fulfillment_status", "new_order").gte("paid_at", `${today}T00:00:00+07:00`),
    paid().eq("fulfillment_status", "pre_order"),
    paid().in("fulfillment_status", ["new_order", "processing"]),
  ]);
  return {
    total: total.count ?? 0,
    newToday: newToday.count ?? 0,
    preOrders: preOrders.count ?? 0,
    inProgress: inProgress.count ?? 0,
  };
}

export type InvoiceData = {
  order: Order;
  // Date-based number (YYYYMM-N) computed from paid_at -- see
  // src/lib/invoiceNumber.ts. Falls back to a short order-id tag if the order
  // has no paid_at yet.
  invoiceNumber: string;
  brandName: string;
  brandSlug: string | null;
  brandLogoUrl: string | null;
  customerAddress: string | null;
  items: {
    productId: string;
    name: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    // Custom size sold on the line ("100g"), null for a full-size line.
    sizeLabel: string | null;
    // The product's Khmer name, printed under the English one.
    nameKm: string | null;
    // The unit written in Khmer, printed with the English unit.
    unitKm: string | null;
    // The weight text shown for the product on its website listing and in
    // Stock ("1pc (125g)"), printed after the name. null when the product has
    // none, the name already says it, or the line is a custom size.
    weightLabel: string | null;
  }[];
};

// The weight text the storefront shows per product ("1pc (125g)"), keyed by
// POS product id. Looked up live from the storefront (best-effort -- a hiccup
// just means no label) and kept briefly so a bulk invoice run doesn't ask for
// the same listing again for every order.
const siteWeightCache = new Map<string, { at: number; text: string | null }>();
const SITE_WEIGHT_TTL_MS = 60_000;

async function getSiteWeightLabels(productIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (productIds.length === 0) return out;
  const { data: links } = await supabaseAdmin
    .from("product_site_links")
    .select("product_id, site, site_product_id, variation_id")
    .in("product_id", productIds);
  await Promise.all(
    (links ?? []).map(async (l) => {
      const catalog = catalogForBrandSlug(l.site);
      if (!catalog) return;
      const key = `${l.site}|${l.site_product_id}|${l.variation_id}`;
      let hit = siteWeightCache.get(key);
      if (!hit || Date.now() - hit.at > SITE_WEIGHT_TTL_MS) {
        let text: string | null = null;
        try {
          const wp = await getWebsiteProduct(catalog.id, l.site_product_id);
          const raw = l.variation_id ? wp.variations?.find((v) => v.id === l.variation_id)?.weight : wp.weight;
          text = raw?.trim() || null;
        } catch {
          /* storefront unreachable -- no label */
        }
        hit = { at: Date.now(), text };
        siteWeightCache.set(key, hit);
      }
      if (hit.text) out.set(l.product_id, hit.text);
    })
  );
  return out;
}

export async function getInvoice(orderId: string): Promise<InvoiceData | null> {
  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("*, brands(name, slug, logo_url), customers(address)")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError) throw orderError;
  if (!order) return null;

  const { data: items, error: itemsError } = await supabaseAdmin
    .from("order_items")
    .select("product_id, quantity, unit_price, line_total, size_label, products(name, unit, name_km, unit_km)")
    .eq("order_id", orderId);

  if (itemsError) throw itemsError;

  type ItemRow = {
    product_id: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    size_label: string | null;
    products: { name: string; unit: string; name_km: string | null; unit_km: string | null } | null;
  };
  const { brands, customers, ...orderFields } = order as Order & {
    brands: { name: string; slug: string; logo_url: string | null } | null;
    customers: { address: string | null } | null;
  };

  // Date-based invoice number: its position among that Phnom Penh month's
  // paid orders decides the -N suffix (1st of the month = YYYYMM-1).
  let invoiceNumber = `#${orderFields.id.slice(0, 8)}`;
  if (orderFields.paid_at) {
    const { count } = await supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "paid")
      .gte("paid_at", invoiceMonthStartIso(orderFields.paid_at))
      .lt("paid_at", orderFields.paid_at);
    invoiceNumber = formatInvoiceNumber(orderFields.paid_at, (count ?? 0) + 1)!;
  }

  const weightLabels = await getSiteWeightLabels([...new Set(((items ?? []) as ItemRow[]).map((i) => i.product_id))]);
  const squash = (t: string) => t.toLowerCase().replace(/\s+/g, "");

  return {
    order: orderFields,
    invoiceNumber,
    brandName: brands?.name ?? "—",
    brandSlug: brands?.slug ?? null,
    brandLogoUrl: brands?.logo_url ?? null,
    customerAddress: customers?.address ?? null,
    items: ((items ?? []) as ItemRow[]).map((i) => ({
      productId: i.product_id,
      name: i.products?.name ?? "—",
      unit: i.products?.unit ?? "",
      quantity: i.quantity,
      unitPrice: i.unit_price,
      lineTotal: i.line_total,
      sizeLabel: i.size_label,
      nameKm: i.products?.name_km ?? null,
      unitKm: i.products?.unit_km ?? null,
      weightLabel: (() => {
        const label = weightLabels.get(i.product_id) ?? null;
        if (!label || i.size_label) return null;
        return squash(i.products?.name ?? "").includes(squash(label)) ? null : label;
      })(),
    })),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// A sold line with no recorded cogs (order created before COGS capture
// existed, or before its product had a cost) falls back to that product's
// current effective cost (Stock's Purchase Cost Total, a Set's own Total
// Cost, or plain cost_price -- see getEffectiveProductCost) instead of being
// dropped as "unknown". Only a product with no cost anywhere still leaves
// the summary flagged incomplete. One lookup per distinct product, shared
// across every line that needs it.
async function sumCogsWithFallback(
  items: { product_id: string; quantity: number; cogs: number | null }[]
): Promise<{ totalCogs: number; hasUnknownCost: boolean }> {
  const missingProductIds = [...new Set(items.filter((i) => i.cogs === null).map((i) => i.product_id))];
  const effectiveCostByProduct = new Map<string, number | null>();
  await Promise.all(
    missingProductIds.map(async (id) => {
      effectiveCostByProduct.set(id, await getEffectiveProductCost(id).catch(() => null));
    })
  );

  let totalCogs = 0;
  let hasUnknownCost = false;
  for (const item of items) {
    if (item.cogs !== null) {
      totalCogs += item.cogs;
      continue;
    }
    const effectiveCost = effectiveCostByProduct.get(item.product_id) ?? null;
    if (effectiveCost === null) {
      hasUnknownCost = true;
      continue;
    }
    totalCogs += round2(effectiveCost * item.quantity);
  }
  return { totalCogs: round2(totalCogs), hasUnknownCost };
}

export type CogsSummary = {
  totalCogs: number;
  // True if some sold line in range had no cost price recorded -- totalCogs
  // is a partial sum (known costs only), not the true total, when this is set.
  hasUnknownCost: boolean;
  wasteCost: number;
  promotionCost: number;
};

// Powers both the Dashboard's COGS/Waste/Promotion cards and the Accountance
// COGS tab's summary cards -- one query pair (paid order lines' cogs, plus
// stock_adjustments' cost_impact by category) for the same brand/date range
// every other Accountance tab already filters by.
export async function getCogsSummary(
  brandId: string,
  fromDate: string,
  toDate: string
): Promise<CogsSummary> {
  let itemsQuery = supabaseAdmin
    .from("order_items")
    .select("product_id, quantity, cogs, orders!inner(status, paid_at, brand_id)")
    .eq("orders.status", "paid")
    .in("orders.fulfillment_status", COUNTED_FULFILLMENT_STATUSES)
    .gte("orders.paid_at", ppDayStart(fromDate))
    .lte("orders.paid_at", ppDayEnd(toDate));
  if (brandId !== ALL_BUSINESSES_ID) itemsQuery = itemsQuery.eq("orders.brand_id", brandId);

  let adjustmentsQuery = supabaseAdmin
    .from("stock_adjustments")
    .select("category, cost_impact, delta, created_at, products!inner(brand_id, price)")
    .gte("created_at", ppDayStart(fromDate))
    .lte("created_at", ppDayEnd(toDate));
  if (brandId !== ALL_BUSINESSES_ID) adjustmentsQuery = adjustmentsQuery.eq("products.brand_id", brandId);

  const [{ data: items, error: itemsError }, { data: adjustments, error: adjError }] = await Promise.all([
    selectAll(itemsQuery.order("id")),
    selectAll(adjustmentsQuery.order("id")),
  ]);
  if (itemsError) throw itemsError;
  if (adjError) throw adjError;

  const { totalCogs, hasUnknownCost } = await sumCogsWithFallback(items ?? []);

  type AdjustmentRow = {
    category: string;
    cost_impact: number | null;
    delta: number;
    products: { brand_id: string; price: number } | null;
  };

  let wasteCost = 0;
  let promotionCost = 0;
  // Same current-price fallback as getWasteLog's display -- an adjustment
  // logged before a cost price ever existed otherwise sits at $0 forever,
  // even though the log right below this card shows a real dollar figure
  // for it.
  for (const a of (adjustments ?? []) as AdjustmentRow[]) {
    const impact =
      a.cost_impact ?? (a.delta < 0 && a.products ? round2(a.products.price * Math.abs(a.delta)) : 0);
    if (a.category === "waste") wasteCost += impact;
    else if (a.category === "promotion") promotionCost += impact;
  }

  return { totalCogs, hasUnknownCost, wasteCost: round2(wasteCost), promotionCost: round2(promotionCost) };
}

export type WasteLogEntry = {
  id: string;
  productName: string;
  // Units wasted, always positive for display -- stock_adjustments stores it
  // as a negative delta.
  quantity: number;
  reason: string;
  // The per-unit cost snapshotted at the time (derived from costImpact /
  // quantity -- stock_adjustments only stores the total, not the unit price
  // it was computed from). null exactly when costImpact is null.
  unitCost: number | null;
  // quantity * unitCost. null when the product had no cost price recorded at
  // the time -- matches wasteCost above counting it as $0, not "unknown".
  costImpact: number | null;
  createdAt: string;
};

// Backs the Waste stat card's expandable list -- every logged waste entry
// (not just the ones with a cost_impact, unlike wasteCost's sum above) so
// staff can see what actually left the shelf even before its cost price was
// set.
export async function getWasteLog(
  brandId: string,
  fromDate: string,
  toDate: string
): Promise<WasteLogEntry[]> {
  let query = supabaseAdmin
    .from("stock_adjustments")
    .select("id, delta, reason, cost_impact, created_at, products!inner(name, brand_id, price)")
    .eq("category", "waste")
    .gte("created_at", ppDayStart(fromDate))
    .lte("created_at", ppDayEnd(toDate))
    .order("created_at", { ascending: false });
  if (brandId !== ALL_BUSINESSES_ID) query = query.eq("products.brand_id", brandId);

  const { data, error } = await query;
  if (error) throw error;

  type Row = {
    id: string;
    delta: number;
    reason: string | null;
    cost_impact: number | null;
    created_at: string;
    products: { name: string; brand_id: string; price: number } | null;
  };

  return ((data ?? []) as Row[]).map((r) => {
    const quantity = Math.abs(r.delta);
    // Entries logged before a cost price ever existed snapshotted null --
    // show the product's current selling price for those instead of a bare
    // "—", same fallback adjustStockAction now uses for new entries. Only
    // the display falls back like this; a later real cost price still wins
    // for the Waste $ total (getCogsSummary), which reads the stored
    // cost_impact directly.
    const unitCost =
      r.cost_impact !== null && quantity !== 0 ? round2(r.cost_impact / quantity) : (r.products?.price ?? null);
    const costImpact = r.cost_impact ?? (unitCost === null ? null : round2(unitCost * quantity));
    return {
      id: r.id,
      productName: r.products?.name ?? "—",
      quantity,
      reason: r.reason ?? "Waste",
      unitCost,
      costImpact,
      createdAt: r.created_at,
    };
  });
}

// A single sellable unit (a plain POS product, one size/flavor of a website
// product, or a storefront add-on) that a Stock-wide product picker can
// offer -- used by Accountance's "Add waste item" (logs waste against it)
// and Cost Control's Set item search (adds it as a set_items row).
// `website` is set whenever the item comes from (or is matched to) one of
// the 3 storefront catalogs' own product list -- acting on one patches that
// site's own stock too, same two-way sync the Stock page's price/stock
// edits already do (see setSimpleProductStockAction/setVariationStockAction).
// `addon` is set for a catalog's separate add-on table instead -- linking one
// only ever creates the POS-side record (see ensurePosProductForSiteProduct);
// nothing writes back to the storefront's add-on endpoint through this path,
// so callers that DO push stock back out to a site (Waste logging) should
// leave addon entries out of their list rather than picking them. `pos` is
// set whenever a POS product already exists for it (plain products always
// have one; a website item/add-on only once someone has edited/sold it, or
// added it to a Set, before) -- absent, picking it creates that link on the
// fly.
export type StockPickerItem = {
  key: string;
  name: string;
  unit: string;
  // For display only -- null means the website item is still unlimited
  // stock and has never been tracked as a real count.
  displayStock: number | null;
  costPrice: number | null;
  // The pack's weight in grams when it can be read reliably (the product's own
  // Stock weight, a weight-only unit, a weight in the name, or a plain weight
  // label like "150g") -- Cost Control prefills a new line's Amount with it.
  weightGrams: number | null;
  pos: { productId: string; currentStock: number } | null;
  website: {
    catalogId: WebsiteCatalogId;
    siteProductId: string;
    variationId: string | null;
    siteStock: number | null;
    price: number;
    imageUrl: string | null;
  } | null;
  addon: {
    catalogId: WebsiteCatalogId;
    addonId: string;
    stock: number | null;
    price: number;
    imageUrl: string | null;
  } | null;
};

// Combines the brand's POS product list with its live storefront catalog (if
// it has one) into one flat pickable list -- see StockPickerItem's comment
// for why each entry carries what it does. Falls back to POS-only products
// if the storefront is unreachable, same as the rest of this app's "never
// let a website fetch failure block Stock/Sales" convention.
// `includeAddons` is opt-in (default false) -- see StockPickerItem's comment
// on why a caller that pushes stock back out to the storefront must not
// enable it.
export async function getStockPickerItems(
  brandId: string,
  brandSlug: string,
  options?: { includeAddons?: boolean }
): Promise<StockPickerItem[]> {
  const [{ products: posProducts }, catalog] = await Promise.all([
    getCatalogForBrand(brandId),
    Promise.resolve(catalogForBrandSlug(brandSlug)),
  ]);

  const items: StockPickerItem[] = [];
  const usedPosKeys = new Set<string>();

  if (catalog) {
    try {
      const siteProducts = await listWebsiteProducts(catalog.id);
      for (const wp of siteProducts) {
        const isVariable =
          (wp.type === "variable" || wp.type === "variant") && (wp.variations?.length ?? 0) > 0;
        const entries = isVariable
          ? wp.variations!.map((v) => ({
              variationId: v.id as string | null,
              stock: v.stock,
              price: v.price,
              imageUrl: v.image_url ?? wp.image_url,
              label: [wp.title, v.weight || v.flavor].filter(Boolean).join(" "),
              weightText: v.weight ?? null,
            }))
          : [
              {
                variationId: null as string | null,
                stock: wp.stock,
                price: wp.price,
                imageUrl: wp.image_url,
                label: wp.title,
                weightText: wp.weight ?? null,
              },
            ];
        for (const e of entries) {
          const posKey = `${wp.id}::${e.variationId ?? ""}`;
          const linked =
            posProducts.find(
              (p) =>
                p.site_link &&
                p.site_link.site_product_id === wp.id &&
                (p.site_link.variation_id || "") === (e.variationId ?? "")
            ) ?? null;
          if (linked) usedPosKeys.add(posKey);
          items.push({
            key: `site:${posKey}`,
            name: e.label,
            unit: "pcs",
            displayStock: linked ? linked.stock_quantity : e.stock,
            costPrice: linked?.cost_price ?? null,
            weightGrams: productWeightGrams(
              linked?.unit ?? "pcs",
              linked?.name ?? e.label,
              linked?.weight_grams,
              e.weightText
            ),
            pos: linked ? { productId: linked.id, currentStock: linked.stock_quantity } : null,
            website: {
              catalogId: catalog.id,
              siteProductId: wp.id,
              variationId: e.variationId,
              siteStock: e.stock,
              price: e.price,
              imageUrl: e.imageUrl,
            },
            addon: null,
          });
        }
      }
    } catch {
      // Storefront unreachable -- fall through to POS-only products below.
    }

    if (options?.includeAddons) {
      try {
        const addons = await listWebsiteAddons(catalog.id);
        for (const a of addons) {
          const addonKey = `${a.id}::`;
          const linked =
            posProducts.find(
              (p) => p.site_link && p.site_link.site_product_id === a.id && (p.site_link.variation_id || "") === ""
            ) ?? null;
          if (linked) usedPosKeys.add(addonKey);
          items.push({
            key: `addon:${a.id}`,
            name: a.title,
            unit: "pcs",
            displayStock: linked ? linked.stock_quantity : a.stock,
            costPrice: linked?.cost_price ?? null,
            weightGrams: productWeightGrams(linked?.unit ?? "pcs", linked?.name ?? a.title, linked?.weight_grams),
            pos: linked ? { productId: linked.id, currentStock: linked.stock_quantity } : null,
            website: null,
            addon: { catalogId: catalog.id, addonId: a.id, stock: a.stock, price: a.price, imageUrl: a.image_url },
          });
        }
      } catch {
        // Storefront unreachable -- fall through to POS-only products below.
      }
    }
  }

  for (const p of posProducts) {
    const key = p.site_link ? `${p.site_link.site_product_id}::${p.site_link.variation_id || ""}` : null;
    if (key && usedPosKeys.has(key)) continue; // already represented above, with its website link
    items.push({
      key: `pos:${p.id}`,
      name: p.name,
      unit: p.unit,
      displayStock: p.stock_quantity,
      costPrice: p.cost_price,
      weightGrams: productWeightGrams(p.unit, p.name, p.weight_grams),
      pos: { productId: p.id, currentStock: p.stock_quantity },
      website: null,
      addon: null,
    });
  }

  return items;
}

export type MarginReportRow = {
  productId: string;
  name: string;
  categoryName: string | null;
  unitsSold: number;
  revenue: number;
  // null (not 0/undefined) whenever any sold line in range had no cost
  // price -- see hasUnknownCost. Never a silently-wrong number.
  unitCost: number | null;
  // Prefill for the "Add cost price" input when unitCost is null -- the
  // product's current effective cost (Stock's Purchase Cost Total when
  // linked to a website listing, else its own cost_price). Same source
  // Cost Control's Sets use, so filling this in matches Stock instead of
  // requiring the number be looked up and retyped by hand.
  suggestedCost: number | null;
  // The product's current stored price, not an average of what it actually
  // sold for over the range -- editing this here updates that same stored
  // value, so it stays put until changed again.
  sellingPrice: number;
  totalCogs: number | null;
  grossProfit: number | null;
  grossMarginPct: number | null;
  hasUnknownCost: boolean;
};

// Per-product breakdown behind the COGS tab's Margin Report table (req #9) --
// same brand/date-range scoping as getCogsSummary, grouped by product.
export async function getMarginReport(
  brandId: string,
  fromDate: string,
  toDate: string
): Promise<MarginReportRow[]> {
  let query = supabaseAdmin
    .from("order_items")
    .select("product_id, quantity, line_total, cogs, orders!inner(status, paid_at, brand_id)")
    .eq("orders.status", "paid")
    .in("orders.fulfillment_status", COUNTED_FULFILLMENT_STATUSES)
    .gte("orders.paid_at", ppDayStart(fromDate))
    .lte("orders.paid_at", ppDayEnd(toDate));
  if (brandId !== ALL_BUSINESSES_ID) query = query.eq("orders.brand_id", brandId);

  const { data: items, error } = await selectAll(query.order("id"));
  if (error) throw error;
  if (items.length === 0) return [];

  const productIds = [...new Set(items.map((i) => i.product_id))];
  // In chunks: hundreds of ids in one .in() make the request URL too long.
  const productById = new Map<string, { id: string; name: string; price: number; categories: { name: string } | null }>();
  for (let i = 0; i < productIds.length; i += 150) {
    const { data: products, error: prodError } = await supabaseAdmin
      .from("products")
      .select("id, name, price, categories(name)")
      .in("id", productIds.slice(i, i + 150));
    if (prodError) throw prodError;
    for (const p of (products ?? []) as unknown as { id: string; name: string; price: number; categories: { name: string } | null }[]) productById.set(p.id, p);
  }

  const byProduct = new Map<string, { unitsSold: number; revenue: number; cogsValues: (number | null)[] }>();
  for (const item of items) {
    const entry = byProduct.get(item.product_id) ?? { unitsSold: 0, revenue: 0, cogsValues: [] };
    entry.unitsSold += item.quantity;
    entry.revenue += item.line_total;
    entry.cogsValues.push(item.cogs);
    byProduct.set(item.product_id, entry);
  }

  const rows = Array.from(byProduct.entries()).map(([productId, agg]) => {
    const product = productById.get(productId);
    const { totalCogs, hasUnknownCost } = aggregateStrictCogs(agg.cogsValues);
    const { grossProfit, grossMarginPct } = computeGrossMargin(agg.revenue, totalCogs);
    return {
      productId,
      name: product?.name ?? "—",
      categoryName: (product?.categories as { name: string } | null)?.name ?? null,
      unitsSold: round2(agg.unitsSold),
      revenue: round2(agg.revenue),
      unitCost: totalCogs === null ? null : round2(totalCogs / agg.unitsSold),
      suggestedCost: null as number | null,
      sellingPrice: product?.price ?? round2(agg.revenue / agg.unitsSold),
      totalCogs,
      grossProfit,
      grossMarginPct,
      hasUnknownCost,
    };
  });

  // Unit Cost is the cost recorded when each sale was made -- the product's
  // Stock Total at that moment (see effective_product_cost, used by charge_order
  // and the website order import). Changing the Total in Stock later never
  // rewrites a past sale; only sales made after the change pick up the new
  // Total. Only a row with no recorded cost at all (sold before costs were
  // tracked) falls back to the product's current Stock cost, as a suggestion.
  await Promise.all(
    rows
      .filter((r) => r.unitCost === null)
      .map(async (r) => {
        r.suggestedCost = await getEffectiveProductCost(r.productId).catch(() => null);
      })
  );

  return rows.sort((a, b) => b.revenue - a.revenue);
}

export async function getExpensesForDateRange(
  brandId: string,
  fromDate: string,
  toDate: string
): Promise<Expense[]> {
  let query = supabaseAdmin
    .from("expenses")
    .select("*")
    .gte("expense_date", fromDate)
    .lte("expense_date", toDate)
    .order("created_at", { ascending: false });
  if (brandId !== ALL_BUSINESSES_ID) query = query.eq("brand_id", brandId);
  const { data, error } = await query;

  if (error) throw error;
  return data ?? [];
}
