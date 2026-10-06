import { describe, expect, it } from "vitest";
import { ageTally, monthlyCounts, shiftMonth, tally } from "./crmCharts";

describe("tally", () => {
  it("counts values biggest first and puts blanks last as Unknown", () => {
    expect(tally(["F", "M", "F", null, "", "F"])).toEqual([
      { name: "F", value: 3 },
      { name: "M", value: 1 },
      { name: "Unknown", value: 2 },
    ]);
  });

  it("keeps the top N and sums the rest into Other", () => {
    const out = tally(["a", "a", "a", "b", "b", "c", "d"], 2);
    expect(out).toEqual([
      { name: "a", value: 3 },
      { name: "b", value: 2 },
      { name: "Other", value: 2 },
    ]);
  });

  it("puts Other before Unknown", () => {
    const out = tally(["a", "a", "b", "c", null, null, null], 1);
    expect(out.map((s) => s.name)).toEqual(["a", "Other", "Unknown"]);
  });

  it("leaves a short list alone", () => {
    expect(tally(["a", "b"], 5)).toHaveLength(2);
  });
});

describe("ageTally", () => {
  it("orders the ranges youngest first and folds odd values into Other", () => {
    expect(ageTally(["35-44", "18-24", "35-44", "33-38", null, "55+"])).toEqual([
      { name: "18-24", value: 1 },
      { name: "35-44", value: 2 },
      { name: "55+", value: 1 },
      { name: "Other", value: 1 },
      { name: "Unknown", value: 1 },
    ]);
  });
});

describe("months", () => {
  it("shifts across a year boundary", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-10", -9)).toBe("2026-01");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
  });

  it("fills quiet months with 0 and ends at the given month", () => {
    const out = monthlyCounts(["2026-10-03", "2026-10-20", "2026-08-01", "bad", null], "2026-10", 4);
    expect(out).toEqual([
      { month: "2026-07", value: 0 },
      { month: "2026-08", value: 1 },
      { month: "2026-09", value: 0 },
      { month: "2026-10", value: 2 },
    ]);
  });
});
