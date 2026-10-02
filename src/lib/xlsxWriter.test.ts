import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildXlsx } from "./xlsxWriter";
import { buildOrdersSheet, type BackupItem, type BackupOrder } from "./ordersCsv";

// Reads the zip back with Node's own inflate, independent of the writer.
function unzip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(pos)).toBe(0x02014b50);
    const csize = buf.readUInt32LE(pos + 20);
    const usize = buf.readUInt32LE(pos + 24);
    const nlen = buf.readUInt16LE(pos + 28);
    const local = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nlen).toString("utf8");
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const text = inflateRawSync(buf.subarray(dataStart, dataStart + csize)).toString("utf8");
    expect(Buffer.byteLength(text)).toBe(usize);
    out[name] = text;
    pos += 46 + nlen;
  }
  return out;
}

describe("buildXlsx", () => {
  const file = unzip(
    buildXlsx(
      "Orders",
      [
        { header: "Phone", width: 16, kind: "text" },
        { header: "When", width: 20, kind: "datetime" },
        { header: "Total", width: 10, kind: "money" },
        { header: "Name", width: 20, kind: "text" },
      ],
      [["855966775963", 46297.5486, 96.5, "សុខ & <ដារ៉ា>"]]
    )
  );

  it("contains the parts of a workbook", () => {
    expect(Object.keys(file).sort()).toEqual(
      [
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/_rels/workbook.xml.rels",
        "xl/styles.xml",
        "xl/workbook.xml",
        "xl/worksheets/sheet1.xml",
      ].sort()
    );
    expect(file["xl/workbook.xml"]).toContain('name="Orders"');
  });

  it("stores a phone number as text, so Excel cannot turn it into 8.55967E+11", () => {
    expect(file["xl/worksheets/sheet1.xml"]).toContain(
      '<c r="A2" s="4" t="inlineStr"><is><t xml:space="preserve">855966775963</t></is></c>'
    );
  });

  it("stores a date as a number with the date format, and money with two decimals", () => {
    const sheet = file["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain('<c r="B2" s="2"><v>46297.5486</v></c>');
    expect(sheet).toContain('<c r="C2" s="3"><v>96.5</v></c>');
    expect(file["xl/styles.xml"]).toContain('formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"');
  });

  it("keeps Khmer as real text and escapes XML characters", () => {
    expect(file["xl/worksheets/sheet1.xml"]).toContain("សុខ &amp; &lt;ដារ៉ា&gt;");
  });

  it("sets a width for every column, a bold frozen header and filter buttons", () => {
    const sheet = file["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain('<col min="1" max="1" width="16" customWidth="1"/>');
    expect(sheet).toContain('<col min="2" max="2" width="20" customWidth="1"/>');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<autoFilter ref="A1:D2"/>');
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr">');
  });
});

describe("buildOrdersSheet", () => {
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
    customer_phone: "012795200",
    customer_email: null,
    customers: { address: "Street 352" },
    payment_method: "khqr",
    payment_reference: null,
    subtotal: 95,
    discount: 0,
    tax: 0,
    delivery_fee: 1.5,
    total: 96.5,
    delivery_at: null,
    note: null,
    ...over,
  });
  const item = (over: Partial<BackupItem>): BackupItem => ({
    order_id: "o1",
    product_id: "p1",
    quantity: 1,
    unit_price: 50,
    line_total: 50,
    size_label: null,
    unit_cost: 20,
    cogs: 20,
    cost_source: "direct",
    products: { name: "Uni Set" },
    ...over,
  });

  const { columns, rows } = buildOrdersSheet([order({})], [item({}), item({ product_id: "p2", products: { name: "Ikura" } })]);
  const col = (name: string) => columns.findIndex((c) => c.header === name);

  it("puts the readable columns first and the ids last", () => {
    expect(columns.slice(0, 5).map((c) => c.header)).toEqual(["Invoice", "Date (Cambodia)", "Business", "Customer", "Phone"]);
    expect(col("Order ID")).toBeGreaterThan(col("Order total"));
    expect(rows.every((r) => r.length === columns.length)).toBe(true);
  });

  it("keeps a phone with a leading zero as text and shows Cambodia time as an Excel date", () => {
    expect(rows[0][col("Phone")]).toBe("012795200");
    expect(columns[col("Phone")].kind).toBe("text");
    // 2026-10-02 13:09:59 in Phnom Penh -> serial 46297 + 13:09:59 of the day
    expect(rows[0][col("Date (Cambodia)")] as number).toBeCloseTo(46297 + (13 * 3600 + 9 * 60 + 59) / 86400, 5);
  });

  it("writes the order's money on its first row only, so a column adds up correctly", () => {
    expect(rows[0][col("Order total")]).toBe(96.5);
    expect(rows[1][col("Order total")]).toBeNull();
    const totals = rows.reduce((sum, r) => sum + ((r[col("Order total")] as number | null) ?? 0), 0);
    expect(totals).toBe(96.5);
    // but each product keeps its own line figures
    expect(rows[0][col("Product")]).toBe("Uni Set");
    expect(rows[1][col("Product")]).toBe("Ikura");
    expect(rows[1][col("Line total")]).toBe(50);
  });
});
