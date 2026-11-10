import { describe, expect, it } from "vitest";
import { findInvoiceDate, findInvoiceNumber, parseInvoiceRow, parseInvoiceText } from "./invoiceOcr";

describe("parseInvoiceRow", () => {
  it("reads name, quantity and unit price from a row with a line total", () => {
    expect(parseInvoiceRow("1 YTS001a Chamomile Houji-cha 2g box 10 12.50 125.00")).toEqual({
      sku: "YTS001a",
      name: "Chamomile Houji-cha 2g",
      unit: "box",
      packing: "",
      quantity: 10,
      unitCost: 12.5,
    });
  });

  it("uses the quantity and price whose product is the line total", () => {
    const row = parseInvoiceRow("Brown rice tea 150g 24 3.00 0 72.00");
    expect(row).toMatchObject({ quantity: 24, unitCost: 3 });
  });

  it("handles thousands separators", () => {
    expect(parseInvoiceRow("Salmon fillet 2 1,200.00 2,400.00")).toMatchObject({ quantity: 2, unitCost: 1200 });
  });

  it("skips totals, tax and header rows", () => {
    expect(parseInvoiceRow("Subtotal 3 200.00")).toBeNull();
    expect(parseInvoiceRow("Total 1 250.00 250.00")).toBeNull();
    expect(parseInvoiceRow("Invoice No: 12345 2026")).toBeNull();
  });

  it("skips a row with no numbers to read", () => {
    expect(parseInvoiceRow("Thank you for your business")).toBeNull();
  });
});

describe("invoice header", () => {
  it("finds a day-first date", () => {
    expect(findInvoiceDate("Date: 02/11/2026")).toBe("2026-11-02");
    expect(findInvoiceDate("Invoice date 2026-11-02")).toBe("2026-11-02");
    expect(findInvoiceDate("5 Nov 2026")).toBe("2026-11-05");
  });

  it("finds the invoice number", () => {
    expect(findInvoiceNumber("Invoice No: INV-000673")).toBe("INV-000673");
    expect(findInvoiceNumber("INVOICE #2026/55")).toBe("2026/55");
    expect(findInvoiceNumber("TAX INVOICE")).toBe("");
  });

  it("reads a whole invoice", () => {
    const inv = parseInvoiceText(
      ["ACME Foods Co., Ltd", "TAX INVOICE", "Invoice No: A-1001", "Date: 03/11/2026", "1 Matcha latte box 5 4.00 20.00", "Total 20.00"].join("\n")
    );
    expect(inv).toMatchObject({ supplierName: "ACME Foods Co., Ltd", invoiceNumber: "A-1001", invoiceDate: "2026-11-03" });
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0]).toMatchObject({ name: "Matcha latte", unit: "box", quantity: 5, unitCost: 4 });
  });
});

import { parsePastedInvoice, parsePastedTable } from "./invoiceOcr";

describe("pasted tables", () => {
  const markdown = [
    "| NO. | SKU | DESCRIPTION | PACKING | UNIT | Q. | UNIT PRICE | AMOUNT |",
    "|---|---|---|---|---|---|---|---|",
    "| 1 | BU041a | Umesyu Reasonable | (2L) | Bottle | 1.00 | $ 12.23 | $ 12.23 |",
    "| 2 | SO008a | Frozen Snow Crab Surimi (500g) | pkt | pkt | 2.00 | $ 5.28 | $ 10.56 |",
    "| | | SUB TOTAL | | | | | $ 22.79 |",
  ].join("\n");

  it("reads a markdown table, treating Q. as the quantity", () => {
    expect(parsePastedTable(markdown)).toEqual([
      { sku: "BU041a", name: "Umesyu Reasonable", unit: "Bottle", packing: "(2L)", quantity: 1, unitCost: 12.23 },
      { sku: "SO008a", name: "Frozen Snow Crab Surimi (500g)", unit: "pkt", packing: "pkt", quantity: 2, unitCost: 5.28 },
    ]);
  });

  it("reads a tab-separated table and takes the price from Amount when there is none", () => {
    const tsv = ["Description\tQ.\tAmount", "Salmon\t4\t$ 20.00", "Total\t\t$ 20.00"].join("\n");
    expect(parsePastedTable(tsv)).toEqual([{ sku: "", name: "Salmon", unit: "", packing: "", quantity: 4, unitCost: 5 }]);
  });

  it("also finds the invoice number and date in the pasted text", () => {
    const inv = parsePastedInvoice(`Invoice No: 26012392\nInvoice Date: 02/Oct/2026\n${markdown}`);
    expect(inv).toMatchObject({ invoiceNumber: "26012392", invoiceDate: "2026-10-02" });
    expect(inv.lines).toHaveLength(2);
  });
});

describe("rows laid out like the supplier's invoice (NO. SKU DESCRIPTION PACKING UNIT Q. UNIT PRICE AMOUNT)", () => {
  it("reads a row whose prices have a separate $", () => {
    expect(parseInvoiceRow("1 BU041a Umesyu Reasonable (2L) Bottle 1.00 $ 12.23 $ 12.23")).toEqual({
      sku: "BU041a",
      name: "Umesyu Reasonable",
      unit: "Bottle",
      packing: "(2L)",
      quantity: 1,
      unitCost: 12.23,
    });
  });

  it("keeps a size in the description and reads the packing and unit after it", () => {
    expect(parseInvoiceRow("2 SO008a Frozen Snow Crab Surimi (500g) pkt pkt 2.00 $ 5.28 $ 10.56")).toEqual({
      sku: "SO008a",
      name: "Frozen Snow Crab Surimi (500g)",
      unit: "pkt",
      packing: "pkt",
      quantity: 2,
      unitCost: 5.28,
    });
  });

  it("does not take the header row as a product", () => {
    expect(parseInvoiceRow("NO. SKU DESCRIPTION PACKING UNIT Q. UNIT PRICE AMOUNT")).toBeNull();
  });
});

describe("OCR slips", () => {
  it("puts back decimal points the OCR dropped when the row then adds up", () => {
    expect(parseInvoiceRow("1 BU041a Umesyu Reasonable (2L) Bottle 1.00 $1223 $12.23")).toMatchObject({ quantity: 1, unitCost: 12.23 });
    expect(parseInvoiceRow("2 SO008a Frozen Snow Crab Surimi (500g) pkt pkt 200 $5.28 $ 10.56")).toMatchObject({ quantity: 2, unitCost: 5.28 });
    expect(parseInvoiceRow("3 KP012b Matcha Powder 100g bag bag 300 $850 $ 25.50")).toMatchObject({ quantity: 3, unitCost: 8.5 });
  });

  it("leaves a row that already adds up alone", () => {
    expect(parseInvoiceRow("Sea salt 200 5.28 1,056.00")).toMatchObject({ quantity: 200, unitCost: 5.28 });
  });

  it("reads Oct when the OCR writes it with a zero", () => {
    expect(findInvoiceDate("Invoice Date: 02/0ct/2026")).toBe("2026-10-02");
  });

  it("does not take the buyer's company line as the supplier", () => {
    const inv = parseInvoiceText("INVOICE\nCompany Name: BOSBA Premium Foods\nInvoice No: 26012392");
    expect(inv.supplierName).toBe("");
  });
});
