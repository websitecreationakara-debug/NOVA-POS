import { describe, expect, it } from "vitest";
import {
  computeLineTotal,
  computeMargin,
  computeSetTotalCost,
  computeUnitCostForScale,
  countItemsMissingCost,
  parseWeightGrams,
  parseWeightGramsFromName,
  productWeightGrams,
  suggestSellPrice,
} from "./costControl";

describe("computeLineTotal", () => {
  it("is amount * unitCost", () => {
    expect(computeLineTotal({ amount: 2.5, unitCost: 4 })).toBe(10);
  });

  it("is null when unitCost is unknown", () => {
    expect(computeLineTotal({ amount: 2, unitCost: null })).toBeNull();
  });
});

describe("computeSetTotalCost", () => {
  it("sums every line's total", () => {
    expect(
      computeSetTotalCost([
        { amount: 2, unitCost: 3 }, // 6
        { amount: 0.5, unitCost: 10 }, // 5
      ])
    ).toBe(11);
  });

  it("skips lines with no unit cost instead of going null", () => {
    expect(
      computeSetTotalCost([
        { amount: 2, unitCost: 3 }, // 6
        { amount: 1, unitCost: null }, // skipped
      ])
    ).toBe(6);
  });

  it("is 0 for an empty set", () => {
    expect(computeSetTotalCost([])).toBe(0);
  });
});

describe("countItemsMissingCost", () => {
  it("counts lines with no unit cost", () => {
    expect(
      countItemsMissingCost([
        { amount: 2, unitCost: 3 },
        { amount: 1, unitCost: null },
        { amount: 1, unitCost: null },
      ])
    ).toBe(2);
  });

  it("is 0 when every line has a cost", () => {
    expect(countItemsMissingCost([{ amount: 2, unitCost: 3 }])).toBe(0);
  });
});

describe("computeMargin", () => {
  it("computes gross profit and margin %", () => {
    expect(computeMargin(60, 100)).toEqual({ grossProfit: 40, marginPct: 40 });
  });

  it("is null when cost or sell price is unknown", () => {
    expect(computeMargin(null, 100)).toEqual({ grossProfit: null, marginPct: null });
    expect(computeMargin(60, null)).toEqual({ grossProfit: null, marginPct: null });
  });
});

describe("parseWeightGrams", () => {
  it("parses grams and kilograms", () => {
    expect(parseWeightGrams("500g")).toBe(500);
    expect(parseWeightGrams("1kg")).toBe(1000);
    expect(parseWeightGrams("0.5 kg")).toBe(500);
  });

  it("is null for non-weight or bare unit labels", () => {
    expect(parseWeightGrams("pcs")).toBeNull();
    expect(parseWeightGrams("kg")).toBeNull();
    expect(parseWeightGrams("g")).toBeNull();
  });
});

describe("parseWeightGramsFromName", () => {
  it("parses a parenthesized weight in the product name", () => {
    expect(parseWeightGramsFromName("Herring Roe Nishin Red (500g)")).toBe(500);
  });

  it("parses a parenthesized weight with trailing text, e.g. a pack unit", () => {
    expect(parseWeightGramsFromName("Deep Fried Capelin (180g/pkt)")).toBe(180);
    expect(parseWeightGramsFromName("Hokkaido octopus legs (1kg/pkt)")).toBe(1000);
  });

  it("parses a trailing weight with no parens", () => {
    expect(parseWeightGramsFromName("Fresh Salmon 250g Set")).toBe(250);
    expect(parseWeightGramsFromName("Fresh Smart Oyster 1kg Set")).toBe(1000);
  });

  it("is null when the name has no weight", () => {
    expect(parseWeightGramsFromName("Azuma Boiled Octopus Wasabi")).toBeNull();
  });
});

describe("productWeightGrams", () => {
  it("prefers a weight-only unit label", () => {
    expect(productWeightGrams("500g", "irrelevant")).toBe(500);
  });

  it("treats a bare kg/g unit as already priced per kilo/gram", () => {
    expect(productWeightGrams("kg", "irrelevant")).toBe(1000);
    expect(productWeightGrams("g", "irrelevant")).toBe(1);
  });

  it("falls back to a weight in the product name", () => {
    expect(productWeightGrams("pcs", "Herring Roe Nishin Red (500g)")).toBe(500);
  });

  it("is null when nothing indicates a weight", () => {
    expect(productWeightGrams("pcs", "Azuma Boiled Octopus Wasabi")).toBeNull();
  });

  it("prefers an explicit weight over any unit/name guess", () => {
    expect(productWeightGrams("pcs", "Azuma Boiled Octopus Wasabi", 350)).toBe(350);
    expect(productWeightGrams("500g", "irrelevant", 350)).toBe(350);
  });

  it("falls through to unit/name parsing when explicit weight is null/undefined", () => {
    expect(productWeightGrams("500g", "irrelevant", null)).toBe(500);
    expect(productWeightGrams("500g", "irrelevant", undefined)).toBe(500);
  });
});

describe("computeUnitCostForScale", () => {
  it("matches the Herring Roe Nishin Red worked example: 500g pack at $31.50", () => {
    const weightGrams = 500;
    // Native pack scale (pcs/box/pack/set/...) -- cost passes through as-is
    expect(computeUnitCostForScale(31.5, weightGrams, "pcs")).toBe(31.5);
    // 1kg = 2x 500g -> $63.00, not $31.50
    expect(computeUnitCostForScale(31.5, weightGrams, "kg")).toBe(63);
    expect(computeUnitCostForScale(31.5, weightGrams, "KG")).toBe(63);
    // Per gram
    expect(computeUnitCostForScale(31.5, weightGrams, "g")).toBe(0.063);
  });

  it("is null for a weight scale when the weight is unknown", () => {
    expect(computeUnitCostForScale(31.5, null, "kg")).toBeNull();
    expect(computeUnitCostForScale(31.5, null, "g")).toBeNull();
  });

  it("passes a non-weight scale through even when weight is unknown", () => {
    expect(computeUnitCostForScale(31.5, null, "box")).toBe(31.5);
  });
});

describe("suggestSellPrice", () => {
  it("suggests a price hitting the target margin", () => {
    // $10 cost at a 30% target margin -> sells for $14.29
    expect(suggestSellPrice(10, 30)).toBeCloseTo(14.29);
  });

  it("is null when the target margin is 100% or more", () => {
    expect(suggestSellPrice(10, 100)).toBeNull();
  });

  it("is null when cost is unknown", () => {
    expect(suggestSellPrice(null, 30)).toBeNull();
  });
});
