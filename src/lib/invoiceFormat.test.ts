import { describe, expect, it } from "vitest";
import { formatDateTime } from "./invoiceFormat";

describe("invoice date (ថ្ងៃបញ្ជាទិញ)", () => {
  // The same moment the live site printed as 6:09:59 AM: 13:09:59 in Phnom Penh.
  const paidAt = "2026-10-02T06:09:59.000Z";

  it("always prints Phnom Penh time, whatever time zone the server runs in", () => {
    // Run this file with TZ=UTC (the live server) and TZ=Asia/Phnom_Penh (a
    // local one) -- the result must be identical.
    expect(formatDateTime(paidAt)).toBe("10/2/2026, 1:09:59 PM");
  });

  it("puts an early-morning order on its own Cambodia day", () => {
    // 3:19:22 AM Oct 2 in Phnom Penh = 20:19:22 UTC on Oct 1.
    expect(formatDateTime("2026-10-01T20:19:22.000Z")).toBe("10/2/2026, 3:19:22 AM");
  });

  it("prints dots when there is no date", () => {
    expect(formatDateTime(null)).toBe("...");
  });
});
