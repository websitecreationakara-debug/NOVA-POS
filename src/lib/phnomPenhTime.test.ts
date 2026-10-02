import { describe, expect, it } from "vitest";
import { ppDay, ppDayEnd, ppDayStart, ppHour, ppToday } from "./phnomPenhTime";

describe("Phnom Penh time", () => {
  it("puts an early-morning Cambodia order on its own day, not the previous UTC day", () => {
    // 3:19 AM on Oct 2 in Phnom Penh = 20:19 UTC on Oct 1.
    expect(ppDay("2026-10-01T20:19:22Z")).toBe("2026-10-02");
    expect(ppHour("2026-10-01T20:19:22Z")).toBe(3);
  });

  it("keeps a daytime order on the same day", () => {
    expect(ppDay("2026-10-02T06:09:59Z")).toBe("2026-10-02"); // 1:09 PM
    expect(ppHour("2026-10-02T06:09:59Z")).toBe(13);
  });

  it("moves to the next day at 17:00 UTC (midnight in Cambodia)", () => {
    expect(ppDay("2026-10-02T16:59:59Z")).toBe("2026-10-02");
    expect(ppDay("2026-10-02T17:00:00Z")).toBe("2026-10-03");
  });

  it("works across month and year ends", () => {
    expect(ppDay("2026-12-31T18:00:00Z")).toBe("2027-01-01");
    expect(ppDay("2026-09-30T20:00:00Z")).toBe("2026-10-01");
  });

  it("returns an empty string for a missing or invalid timestamp", () => {
    expect(ppDay(null)).toBe("");
    expect(ppDay(undefined)).toBe("");
    expect(ppDay("")).toBe("");
    expect(ppDay("not a date")).toBe("");
  });

  it("builds day bounds that are exactly one Cambodia day", () => {
    expect(new Date(ppDayStart("2026-10-02")).toISOString()).toBe("2026-10-01T17:00:00.000Z");
    expect(new Date(ppDayEnd("2026-10-02")).toISOString()).toBe("2026-10-02T16:59:59.999Z");
  });

  it("ppToday is a YYYY-MM-DD date", () => {
    expect(ppToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
