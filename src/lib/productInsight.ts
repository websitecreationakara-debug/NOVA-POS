// Numbers behind Marketing > Product Insight: what sold, how much, and what is
// bought together, for a period and (optionally) one business. Pure functions
// over the sold lines so they can be tested without a database.
//
// Only lines of orders that count towards money are fed in (paid, and
// Processing / Delivered / Complete -- the same rule as revenue), dated by the
// day the Orders list files them under. Sales = the lines' item prices, i.e.
// before any order-level discount or delivery fee.

export type InsightRange = "today" | "7d" | "30d" | "month" | "year" | "all";

export const INSIGHT_RANGE_LABELS: Record<InsightRange, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  month: "This month",
  year: "This year",
  all: "All time",
};

export function parseInsightRange(v: string | undefined): InsightRange {
  return v && v in INSIGHT_RANGE_LABELS ? (v as InsightRange) : "30d";
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The first and last day (YYYY-MM-DD, inclusive) of a range ending `today`;
// `from` is null for "all time".
export function insightBounds(range: InsightRange, today: string): { from: string | null; to: string } {
  switch (range) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "year":
      return { from: `${today.slice(0, 5)}01-01`, to: today };
    case "all":
      return { from: null, to: today };
  }
}

export type InsightLine = {
  orderId: string;
  productId: string;
  name: string;
  brandId: string;
  category: string | null;
  quantity: number;
  total: number;
  // The product's scale (Khmer unit if it has one, else its unit), e.g. "kg".
  unit?: string;
  // The day it counts on (YYYY-MM-DD, Phnom Penh).
  day: string;
};

export type NamedAmount = { name: string; revenue: number; units: number };

export type ProductInsight = {
  revenue: number;
  units: number;
  orders: number;
  products: number;
  topByRevenue: NamedAmount[];
  topByUnits: NamedAmount[];
  byCategory: { name: string; value: number }[];
  byBrand: { name: string; value: number }[];
  // Revenue and units per day (or per month for a long period), oldest first.
  trend: { key: string; revenue: number; units: number }[];
  trendBy: "day" | "month";
  pairs: { a: string; b: string; count: number }[];
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const UNCATEGORIZED = "Uncategorized";

// Daily points for a period up to ~2 months, monthly beyond that, with 0 for the
// days / months nothing sold. `byDay` holds the days that had sales.
export function fillTrend(
  byDay: Map<string, { revenue: number; units: number }>,
  start: string,
  to: string
): { trend: ProductInsight["trend"]; trendBy: "day" | "month" } {
  const spanDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 864e5) + 1;
  const trendBy: "day" | "month" = spanDays <= 62 ? "day" : "month";
  const trend: ProductInsight["trend"] = [];
  if (trendBy === "day") {
    for (let day = start; day <= to; day = addDays(day, 1)) {
      const d = byDay.get(day);
      trend.push({ key: day, revenue: round2(d?.revenue ?? 0), units: round2(d?.units ?? 0) });
    }
  } else {
    const byMonth = new Map<string, { revenue: number; units: number }>();
    for (const [day, v] of byDay) {
      const m = day.slice(0, 7);
      const e = byMonth.get(m) ?? { revenue: 0, units: 0 };
      e.revenue += v.revenue;
      e.units += v.units;
      byMonth.set(m, e);
    }
    let [y, m] = start.slice(0, 7).split("-").map(Number);
    const [ey, em] = to.slice(0, 7).split("-").map(Number);
    while (y < ey || (y === ey && m <= em)) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const v = byMonth.get(key);
      trend.push({ key, revenue: round2(v?.revenue ?? 0), units: round2(v?.units ?? 0) });
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }
  return { trend, trendBy };
}

// What the database's product_insight() hands back (migration 0070): the same
// figures as buildProductInsight(), already added up -- only the zero-filled
// trend still has to be drawn out here.
export type InsightSummary = {
  revenue: number;
  units: number;
  orders: number;
  products: number;
  first_day: string | null;
  top_revenue: NamedAmount[];
  top_units: NamedAmount[];
  by_category: { name: string; value: number }[];
  by_brand: { name: string; value: number }[];
  days: { day: string; revenue: number; units: number }[];
  pairs: { a: string; b: string; count: number }[];
};

export function insightFromSummary(raw: InsightSummary, bounds: { from: string | null; to: string }): ProductInsight {
  const byDay = new Map(raw.days.map((d) => [d.day, { revenue: Number(d.revenue), units: Number(d.units) }]));
  const { trend, trendBy } = fillTrend(byDay, bounds.from ?? raw.first_day ?? bounds.to, bounds.to);
  const named = (list: NamedAmount[]) =>
    list.map((p) => ({ name: p.name, revenue: Number(p.revenue), units: Number(p.units) }));
  return {
    revenue: Number(raw.revenue),
    units: Number(raw.units),
    orders: Number(raw.orders),
    products: Number(raw.products),
    topByRevenue: named(raw.top_revenue),
    topByUnits: named(raw.top_units),
    byCategory: raw.by_category.map((c) => ({ name: c.name, value: Number(c.value) })),
    byBrand: raw.by_brand.map((c) => ({ name: c.name, value: Number(c.value) })),
    trend,
    trendBy,
    pairs: raw.pairs.map((p) => ({ a: p.a, b: p.b, count: Number(p.count) })),
  };
}

export function buildProductInsight(
  lines: InsightLine[],
  bounds: { from: string | null; to: string },
  brandNames: Map<string, string>
): ProductInsight {
  const byProduct = new Map<string, NamedAmount>();
  const byCategory = new Map<string, number>();
  const byBrand = new Map<string, number>();
  const byDay = new Map<string, { revenue: number; units: number }>();
  const orderProducts = new Map<string, Map<string, string>>();
  const orders = new Set<string>();
  let revenue = 0;
  let units = 0;
  let firstDay = bounds.to;

  for (const l of lines) {
    revenue += l.total;
    units += l.quantity;
    orders.add(l.orderId);
    if (l.day < firstDay) firstDay = l.day;

    const p = byProduct.get(l.productId) ?? { name: l.name, revenue: 0, units: 0 };
    p.revenue += l.total;
    p.units += l.quantity;
    byProduct.set(l.productId, p);

    const cat = l.category?.trim() || UNCATEGORIZED;
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + l.total);
    const brand = brandNames.get(l.brandId) ?? "—";
    byBrand.set(brand, (byBrand.get(brand) ?? 0) + l.total);

    const d = byDay.get(l.day) ?? { revenue: 0, units: 0 };
    d.revenue += l.total;
    d.units += l.quantity;
    byDay.set(l.day, d);

    const set = orderProducts.get(l.orderId) ?? new Map<string, string>();
    set.set(l.productId, l.name);
    orderProducts.set(l.orderId, set);
  }

  const products = [...byProduct.values()].map((p) => ({
    name: p.name,
    revenue: round2(p.revenue),
    units: round2(p.units),
  }));
  const top = (key: "revenue" | "units") =>
    [...products].sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name)).slice(0, 10);

  const slices = (m: Map<string, number>) =>
    [...m.entries()]
      .map(([name, value]) => ({ name, value: round2(value) }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

  // Products that share an order, counted per pair (a pair counts once per order).
  const pairCounts = new Map<string, { a: string; b: string; count: number }>();
  for (const set of orderProducts.values()) {
    const ids = [...set.keys()].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}|${ids[j]}`;
        const e = pairCounts.get(key) ?? { a: set.get(ids[i])!, b: set.get(ids[j])!, count: 0 };
        e.count += 1;
        pairCounts.set(key, e);
      }
    }
  }
  const pairs = [...pairCounts.values()]
    .filter((p) => p.count >= 2)
    .sort((x, y) => y.count - x.count || x.a.localeCompare(y.a))
    .slice(0, 8);

  const { trend, trendBy } = fillTrend(byDay, bounds.from ?? firstDay, bounds.to);

  return {
    revenue: round2(revenue),
    units: round2(units),
    orders: orders.size,
    products: byProduct.size,
    topByRevenue: top("revenue"),
    topByUnits: top("units"),
    byCategory: slices(byCategory),
    byBrand: slices(byBrand),
    trend,
    trendBy,
    pairs,
  };
}

// --- Insight by Quantity / by Price -------------------------------------------
// One row per product with a value for each month Jan..Dec of one year: how many
// were sold (qty) and how much they sold for (amount, item prices).

export type MonthlyRow = {
  id: string;
  name: string;
  unit: string;
  qty: number[];
  amount: number[];
};

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// `lines` are already limited to the one year; the month comes from each line's day.
export function buildMonthlyTable(lines: InsightLine[]): MonthlyRow[] {
  const rows = new Map<string, MonthlyRow>();
  for (const l of lines) {
    const month = Number(l.day.slice(5, 7)) - 1;
    if (!(month >= 0 && month < 12)) continue;
    const row =
      rows.get(l.productId) ??
      { id: l.productId, name: l.name, unit: l.unit ?? "", qty: Array(12).fill(0), amount: Array(12).fill(0) };
    row.qty[month] += l.quantity;
    row.amount[month] += l.total;
    rows.set(l.productId, row);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, qty: r.qty.map(round2), amount: r.amount.map(round2) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
