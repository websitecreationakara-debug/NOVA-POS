import { describe, expect, it } from "vitest";
import { summarizeMarginLines, type MarginLine } from "./cogs";
import { settledDayLabel } from "./orderStatus";

const show = (title: string, rows: unknown) => console.log(`\n=== ${title} ===\n`, rows);

describe("Margin Report: Unit Cost when a product's cost changes", () => {
  // Oct 1: cost $9.00, 5 sold at $15.  Oct 3: Stock cost rises to $9.55, 3 more sold.
  const sales: MarginLine[] = [
    { quantity: 5, lineTotal: 75, cogs: 45, unitCost: 9, paidAt: "2026-10-01T03:00:00Z" },
    { quantity: 3, lineTotal: 45, cogs: 28.65, unitCost: 9.55, paidAt: "2026-10-03T03:00:00Z" },
  ];

  it("range with BOTH sales: latest cost shown, old cost noted, COGS exact per sale", () => {
    const r = summarizeMarginLines(sales);
    show("Oct 1-3 (cost changed inside the range)", r);
    expect(r.unitCost).toBe(9.55); // latest, not the 9.2 average
    expect(r.earlierUnitCosts).toEqual([9]); // shown as "was $9.00"
    expect(r.totalCogs).toBe(73.65); // 5 x 9.00 + 3 x 9.55
    expect(r.grossProfit).toBe(46.35); // 120 - 73.65
  });

  it("range with only the OLD sale: still $9.00 -- raising the cost later did not touch it", () => {
    const r = summarizeMarginLines([sales[0]]);
    show("Oct 1 only (before the change)", r);
    expect(r.unitCost).toBe(9);
    expect(r.earlierUnitCosts).toEqual([]);
    expect(r.totalCogs).toBe(45);
  });

  it("range with only the NEW sale: $9.55", () => {
    const r = summarizeMarginLines([sales[1]]);
    show("Oct 3 only (after the change)", r);
    expect(r.unitCost).toBe(9.55);
    expect(r.totalCogs).toBe(28.65);
  });

  it("cost goes DOWN later: latest is the lower cost, old higher cost is noted", () => {
    const r = summarizeMarginLines([
      { quantity: 2, lineTotal: 30, cogs: 19.1, unitCost: 9.55, paidAt: "2026-10-01T03:00:00Z" },
      { quantity: 2, lineTotal: 30, cogs: 18, unitCost: 9, paidAt: "2026-10-04T03:00:00Z" },
    ]);
    show("Cost decreased", r);
    expect(r.unitCost).toBe(9);
    expect(r.earlierUnitCosts).toEqual([9.55]);
  });

  it("input order doesn't matter -- 'latest' is by sale time", () => {
    const r = summarizeMarginLines([...sales].reverse());
    expect(r.unitCost).toBe(9.55);
  });

  it("a sale with no cost makes the product's cost unknown (never a wrong number)", () => {
    const r = summarizeMarginLines([...sales, { quantity: 1, lineTotal: 15, cogs: null, unitCost: null, paidAt: "2026-10-04T03:00:00Z" }]);
    show("One line with no cost", r);
    expect(r.unitCost).toBeNull();
    expect(r.totalCogs).toBeNull();
    expect(r.hasUnknownCost).toBe(true);
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
