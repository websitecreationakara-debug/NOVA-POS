import { describe, expect, it } from "vitest";
import { latestSellingPrice, summarizeMarginLines, type MarginLine } from "./cogs";
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

describe("Margin Report: a Unit Cost typed into the report", () => {
  const edited: MarginLine[] = [
    { quantity: 5, lineTotal: 75, cogs: 50, unitCost: 10, paidAt: "2026-10-01T03:00:00Z", costOverridden: true },
    { quantity: 3, lineTotal: 45, cogs: 30, unitCost: 10, paidAt: "2026-10-03T03:00:00Z", costOverridden: true },
  ];

  it("shows the typed cost, not Stock's current cost", () => {
    const r = summarizeMarginLines(edited, 9.55);
    expect(r.unitCost).toBe(10);
    expect(r.soldAt).toEqual([]);
    expect(r.totalCogs).toBe(80);
  });

  it("a later sale at Stock's cost brings Stock's cost back", () => {
    const r = summarizeMarginLines(
      [...edited, { quantity: 1, lineTotal: 15, cogs: 9.55, unitCost: 9.55, paidAt: "2026-10-04T03:00:00Z" }],
      9.55
    );
    expect(r.unitCost).toBe(9.55);
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

describe("Margin Report: a Stock-linked product's Unit Cost is only Total Cost 10%", () => {
  const typed: MarginLine[] = [
    { quantity: 2, lineTotal: 80, cogs: 5.04, unitCost: 2.52, paidAt: "2026-10-01T03:00:00Z", costOverridden: true },
  ];

  it("shows a cost typed into the report over Total Cost 10%, costing every line at it", () => {
    const s = summarizeMarginLines(typed, 30, true);
    expect(s.unitCost).toBe(2.52);
    expect(s.totalCogs).toBe(5.04);
  });

  it("shows Total Cost 10% once a later sale isn't at the typed cost", () => {
    const later: MarginLine[] = [
      ...typed,
      { quantity: 1, lineTotal: 40, cogs: 2.52, unitCost: 2.52, paidAt: "2026-10-04T03:00:00Z" },
    ];
    expect(summarizeMarginLines(later, 30, true).unitCost).toBe(30);
  });

  it("shows no Unit Cost and no COGS (not the recorded sale cost) when Total Cost 10% is empty", () => {
    const recorded: MarginLine[] = [
      { quantity: 2, lineTotal: 80, cogs: 5.04, unitCost: 2.52, paidAt: "2026-10-01T03:00:00Z" },
    ];
    const s = summarizeMarginLines(recorded, null, true);
    expect(s.unitCost).toBeNull();
    expect(s.totalCogs).toBeNull(); // no Unit Cost -> no COGS either
  });

  it("costs every sold line at Total Cost 10%, not the cost the sale was recorded at", () => {
    const recorded: MarginLine[] = [
      { quantity: 1, lineTotal: 37.5, cogs: 19.81, unitCost: 19.81, paidAt: "2026-10-01T03:00:00Z" },
    ];
    const s = summarizeMarginLines(recorded, 27.05, true);
    expect(s.unitCost).toBe(27.05);
    expect(s.soldAt).toEqual([]);
    expect(s.totalCogs).toBe(27.05);
    expect(s.grossProfit).toBe(10.45);
  });

  it("other products still fall back to the recorded cost", () => {
    expect(summarizeMarginLines(typed, null).unitCost).toBe(2.52);
  });
});

describe("Margin Report: Selling Price is what it last sold at", () => {
  const line = (paidAt: string, unitPrice: number | null, quantity = 1): MarginLine => ({
    quantity,
    lineTotal: (unitPrice ?? 9.71) * quantity,
    cogs: null,
    unitCost: null,
    paidAt,
    unitPrice,
  });

  it("keeps the old sale's price when the catalog price changed afterwards", () => {
    expect(latestSellingPrice([line("2026-10-14T08:00:00Z", 9.71)])).toBe(9.71);
  });

  it("takes the newest sale's price once an order is made at a new price", () => {
    const lines = [line("2026-10-14T08:00:00Z", 9.71), line("2026-10-16T02:00:00Z", 15), line("2026-10-15T02:00:00Z", 12)];
    expect(latestSellingPrice(lines)).toBe(15);
  });

  it("falls back to line total / quantity without a unit price, and null without lines", () => {
    expect(latestSellingPrice([line("2026-10-14T08:00:00Z", null, 2)])).toBe(9.71);
    expect(latestSellingPrice([])).toBeNull();
  });
});
