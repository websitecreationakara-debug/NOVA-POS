import { describe, expect, it } from "vitest";
import {
  buildPeriod,
  normalizeAnchor,
  parseCompareAnchors,
  parseGranularity,
  periodLabel,
  yearsInRange,
  MAX_COMPARE,
  periodRange,
  shiftAnchor,
  type CustomerRow,
  type PeriodOrder,
} from "./crmPeriods";

describe("periods", () => {
  const today = "2026-10-06"; // a Tuesday

  it("defaults to all time and ignores junk", () => {
    expect(parseGranularity(undefined)).toBe("all");
    expect(parseGranularity("hour")).toBe("all");
    expect(parseGranularity("week")).toBe("week");
  });

  it("snaps anchors to their period", () => {
    expect(normalizeAnchor("week", "2026-10-08", today)).toBe("2026-10-05"); // the Monday
    expect(normalizeAnchor("week", undefined, today)).toBe("2026-10-05");
    expect(normalizeAnchor("month", "bad", today)).toBe("2026-10");
    expect(normalizeAnchor("year", "2025", today)).toBe("2025");
    expect(normalizeAnchor("day", "2026-02-30", today)).toBe(today);
  });

  it("gives each period's first and last day", () => {
    expect(periodRange("day", "2026-10-03", today)).toEqual({ from: "2026-10-03", to: "2026-10-03" });
    expect(periodRange("week", "2026-10-05", today)).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(periodRange("month", "2026-02", today)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("month", "2028-02", today).to).toBe("2028-02-29");
    expect(periodRange("year", "2025", today)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(periodRange("all", "", today)).toEqual({ from: null, to: today });
  });

  it("steps to the previous period of the same kind", () => {
    expect(shiftAnchor("day", "2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftAnchor("week", "2026-10-05", -1)).toBe("2026-09-28");
    expect(shiftAnchor("month", "2026-01", -1)).toBe("2025-12");
    expect(shiftAnchor("year", "2026", -1)).toBe("2025");
  });

  it("labels them", () => {
    expect(periodLabel("day", "2026-10-03")).toBe("Sat, Oct 3, 2026");
    expect(periodLabel("week", "2026-10-05")).toBe("Oct 5 – Oct 11, 2026");
    expect(periodLabel("month", "2026-10")).toBe("October 2026");
    expect(periodLabel("year", "2026")).toBe("2026");
  });
});

describe("buildPeriod", () => {
  const cust = (over: Partial<CustomerRow>): CustomerRow => ({
    id: "c1",
    name: "A",
    phone: "855111",
    second_phone: null,
    state: "Phnom Penh",
    gender: "F",
    age: "25-34",
    nationality: "KH",
    capital: "Sen Sok",
    since: "2026-10-02",
    ...over,
  });
  const customers = [
    cust({ id: "c1", name: "Alice", phone: "855111" }),
    cust({ id: "c2", name: "Bob", phone: "855222", gender: "M", state: "Siem Reap", capital: null, since: "2026-09-10" }),
    cust({ id: "c3", name: "Cara", phone: "855333", since: "2025-01-01" }),
  ];
  const order = (over: Partial<PeriodOrder>): PeriodOrder => ({
    id: "o1",
    customerId: null,
    phone: null,
    subtotal: 10,
    day: "2026-10-03",
    hour: 9,
    ...over,
  });
  const orders = [
    order({ id: "o1", customerId: "c1", subtotal: 30, hour: 9 }),
    order({ id: "o2", phone: "855111", subtotal: 20, hour: 14 }), // Alice, matched by phone
    order({ id: "o3", phone: "855222", subtotal: 50, day: "2026-10-04" }), // Bob
    order({ id: "o4", phone: "855999", subtotal: 5 }), // matches nobody
    order({ id: "o5", customerId: "c3", subtotal: 7, day: "2026-09-01" }), // outside the week
  ];
  const base = { today: "2026-10-06", customers, orders };

  it("counts a week", () => {
    const p = buildPeriod({ ...base, gran: "week", anchor: "2026-09-28", province: "" });
    expect(p.orders).toBe(4); // o1 - o4
    expect(p.spent).toBe(105);
    expect(p.buyers).toBe(2); // Alice and Bob
    expect(p.newCustomers).toBe(1); // Alice joined Oct 2
    expect(p.buckets).toHaveLength(7);
    expect(p.buckets[5].label).toBe("Sat 3");
  });

  it("matches older orders to customers by phone, and draws a day by hour", () => {
    const p = buildPeriod({ ...base, gran: "day", anchor: "2026-10-03", province: "" });
    expect(p.buyers).toBe(1);
    expect(p.orders).toBe(3); // o1, o2 and the unmatched o4
    expect(p.topBuyers).toEqual([{ name: "Alice", orders: 2, units: 0, spent: 50 }]);
    expect(p.buckets).toHaveLength(24);
    expect(p.buckets[9].orders).toBe(2); // o1 and o4 at 09:00
    expect(p.buckets[14].spent).toBe(20);
  });

  it("filters by province", () => {
    const p = buildPeriod({ ...base, gran: "month", anchor: "2026-10", province: "Siem Reap" });
    expect(p.buyers).toBe(1);
    expect(p.orders).toBe(1);
    expect(p.spent).toBe(50);
    expect(p.byGender).toEqual([{ name: "M", value: 1 }]);
    expect(p.buckets).toHaveLength(31);
  });

  it("describes every customer for all time", () => {
    const p = buildPeriod({ ...base, gran: "all", anchor: "", province: "" });
    expect(p.byGender).toEqual([
      { name: "F", value: 2 },
      { name: "M", value: 1 },
    ]);
    expect(p.buckets).toHaveLength(24);
    expect(p.buckets[23].label).toBe("Oct 26");
  });

  it("lines a year up month by month", () => {
    const p = buildPeriod({ ...base, gran: "year", anchor: "2026", province: "" });
    expect(p.buckets).toHaveLength(12);
    expect(p.buckets[9].orders).toBe(4); // October
    expect(p.buckets[8].orders).toBe(1); // September: o5
  });
});

describe("parseCompareAnchors", () => {
  const today = "2026-10-06";

  it("keeps valid periods in order, without repeats or the main one", () => {
    expect(parseCompareAnchors("year", "2025,2024,2025,2026,2023", "2026", today)).toEqual(["2025", "2024", "2023"]);
  });

  it("snaps weeks to their Monday, so two days in one week are one period", () => {
    // 30 Sep and 29 Sep are both in the week starting Monday 28 Sep; "junk" and
    // blanks are skipped.
    expect(parseCompareAnchors("week", "2026-09-30,junk,,2026-09-29", "2026-10-05", today)).toEqual(["2026-09-28"]);
  });

  it("allows at most MAX_COMPARE, and none for all time", () => {
    const many = Array.from({ length: 20 }, (_, i) => String(2025 - i)).join(",");
    expect(parseCompareAnchors("year", many, "2026", today)).toHaveLength(MAX_COMPARE);
    expect(parseCompareAnchors("all", "2025", "", today)).toEqual([]);
    expect(parseCompareAnchors("month", undefined, "2026-10", today)).toEqual([]);
  });
});

describe("custom ranges", () => {
  const today = "2026-10-06";

  it("normalizes a range, swapping reversed ends, and defaults to the last 7 days", () => {
    expect(normalizeAnchor("range", "2026-10-01..2026-10-06", today)).toBe("2026-10-01..2026-10-06");
    expect(normalizeAnchor("range", "2026-10-06..2026-10-01", today)).toBe("2026-10-01..2026-10-06");
    expect(normalizeAnchor("range", "junk", today)).toBe("2026-09-30..2026-10-06");
    expect(normalizeAnchor("range", "2026-10-01", today)).toBe("2026-09-30..2026-10-06");
  });

  it("gives the range's own days, label and a same-length step back", () => {
    expect(periodRange("range", "2026-10-01..2026-10-06", today)).toEqual({ from: "2026-10-01", to: "2026-10-06" });
    expect(periodLabel("range", "2026-10-01..2026-10-06")).toBe("Oct 1 – Oct 6, 2026");
    expect(periodLabel("range", "2025-12-28..2026-01-03")).toBe("Dec 28, 2025 – Jan 3, 2026");
    // 6 days (1-6 Oct) steps back 6 days: 25-30 Sep.
    expect(shiftAnchor("range", "2026-10-01..2026-10-06", -1)).toBe("2026-09-25..2026-09-30");
    expect(shiftAnchor("range", "2026-10-01..2026-10-06", 1)).toBe("2026-10-07..2026-10-12");
  });

  it("can compare several ranges", () => {
    expect(
      parseCompareAnchors("range", "2026-09-01..2026-09-06,2026-08-01..2026-08-06,2026-10-01..2026-10-06", "2026-10-01..2026-10-06", today)
    ).toEqual(["2026-09-01..2026-09-06", "2026-08-01..2026-08-06"]);
  });

  it("draws a short range day by day and a long one month by month", () => {
    const base = { today, customers: [], orders: [], province: "" };
    const short = buildPeriod({ ...base, gran: "range", anchor: "2026-10-01..2026-10-06" });
    expect(short.buckets.map((b) => b.label)).toEqual(["Oct 1", "Oct 2", "Oct 3", "Oct 4", "Oct 5", "Oct 6"]);
    const long = buildPeriod({ ...base, gran: "range", anchor: "2026-01-15..2026-04-10" });
    expect(long.buckets.map((b) => b.label)).toEqual(["Jan 26", "Feb 26", "Mar 26", "Apr 26"]);
  });
});

describe("yearsInRange", () => {
  it("fills in every year from start to end except the main one", () => {
    expect(yearsInRange(2023, 2026, "2026")).toEqual(["2025", "2024", "2023"]);
    expect(yearsInRange(2026, 2023, "2026")).toEqual(["2025", "2024", "2023"]);
  });

  it("keeps the main year out wherever it falls in the range", () => {
    expect(yearsInRange(2022, 2026, "2024")).toEqual(["2026", "2025", "2023", "2022"]);
  });

  it("keeps the years nearest the main one when there are too many", () => {
    const out = yearsInRange(1990, 2026, "2026");
    expect(out).toHaveLength(MAX_COMPARE);
    expect(out[0]).toBe("2025");
    expect(out[out.length - 1]).toBe(String(2026 - MAX_COMPARE));
  });

  it("returns nothing for junk", () => {
    expect(yearsInRange(Number.NaN, 2026, "2026")).toEqual([]);
    expect(yearsInRange(20, 2026, "2026")).toEqual([]);
    expect(yearsInRange(2026, 2026, "2026")).toEqual([]);
  });
});
