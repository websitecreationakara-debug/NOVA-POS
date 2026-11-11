import { describe, expect, it } from "vitest";
import { expiryStatus } from "./expiry";

const TODAY = "2026-11-11";
const tier = (text: string) => expiryStatus(text, TODAY)?.tier;

describe("expiryStatus", () => {
  it("marks a passed date as expired", () => {
    expect(expiryStatus("2026-11-10", TODAY)).toMatchObject({ tier: "expired", days: -1 });
  });

  it("warns at 1 week, 2 weeks and 1 month", () => {
    expect(tier("2026-11-18")).toBe("week"); // 7 days
    expect(tier("2026-11-11")).toBe("week"); // today
    expect(tier("2026-11-19")).toBe("two_weeks"); // 8 days
    expect(tier("2026-11-25")).toBe("two_weeks"); // 14 days
    expect(tier("2026-11-26")).toBe("month"); // 15 days
    expect(tier("2026-12-11")).toBe("month"); // 30 days
    expect(tier("2026-12-12")).toBeNull(); // 31 days
  });

  it("reads the spellings found in the ledger", () => {
    expect(expiryStatus("2026.11.15", TODAY)?.date).toBe("2026-11-15");
    expect(expiryStatus("2026.11.5", TODAY)?.date).toBe("2026-11-05");
    expect(expiryStatus("26.10.2026", TODAY)?.date).toBe("2026-10-26"); // day.month.year
    expect(expiryStatus("25/10/2026", TODAY)?.date).toBe("2026-10-25"); // day/month (25 can't be a month)
    expect(expiryStatus("10/25/2026", TODAY)?.date).toBe("2026-10-25"); // month/day
  });

  it("counts a month with no day to its last day", () => {
    expect(expiryStatus("11/2026", TODAY)).toMatchObject({ date: "2026-11-30", tier: "month" });
    expect(expiryStatus("Nov-2026", TODAY)?.date).toBe("2026-11-30");
    expect(expiryStatus("10/26", TODAY)?.date).toBe("2026-10-31");
    expect(tier("10/2026")).toBe("expired");
  });

  it("takes the earlier date when day/month is ambiguous", () => {
    // 03/04/2027 is 3 April or 4 March: the earlier (4 March) is used.
    expect(expiryStatus("03/04/2027", TODAY)?.date).toBe("2027-03-04");
  });

  it("gives no warning for text that isn't a date", () => {
    for (const t of ["", "N/A", "6-7/2026", "03/04/05/2026", "31/02/2026", "soon"]) expect(expiryStatus(t, TODAY)).toBeNull();
  });
});
