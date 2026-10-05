import { describe, expect, it } from "vitest";
import { summarizeMarginLines, type MarginLine } from "./cogs";
import { settledDayLabel } from "./orderStatus";

const show = (title: string, rows: unknown) => console.log(`\n=== ${title} ===\n`, rows);

describe("Margin Report: Unit Cost is fixed, COGS is real", () => {
  // Oct 1: cost $9.00, 5 sold at $15.  Oct 3: Stock cost rises to $9.55, 3 more sold.
  const sales: MarginLine[] = [
    { quantity: 5, lineTotal: 75, cogs: 45, unitCost: 9, paidAt: "2026-10-01T03:00:00Z" },
    { quantity: 3, lineTotal: 45, cogs: 28.65, unitCost: 9.55, paidAt: "2026-10-03T03:00:00Z" },
  ];
  const CURRENT = 9.55; // the product's cost in Stock today

  it("Unit Cost is the SAME whichever date range is viewed", () => {
    const both = summarizeMarginLines(sales, CURRENT);
    const oldOnly = summarizeMarginLines([sales[0]], CURRENT);
    const newOnly = summarizeMarginLines([sales[1]], CURRENT);
    show("Unit Cost per range (current cost 9.55)", { both: both.unitCost, oldOnly: oldOnly.unitCost, newOnly: newOnly.unitCost });
    expect([both.unitCost, oldOnly.unitCost, newOnly.unitCost]).toEqual([9.55, 9.55, 9.55]);
  });

  it("Total COGS and profit still use each sale's real cost", () => {
    const both = summarizeMarginLines(sales, CURRENT);
    show("Oct 1-3", both);
    expect(both.totalCogs).toBe(73.65); // 5 x 9.00 + 3 x 9.55 -- not 8 x 9.55
    expect(both.grossProfit).toBe(46.35);
    // shown as "3 sold at $9.55" / "5 sold at $9.00" under the Unit Cost
    expect(both.soldAt).toEqual([
      { unitCost: 9.55, units: 3 },
      { unitCost: 9, units: 5 },
    ]);
    expect(summarizeMarginLines([sales[0]], CURRENT).totalCogs).toBe(45); // old sale untouched
  });

  it("cost goes DOWN: Unit Cost follows Stock, old higher cost is noted", () => {
    const r = summarizeMarginLines(
      [
        { quantity: 2, lineTotal: 30, cogs: 19.1, unitCost: 9.55, paidAt: "2026-10-01T03:00:00Z" },
        { quantity: 2, lineTotal: 30, cogs: 18, unitCost: 9, paidAt: "2026-10-04T03:00:00Z" },
      ],
      9
    );
    expect(r.unitCost).toBe(9);
    expect(r.soldAt).toEqual([
      { unitCost: 9, units: 2 },
      { unitCost: 9.55, units: 2 },
    ]);
    expect(r.totalCogs).toBe(37.1);
  });

  it("no current cost in Stock: falls back to the latest recorded cost (not an average)", () => {
    expect(summarizeMarginLines(sales, null).unitCost).toBe(9.55);
    expect(summarizeMarginLines([...sales].reverse(), null).unitCost).toBe(9.55);
  });

  it("a sale with no recorded cost: COGS unknown, but Unit Cost still shows the current cost", () => {
    const r = summarizeMarginLines(
      [...sales, { quantity: 1, lineTotal: 15, cogs: null, unitCost: null, paidAt: "2026-10-04T03:00:00Z" }],
      CURRENT
    );
    expect(r.unitCost).toBe(9.55);
    expect(r.totalCogs).toBeNull();
    expect(r.hasUnknownCost).toBe(true);
    expect(summarizeMarginLines([{ quantity: 1, lineTotal: 15, cogs: null, unitCost: null, paidAt: null }], null).unitCost).toBeNull();
  });
});

describe("Orders list: day a Pre-Order was finished", () => {
  const preOrderDay = "2026-10-01T03:00:00Z"; // Oct 1, Phnom Penh

  it("finished the SAME day -> nothing shown", () => {
    const out = settledDayLabel("2026-10-01T10:00:00Z", preOrderDay);
    show("Pre-Order Oct 1, completed Oct 1", out);
    expect(out).toBeNull();
  });

  it("finished a LATER day -> that day shown", () => {
    const out = settledDayLabel("2026-10-03T05:00:00Z", preOrderDay);
    show("Pre-Order Oct 1, completed Oct 3", out);
    expect(out).toBe("10/3/2026");
  });

  it("Phnom Penh midnight edge: 11pm UTC Oct 1 is already Oct 2 in Cambodia", () => {
    const out = settledDayLabel("2026-10-01T18:00:00Z", preOrderDay);
    show("Completed 01:00 Oct 2 local", out);
    expect(out).toBe("10/2/2026");
  });

  it("no settled date (not a finished pre-order / older order) -> nothing shown", () => {
    expect(settledDayLabel(null, preOrderDay)).toBeNull();
  });
});
