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

const settings = { ...DEFAULT_SETTINGS, windowDays: 30, safetyPct: 15 };

describe("suggestReorder", () => {
  it("follows the rule: need = daily x 30, +15% safety, minus stock", () => {
    // 1.2 a day -> 36 for the month -> 41 with 15% -> minus 10 in stock = 31 units.
    const s = suggestReorder(product(), settings);
    expect(s).toMatchObject({ status: "buy", dailyRate: 1.2, target: 41, buyUnits: 31 });
  });

  it("rounds up to whole cases", () => {
    // The example in the rule: 31 short with 24 per case = 2 cases (48).
    const s = suggestReorder(product({ caseSize: 24, unitCost: 2 }), settings);
    expect(s).toMatchObject({ status: "buy", cases: 2, buyUnits: 48, cost: 96 });
  });

  it("says don't buy yet when stock already covers the need", () => {
    const s = suggestReorder(product({ stock: 100 }), settings);
    expect(s).toMatchObject({ status: "enough", buyUnits: 0 });
  });

  it("takes stock already on order off what to buy", () => {
    const s = suggestReorder(product(), settings, 20);
    expect(s).toMatchObject({ status: "buy", buyUnits: 11 });
  });

  it("adds the supplier's delivery days to the days to cover", () => {
    // 1.2 x (30 + 14) = 52.8, +15% = 60.72, minus 10 = 50.72 -> 51.
    const s = suggestReorder(product(), { ...settings, leadDays: 14 });
    expect(s.buyUnits).toBe(51);
  });

  it("leaves out days the product had no stock", () => {
    // Out of stock for half the window: the average is over the days it could sell (2/day), not 1/day.
    const oos = Array.from({ length: HISTORY_DAYS }, (_, i) => i >= HISTORY_DAYS - 15 && i < HISTORY_DAYS);
    const p = product({ perDay: (i) => (oos[i] ? 0 : 2), outOfStock: oos });
    expect(suggestReorder(p, settings).dailyRate).toBe(2);
  });

  it("uses only the chosen look-back window", () => {
    // Slow before the last 30 days, fast in them.
    const p = product({ perDay: (i) => (i >= HISTORY_DAYS - 30 ? 3 : 0.5) });
    expect(suggestReorder(p, { ...settings, windowDays: 30 }).dailyRate).toBe(3);
    expect(suggestReorder(p, { ...settings, windowDays: 90 }).dailyRate).toBeCloseTo(1.33, 1);
  });

  it("shows the trend", () => {
    const rising = product({ perDay: (i) => (i >= HISTORY_DAYS - 15 ? 3 : 2) });
    expect(suggestReorder(rising, { ...settings, windowDays: 30 }).trendPct).toBe(50);
  });

  it("has not enough data for a product under two weeks old", () => {
    expect(suggestReorder(product({ historyDays: 10 }), settings).status).toBe("not_enough_data");
  });

  it("gives no number to a product whose stock isn't tracked", () => {
    expect(suggestReorder(product({ tracked: false }), settings).status).toBe("untracked");
  });

  it("counts a negative stock as zero and flags it", () => {
    const s = suggestReorder(product({ stock: -12 }), settings);
    expect(s).toMatchObject({ status: "buy", buyUnits: 41, stockBelowZero: true });
  });

  it("buys nothing for a product that doesn't sell", () => {
    expect(suggestReorder(product({ perDay: 0 }), settings)).toMatchObject({ status: "no_sales", buyUnits: 0 });
  });
});
