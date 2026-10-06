import { describe, expect, it } from "vitest";
import {
  addDays,
  buildMonthlyTable,
  buildProductInsight,
  insightBounds,
  parseInsightRange,
  type InsightLine,
} from "./productInsight";

const line = (over: Partial<InsightLine>): InsightLine => ({
  orderId: "o1",
  productId: "p1",
  name: "Uni",
  brandId: "b1",
  category: "Seafood",
  quantity: 1,
  total: 10,
  day: "2026-10-05",
  ...over,
});
const brands = new Map([
  ["b1", "Premium"],
  ["b2", "Sake"],
]);

describe("ranges", () => {
  it("defaults to 30 days and ignores junk", () => {
    expect(parseInsightRange(undefined)).toBe("30d");
    expect(parseInsightRange("nope")).toBe("30d");
    expect(parseInsightRange("year")).toBe("year");
  });

  it("works out the bounds", () => {
    expect(insightBounds("today", "2026-10-06")).toEqual({ from: "2026-10-06", to: "2026-10-06" });
    expect(insightBounds("7d", "2026-10-06")).toEqual({ from: "2026-09-30", to: "2026-10-06" });
    expect(insightBounds("month", "2026-10-06")).toEqual({ from: "2026-10-01", to: "2026-10-06" });
    expect(insightBounds("year", "2026-10-06")).toEqual({ from: "2026-01-01", to: "2026-10-06" });
    expect(insightBounds("all", "2026-10-06").from).toBeNull();
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("buildProductInsight", () => {
  const lines = [
    line({ orderId: "o1", productId: "p1", name: "Uni", quantity: 2, total: 60, day: "2026-10-04" }),
    line({ orderId: "o1", productId: "p2", name: "Rice", quantity: 1, total: 5, category: null, day: "2026-10-04" }),
    line({ orderId: "o2", productId: "p1", name: "Uni", quantity: 1, total: 30, day: "2026-10-05" }),
    line({ orderId: "o2", productId: "p2", name: "Rice", quantity: 3, total: 15, category: null, day: "2026-10-05" }),
    line({ orderId: "o3", productId: "p3", name: "Sake", brandId: "b2", quantity: 1, total: 40, category: "Drinks", day: "2026-10-06" }),
  ];
  const out = buildProductInsight(lines, { from: "2026-10-04", to: "2026-10-06" }, brands);

  it("totals the period", () => {
    expect(out.revenue).toBe(150);
    expect(out.units).toBe(8);
    expect(out.orders).toBe(3);
    expect(out.products).toBe(3);
  });

  it("ranks products", () => {
    expect(out.topByRevenue.map((p) => p.name)).toEqual(["Uni", "Sake", "Rice"]);
    expect(out.topByUnits.map((p) => p.name)).toEqual(["Rice", "Uni", "Sake"]);
    expect(out.topByRevenue[0]).toEqual({ name: "Uni", revenue: 90, units: 3 });
  });

  it("splits sales by category and business", () => {
    expect(out.byCategory).toEqual([
      { name: "Seafood", value: 90 },
      { name: "Drinks", value: 40 },
      { name: "Uncategorized", value: 20 },
    ]);
    expect(out.byBrand).toEqual([
      { name: "Premium", value: 110 },
      { name: "Sake", value: 40 },
    ]);
  });

  it("finds products bought together (2+ orders)", () => {
    expect(out.pairs).toEqual([{ a: "Uni", b: "Rice", count: 2 }]);
  });

  it("gives one trend point per day, with zeros for quiet days", () => {
    expect(out.trendBy).toBe("day");
    expect(out.trend.map((t) => [t.key, t.revenue])).toEqual([
      ["2026-10-04", 65],
      ["2026-10-05", 45],
      ["2026-10-06", 40],
    ]);
  });

  it("switches to months for a long period", () => {
    const long = buildProductInsight(
      [line({ day: "2026-07-15", total: 10 }), line({ orderId: "o9", day: "2026-10-02", total: 5 })],
      { from: null, to: "2026-10-06" },
      brands
    );
    expect(long.trendBy).toBe("month");
    expect(long.trend.map((t) => t.key)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(long.trend.map((t) => t.revenue)).toEqual([10, 0, 0, 5]);
  });
});

describe("buildMonthlyTable", () => {
  it("totals quantity and sales per product per month", () => {
    const rows = buildMonthlyTable([
      line({ productId: "p1", name: "Uni", unit: "box", quantity: 2, total: 60, day: "2026-01-10" }),
      line({ productId: "p1", name: "Uni", unit: "box", quantity: 1.5, total: 45, day: "2026-01-20" }),
      line({ productId: "p1", name: "Uni", unit: "box", quantity: 1, total: 30, day: "2026-09-02" }),
      line({ productId: "p0", name: "Apple", quantity: 4, total: 8, day: "2026-12-31" }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Apple", "Uni"]);
    const uni = rows[1];
    expect(uni.unit).toBe("box");
    expect(uni.qty[0]).toBe(3.5);
    expect(uni.amount[0]).toBe(105);
    expect(uni.qty[8]).toBe(1);
    expect(uni.qty[5]).toBe(0);
    expect(uni.qty).toHaveLength(12);
    expect(rows[0].qty[11]).toBe(4);
  });
});
