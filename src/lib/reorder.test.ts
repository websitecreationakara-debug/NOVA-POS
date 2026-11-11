import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, HISTORY_DAYS, suggestReorder, type ReorderProduct } from "./reorder";

// 90 days; `perDay` units every day, or a function of the day's position (0 = oldest, 89 = yesterday).
function product(over: Partial<ReorderProduct> & { perDay?: number | ((i: number) => number) } = {}): ReorderProduct {
  const { perDay = 1.2, ...rest } = over;
  const daily = Array.from({ length: HISTORY_DAYS }, (_, i) => (typeof perDay === "function" ? perDay(i) : perDay));
  return {
    id: "p",
    name: "Test",
    sku: null,
    unit: "pcs",
    stock: 10,
    caseSize: null,
    unitCost: null,
    tracked: true,
    source: "ledger",
    historyDays: HISTORY_DAYS,
    daily,
    outOfStock: new Array<boolean>(HISTORY_DAYS).fill(false),
    ...rest,
  };
}

// The formula's own numbers: cover 30 days, no delivery wait, 5 safety days.
const settings = { ...DEFAULT_SETTINGS, coverDays: 30, leadDays: 0, safetyDays: 5 };

describe("suggestReorder", () => {
  it("follows the formula: ADS x (30 + lead + safety days) - stock", () => {
    // ADS 1.2 -> target 1.2 x (30 + 0 + 5) = 42, minus 10 in stock = 32 units.
    const s = suggestReorder(product(), settings);
    expect(s).toMatchObject({ status: "buy", dailyRate: 1.2, target: 42, buyUnits: 32 });
  });

  it("matches the worked example", () => {
    // 10 a day, 3 delivery days, 5 safety days: 10 x 38 = 380; minus 120 in stock and 30 incoming = 230.
    const s = suggestReorder(product({ perDay: 10, stock: 120 }), { ...settings, leadDays: 3 }, 30);
    expect(s).toMatchObject({ status: "buy", dailyRate: 10, target: 380, buyUnits: 230 });
  });

  it("rounds up to whole cases", () => {
    // 32 short with 24 per case = 2 cases (48).
    const s = suggestReorder(product({ caseSize: 24, unitCost: 2 }), settings);
    expect(s).toMatchObject({ status: "buy", cases: 2, buyUnits: 48, cost: 96 });
  });

  it("says don't buy yet when stock already covers the target", () => {
    const s = suggestReorder(product({ stock: 100 }), settings);
    expect(s).toMatchObject({ status: "enough", buyUnits: 0 });
  });

  it("takes stock already on order off what to buy", () => {
    const s = suggestReorder(product(), settings, 20);
    expect(s).toMatchObject({ status: "buy", buyUnits: 12 });
  });

  it("adds the supplier's delivery days to the target", () => {
    // 1.2 x (30 + 14 + 5) = 58.8, minus 10 = 48.8 -> 49.
    const s = suggestReorder(product(), { ...settings, leadDays: 14 });
    expect(s.buyUnits).toBe(49);
  });

  it("averages over all 90 days", () => {
    // Slow before the last 30 days, fast in them: (60 x 0.5 + 30 x 3) / 90 = 1.33.
    const p = product({ perDay: (i) => (i >= HISTORY_DAYS - 30 ? 3 : 0.5) });
    expect(suggestReorder(p, settings).dailyRate).toBeCloseTo(1.33, 2);
  });

  it("shows the trend", () => {
    const rising = product({ perDay: (i) => (i >= HISTORY_DAYS / 2 ? 3 : 2) });
    expect(suggestReorder(rising, settings).trendPct).toBe(50);
  });

  it("has not enough data for a product under two weeks old", () => {
    expect(suggestReorder(product({ historyDays: 10 }), settings).status).toBe("not_enough_data");
  });

  it("gives no number to a product whose stock isn't tracked", () => {
    expect(suggestReorder(product({ tracked: false }), settings).status).toBe("untracked");
  });

  it("counts a negative stock as zero and flags it", () => {
    const s = suggestReorder(product({ stock: -12 }), settings);
    expect(s).toMatchObject({ status: "buy", buyUnits: 42, stockBelowZero: true });
  });

  it("buys nothing for a product that doesn't sell", () => {
    expect(suggestReorder(product({ perDay: 0 }), settings)).toMatchObject({ status: "no_sales", buyUnits: 0 });
  });
});
