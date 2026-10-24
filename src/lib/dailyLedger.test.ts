import { describe, expect, it } from "vitest";
import { buildDailyLedger, daysOfMonth, splitProductName } from "./dailyLedger";

describe("splitProductName", () => {
  it("takes the trailing bracket as the size", () => {
    expect(splitProductName("Jack Daniel's Cola (24 Cans)")).toEqual({ name: "Jack Daniel's Cola", size: "24 Cans" });
    expect(splitProductName("Kirin (24 Cans (350ml/can))")).toEqual({ name: "Kirin", size: "24 Cans (350ml/can)" });
    expect(splitProductName("Plain Product")).toEqual({ name: "Plain Product", size: "" });
  });
});

describe("daysOfMonth", () => {
  it("lists every day", () => {
    expect(daysOfMonth("2026-02")).toHaveLength(28);
    expect(daysOfMonth("2026-10")[30]).toBe("2026-10-31");
  });
});

const product = { id: "a", sku: "BR-1", fullName: "Beer (6 cans)", unit: "pcs", categoryName: "Beer", price: 5, originalCost: 1.9, cost10: 2.2, quantityNow: 40, cost: 2 };

describe("typed ledger entries", () => {
  const base = {
    month: "2026-10",
    today: "2026-10-03",
    products: [product],
    movements: [],
    movementsAfter: [],
    purchases: [],
    sold: [],
    other: [],
  };

  it("replaces the worked-out cells and works R again from them", () => {
    const [row] = buildDailyLedger({
      ...base,
      entries: [
        { productId: "a", field: "begin", value: "10" },
        { productId: "a", field: "p:01", value: "5" },
        { productId: "a", field: "s:02", value: "3" },
        { productId: "a", field: "o:02", value: "1" },
        { productId: "a", field: "total_cost", value: "4" },
        { productId: "a", field: "ex_date", value: "12/2026" },
        { productId: "a", field: "sku", value: "NEW-1" },
      ],
    });
    expect(row.begin).toBe(10);
    expect(row.days[0].r).toBe(15);
    expect(row.days[1].r).toBe(11); // (15 + 0) - (3 + 1)
    expect(row.days[3].r).toBeNull(); // still to come
    expect(row).toMatchObject({ totalIn: 5, totalSold: 3, totalOther: 1, ending: 11, endingValue: 44, exDate: "12/2026", sku: "NEW-1" });
    expect(row.edited).toContain("p:01");
  });

  it("works TC+10% out as Total Cost / 0.9 unless it was typed", () => {
    const [worked] = buildDailyLedger({ ...base, entries: [{ productId: "a", field: "total_cost", value: "9" }] });
    expect(worked.cost10).toBe(10);
    const [typed] = buildDailyLedger({
      ...base,
      entries: [
        { productId: "a", field: "total_cost", value: "9" },
        { productId: "a", field: "tc10", value: "7" },
      ],
    });
    expect(typed.cost10).toBe(7);
  });

  it("gives a coming day an R once something is typed into it", () => {
    const [row] = buildDailyLedger({
      ...base,
      entries: [{ productId: "a", field: "p:05", value: "7" }],
    });
    expect(row.days[3].r).toBeNull(); // Oct 4, nothing typed yet
    expect(row.days[4].r).toBe(47); // Oct 5: 40 + 7
    expect(row.days[5].r).toBe(47); // and it carries on
    expect(row.ending).toBe(47);
  });

  it("keeps a row that has typed values even with no stock", () => {
    const rows = buildDailyLedger({
      ...base,
      products: [{ ...product, quantityNow: 0 }],
      entries: [{ productId: "a", field: "ex_date", value: "01/2027" }],
    });
    expect(rows).toHaveLength(1);
  });
});

describe("buildDailyLedger", () => {
  it("works the opening, remaining and totals out of the stock movements", () => {
    const [row] = buildDailyLedger({
      month: "2026-10",
      today: "2026-10-05",
      products: [product],
      movements: [
        { productId: "a", day: "2026-10-02", qty: 50 },
        { productId: "a", day: "2026-10-03", qty: -6 },
        { productId: "a", day: "2026-10-04", qty: -4 },
      ],
      // 40 now, 10 left the shelf after the month's days we look at -> 50 at the end of Oct 4
      movementsAfter: [{ productId: "a", qty: -10 }],
      purchases: [{ productId: "a", day: "2026-10-02", qty: 50 }],
      sold: [{ productId: "a", day: "2026-10-03", qty: 6 }],
      other: [{ productId: "a", day: "2026-10-04", qty: 4 }],
    });
    // the month end quantity is 50 - nothing moved Oct 5..31 except the -10 after the range, so
    // begin = 50 - (50 - 6 - 4) = 10
    expect(row.begin).toBe(10);
    expect(row.days[1]).toMatchObject({ p: 50, r: 60 });
    expect(row.days[2]).toMatchObject({ s: 6, r: 54 });
    expect(row.days[3]).toMatchObject({ o: 4, r: 50 });
    expect(row.days[4].r).toBe(50); // today, no movement
    expect(row.days[5].r).toBeNull(); // the future
    expect(row).toMatchObject({ totalIn: 50, totalSold: 6, totalOther: 4, ending: 50, endingValue: 100 });
  });

  it("works R as previous R + P - (S + O), whatever else moved the stock", () => {
    const [row] = buildDailyLedger({
      month: "2026-10",
      today: "2026-10-03",
      products: [{ ...product, quantityNow: 100 }],
      // the log also holds a +30 that is none of P, S or O (e.g. a website sync) on Oct 2
      movements: [{ productId: "a", day: "2026-10-02", qty: 30 }],
      movementsAfter: [],
      purchases: [{ productId: "a", day: "2026-10-01", qty: 5 }],
      sold: [{ productId: "a", day: "2026-10-02", qty: 8 }],
      other: [{ productId: "a", day: "2026-10-02", qty: 2 }],
    });
    // begin = 100 - 30 = 70
    expect(row.begin).toBe(70);
    expect(row.days[0].r).toBe(75); // (70 + 5) - 0
    expect(row.days[1].r).toBe(65); // (75 + 0) - (8 + 2)
    expect(row.days[2].r).toBe(65);
    expect(row.ending).toBe(65);
  });

  it("keeps a product with nothing on the shelf and no activity, so the list matches Stock", () => {
    const rows = buildDailyLedger({
      month: "2026-10",
      today: "2026-10-31",
      products: [{ ...product, quantityNow: 0 }],
      movements: [],
      movementsAfter: [],
      purchases: [],
      sold: [],
      other: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ begin: 0, ending: 0 });
  });

  it("keeps a product taken out of Stock only while it has stock or activity", () => {
    const run = (quantityNow: number) =>
      buildDailyLedger({
        month: "2026-10",
        today: "2026-10-31",
        products: [{ ...product, quantityNow, hideWhenEmpty: true }],
        movements: [],
        movementsAfter: [],
        purchases: [],
        sold: [],
        other: [],
      });
    expect(run(7)).toHaveLength(1);
    expect(run(0)).toHaveLength(0);
  });

  it("has no value when the product has no cost", () => {
    const [row] = buildDailyLedger({
      month: "2026-10",
      today: "2026-10-31",
      products: [{ ...product, cost: null }],
      movements: [],
      movementsAfter: [],
      purchases: [],
      sold: [],
      other: [],
    });
    expect(row.endingValue).toBeNull();
    expect(row.ending).toBe(40);
  });
});
