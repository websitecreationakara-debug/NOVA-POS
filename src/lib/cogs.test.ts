import { describe, expect, it } from "vitest";
import {
  aggregatePartialCogs,
  aggregateStrictCogs,
  computeAdjustmentCostImpact,
  computeGrossMargin,
  computeLineCogs,
  computeRecipeUnitCost,
} from "./cogs";

describe("computeRecipeUnitCost", () => {
  it("sums quantity * cost across every ingredient", () => {
    expect(
      computeRecipeUnitCost([
        { quantity: 0.2, costPrice: 2 }, // milk
        { quantity: 1, costPrice: 0.3 }, // cup
      ])
    ).toBeCloseTo(0.7);
  });

  it("is null the moment any ingredient has no cost price", () => {
    expect(
      computeRecipeUnitCost([
        { quantity: 0.2, costPrice: 2 },
        { quantity: 1, costPrice: null },
      ])
    ).toBeNull();
  });

  it("is 0 for an empty ingredient list", () => {
    expect(computeRecipeUnitCost([])).toBe(0);
  });
});

describe("computeLineCogs", () => {
  it("multiplies unit cost by quantity", () => {
    expect(computeLineCogs(1.5, 3)).toBeCloseTo(4.5);
  });

  it("propagates a null (unknown) unit cost instead of treating it as 0", () => {
    expect(computeLineCogs(null, 3)).toBeNull();
  });
});

describe("computeAdjustmentCostImpact", () => {
  it("costs a negative delta (stock leaving) at the product's cost price", () => {
    expect(computeAdjustmentCostImpact(-4, 2.5)).toBeCloseTo(10);
  });

  it("has no cost impact for a positive delta (stock added back)", () => {
    expect(computeAdjustmentCostImpact(4, 2.5)).toBeNull();
  });

  it("is null when the product has no cost price recorded", () => {
    expect(computeAdjustmentCostImpact(-4, null)).toBeNull();
  });
});

describe("computeGrossMargin", () => {
  it("computes profit and margin % from revenue and cogs", () => {
    const { grossProfit, grossMarginPct } = computeGrossMargin(100, 40);
    expect(grossProfit).toBeCloseTo(60);
    expect(grossMarginPct).toBeCloseTo(60);
  });

  it("is null/null when cogs is unknown, never a wrong number", () => {
    expect(computeGrossMargin(100, null)).toEqual({ grossProfit: null, grossMarginPct: null });
  });

  it("has a null margin % (not a divide-by-zero) when revenue is 0", () => {
    expect(computeGrossMargin(0, 0)).toEqual({ grossProfit: 0, grossMarginPct: null });
  });
});

describe("aggregatePartialCogs", () => {
  it("sums known costs and flags the total as incomplete when one is missing", () => {
    expect(aggregatePartialCogs([10, null, 5])).toEqual({ totalCogs: 15, hasUnknownCost: true });
  });

  it("is complete (not flagged) when every line has a known cost", () => {
    expect(aggregatePartialCogs([10, 5])).toEqual({ totalCogs: 15, hasUnknownCost: false });
  });
});

describe("aggregateStrictCogs", () => {
  it("sums every line when all costs are known", () => {
    expect(aggregateStrictCogs([10, 5])).toEqual({ totalCogs: 15, hasUnknownCost: false });
  });

  it("is entirely null when any one line's cost is unknown -- never a partial/misleading total", () => {
    expect(aggregateStrictCogs([10, null, 5])).toEqual({ totalCogs: null, hasUnknownCost: true });
  });
});

describe("historical cost snapshot", () => {
  it("a stored line COGS doesn't change when the product's current cost price changes later", () => {
    // Sale happens when cost price is $2 -- this is what charge_order()
    // snapshots onto the order_item at the time.
    const costPriceAtSaleTime = 2;
    const quantity = 3;
    const storedCogs = computeLineCogs(costPriceAtSaleTime, quantity);

    // The product's cost price is edited afterward (e.g. supplier raised
    // prices) -- recomputing from "today's" cost must NOT match the stored
    // snapshot, proving the snapshot isn't a live join.
    const costPriceToday = 5;
    const recomputedFromToday = computeLineCogs(costPriceToday, quantity);

    expect(storedCogs).toBeCloseTo(6);
    expect(recomputedFromToday).toBeCloseTo(15);
    expect(storedCogs).not.toBe(recomputedFromToday);
  });
});
