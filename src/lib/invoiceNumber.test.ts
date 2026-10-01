import { describe, expect, it } from "vitest";
import { formatInvoiceNumber } from "./invoiceNumber";

describe("formatInvoiceNumber", () => {
  it("numbers the first order of the month -1", () => {
    expect(formatInvoiceNumber("2026-10-01T05:02:00.000Z", 1)).toBe("202610-1");
  });

  it("counts up through the month", () => {
    expect(formatInvoiceNumber("2026-10-15T05:02:00.000Z", 2)).toBe("202610-2");
    expect(formatInvoiceNumber("2026-10-15T05:02:00.000Z", 12)).toBe("202610-12");
  });

  it("uses the Phnom Penh month (UTC+7), not the UTC one", () => {
    // 2026-09-30 18:00 UTC is already 1 Oct 01:00 in Phnom Penh.
    expect(formatInvoiceNumber("2026-09-30T18:00:00.000Z", 1)).toBe("202610-1");
  });

  it("has no number for an unpaid order", () => {
    expect(formatInvoiceNumber(null, 1)).toBeNull();
  });
});
