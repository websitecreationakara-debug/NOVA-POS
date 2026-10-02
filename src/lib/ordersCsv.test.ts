import { describe, expect, it } from "vitest";
import { buildOrdersCsv, csvCell, type BackupItem, type BackupOrder } from "./ordersCsv";

const order = (over: Partial<BackupOrder>): BackupOrder => ({
  id: "o1",
  invoice_number: "INV-000001",
  paid_at: "2026-10-02T06:09:59.000Z",
  created_at: "2026-10-02T06:09:59.000Z",
  status: "paid",
  fulfillment_status: "new_order",
  brand_id: "b1",
  brands: { name: "BOSBA Premium Foods" },
  channel: "pos",
  site: null,
  site_order_id: null,
  order_source: "telegram",
  customer_name: "Pink",
  customer_phone: "85512345678",
  customer_email: null,
  customers: { address: "Street 352, 1" },
  payment_method: "khqr",
  payment_reference: null,
  subtotal: 95,
  discount: 0,
  tax: 0,
  delivery_fee: 1.5,
  total: 96.5,
  delivery_at: "2026-10-02T05:00:00.000Z",
  note: null,
  ...over,
});

const item = (over: Partial<BackupItem>): BackupItem => ({
  order_id: "o1",
  product_id: "p1",
  quantity: 1,
  unit_price: 95,
  line_total: 95,
  size_label: null,
  unit_cost: 48.24,
  cogs: 48.24,
  cost_source: "direct",
  products: { name: "Fresh Sea Urchin Uni Set (100g)" },
  ...over,
});

const parse = (csv: string) => csv.replace(/^﻿/, "").trimEnd().split("\r\n");

describe("csvCell", () => {
  it("quotes values with commas, quotes or line breaks, and leaves plain ones alone", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(0)).toBe("0");
  });
});

describe("buildOrdersCsv", () => {
  it("starts with a UTF-8 byte-order mark and a header row", () => {
    const csv = buildOrdersCsv([], []);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(parse(csv)[0].startsWith("order_id,invoice_number,")).toBe(true);
    expect(parse(csv)).toHaveLength(1);
  });

  it("writes one row per item, repeating the order's columns", () => {
    const csv = buildOrdersCsv(
      [order({})],
      [item({}), item({ product_id: "p2", products: { name: "Salmon Roe Ikura (250g)" }, unit_price: 45, line_total: 45 })]
    );
    const rows = parse(csv);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain("Fresh Sea Urchin Uni Set (100g)");
    expect(rows[2]).toContain("Salmon Roe Ikura (250g)");
    // both rows carry the same order id and customer
    expect(rows[1].split(",")[0]).toBe("o1");
    expect(rows[2].split(",")[0]).toBe("o1");
    expect(rows[1]).toContain("Pink");
  });

  it("shows the date-based invoice number and the time in Cambodia", () => {
    const rows = parse(buildOrdersCsv([order({})], [item({})]));
    // 06:09:59 UTC = 13:09:59 in Phnom Penh; first paid order of Oct 2026
    expect(rows[1]).toContain("202610-1");
    expect(rows[1]).toContain("2026-10-02 13:09:59");
    expect(rows[1]).toContain("INV-000001");
  });

  it("numbers invoices oldest-first within each Cambodia month", () => {
    const rows = parse(
      buildOrdersCsv(
        [
          order({ id: "late", paid_at: "2026-10-05T01:00:00Z", created_at: "2026-10-05T01:00:00Z", invoice_number: null }),
          order({ id: "early", paid_at: "2026-10-01T01:00:00Z", created_at: "2026-10-01T01:00:00Z", invoice_number: null }),
          // 20:00 UTC on Sep 30 is already Oct 1 in Cambodia -> counts as October's 1st
          order({ id: "edge", paid_at: "2026-09-30T20:00:00Z", created_at: "2026-09-30T20:00:00Z", invoice_number: null }),
        ],
        []
      )
    );
    const byId = Object.fromEntries(rows.slice(1).map((r) => [r.split(",")[0], r.split(",")[1]]));
    expect(byId.edge).toBe("202610-1");
    expect(byId.early).toBe("202610-2");
    expect(byId.late).toBe("202610-3");
  });

  it("keeps an order with no items as a single row, and keeps Khmer and commas intact", () => {
    const rows = parse(
      buildOrdersCsv(
        [order({ customer_name: "សុខ, ដារ៉ា", note: 'He said "ok"' })],
        []
      )
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('"សុខ, ដារ៉ា"');
    expect(rows[1]).toContain('"He said ""ok"""');
  });

  it("does not invent an invoice number for an unpaid order", () => {
    const rows = parse(buildOrdersCsv([order({ status: "cancelled", paid_at: null, invoice_number: "INV-000009" })], []));
    expect(rows[1].split(",")[1]).toBe("");
    expect(rows[1]).toContain("INV-000009");
  });
});
