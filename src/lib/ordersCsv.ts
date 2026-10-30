import { formatInvoiceNumber, invoiceMonthStamp } from "./invoiceNumber";
import { ppDay } from "./phnomPenhTime";
import type { XlsxCell, XlsxColumn } from "./xlsxWriter";

// Builds the Orders backup CSV: normally one row per order LINE (an order with several
// products repeats its order columns on each row, and an order with no lines
// still gets one row), so the file opens as a flat table in Excel and every
// field of an order survives -- including the order id, to match rows back up
// to the database later.

export type BackupOrder = {
  id: string;
  invoice_number: string | null;
  paid_at: string | null;
  // The date the Orders list shows and filters by (a Pre-Order keeps its own date).
  list_at?: string | null;
  created_at: string;
  status: string;
  fulfillment_status: string;
  brand_id: string;
  brands: { name: string } | null;
  channel: string;
  site: string | null;
  site_order_id: string | null;
  order_source: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customers: { address: string | null } | null;
  payment_method: string | null;
  payment_reference: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  delivery_fee: number;
  total: number;
  delivery_at: string | null;
  note: string | null;
};

export type BackupItem = {
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  size_label: string | null;
  unit_cost: number | null;
  cogs: number | null;
  cost_source: string | null;
  products: { name: string } | null;
};

const HEADERS = [
  "order_id",
  "invoice_number",
  "paid_at_cambodia",
  "invoice_date",
  "status",
  "fulfillment_status",
  "business",
  "channel",
  "site",
  "site_order_id",
  "order_source",
  "customer_name",
  "customer_phone",
  "customer_email",
  "customer_address",
  "payment_method",
  "payment_reference",
  "subtotal",
  "discount",
  "tax",
  "delivery_fee",
  "total",
  "delivery_at_cambodia",
  "note",
] as const;

const ITEM_HEADERS = [
  "product_id",
  "product_name",
  "size",
  "quantity",
  "unit_price",
  "line_total",
  "unit_cost",
  "cogs",
  "cost_source",
] as const;

export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// A phone made only of digits (optionally a leading +) is written as ="855..." so Excel keeps it as
// text: otherwise it shows long numbers as 8.55965E+11 and drops leading zeros.
function csvPhone(phone: string | null): string {
  const p = (phone ?? "").trim();
  return /^\+?\d+$/.test(p) ? `="${p}"` : p;
}

// "2026-10-02 13:09:59" -- an instant as wall-clock time at a UTC offset in hours
// (Phnom Penh is +7 all year, no daylight saving). "" for a missing/invalid
// timestamp. Excel reads this as a date and shows it in the computer's own date style.
function wallTime(iso: string | null, offsetHours: number): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return new Date(ms + offsetHours * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

const cambodiaTime = (iso: string | null) => wallTime(iso, 7);

// The date-based invoice numbers (YYYYMM-N, see invoiceNumber.ts): an order's N
// is its position among all paid orders of its Phnom Penh month, oldest first.
function invoiceNumbers(orders: BackupOrder[]): Map<string, string> {
  const paid = orders
    .filter((o) => o.status === "paid" && o.paid_at)
    .sort((a, b) => (a.paid_at! < b.paid_at! ? -1 : a.paid_at! > b.paid_at! ? 1 : a.id < b.id ? -1 : 1));
  const counters = new Map<string, number>();
  const out = new Map<string, string>();
  for (const o of paid) {
    const stamp = invoiceMonthStamp(o.paid_at!);
    const n = (counters.get(stamp) ?? 0) + 1;
    counters.set(stamp, n);
    out.set(o.id, formatInvoiceNumber(o.paid_at, n) ?? "");
  }
  return out;
}

// Only the orders whose Orders-list date (Phnom Penh day) falls in [from, to]; either end may be
// left out. Invoice numbers are worked out first, from every order, since an order's number is its
// place in its whole month -- a partial month would number it wrongly.
export type OrdersRange = { from?: string; to?: string };

export function inRange(o: BackupOrder, range?: OrdersRange): boolean {
  if (!range?.from && !range?.to) return true;
  const day = ppDay(o.list_at ?? o.paid_at ?? o.created_at);
  return (!range.from || day >= range.from) && (!range.to || day <= range.to);
}

// One row per order LINE by default; `withItems: false` gives one row per ORDER with no product
// columns (what the Orders page's CSV button exports).
export function buildOrdersCsv(
  orders: BackupOrder[],
  items: BackupItem[],
  range?: OrdersRange,
  withItems = true
): string {
  const itemsByOrder = new Map<string, BackupItem[]>();
  for (const it of items) {
    const list = itemsByOrder.get(it.order_id) ?? [];
    list.push(it);
    itemsByOrder.set(it.order_id, list);
  }
  const numbers = invoiceNumbers(orders);

  const lines: string[] = [(withItems ? [...HEADERS, ...ITEM_HEADERS] : HEADERS).join(",")];
  const newestFirst = orders.filter((o) => inRange(o, range)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  for (const o of newestFirst) {
    const orderCells = [
      o.id,
      numbers.get(o.id) ?? "",
      cambodiaTime(o.paid_at),
      cambodiaTime(o.created_at),
      o.status,
      o.fulfillment_status,
      o.brands?.name ?? "",
      o.channel,
      o.site ?? "",
      o.site_order_id ?? "",
      o.order_source ?? "",
      o.customer_name ?? "",
      csvPhone(o.customer_phone),
      o.customer_email ?? "",
      o.customers?.address ?? "",
      o.payment_method ?? "",
      o.payment_reference ?? "",
      o.subtotal,
      o.discount,
      o.tax,
      o.delivery_fee,
      o.total,
      cambodiaTime(o.delivery_at),
      o.note ?? "",
    ];
    if (!withItems) {
      lines.push(orderCells.map(csvCell).join(","));
      continue;
    }
    const orderItems = itemsByOrder.get(o.id) ?? [];
    const rows = orderItems.length
      ? orderItems.map((it) => [
          it.product_id,
          it.products?.name ?? "",
          it.size_label ?? "",
          it.quantity,
          it.unit_price,
          it.line_total,
          it.unit_cost ?? "",
          it.cogs ?? "",
          it.cost_source ?? "",
        ])
      : [["", "", "", "", "", "", "", "", ""]];
    for (const itemCells of rows) lines.push([...orderCells, ...itemCells].map(csvCell).join(","));
  }
  // A leading byte-order mark makes Excel read the file as UTF-8, so Khmer names
  // don't turn into garbage; CRLF line endings are what Excel expects.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// An instant as an Excel date serial in Cambodia wall-clock time (UTC+7): whole
// days since 1899-12-30, the time of day as the fraction. Excel keeps no time
// zone, so this is the number that makes it show 2026-10-02 13:09:59.
function cambodiaSerial(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return (ms + 7 * 60 * 60 * 1000) / 86_400_000 + 25569;
}

// The readable version of the backup, for the Excel (.xlsx) file: the columns a
// person looks at first, in plain English, then the technical ones (ids,
// website references) at the end. An order's money (subtotal, discount, delivery,
// total) is written on the FIRST row of that order only, so adding up a column
// doesn't count an order once per product; the CSV keeps every column on every row.
export function buildOrdersSheet(
  orders: BackupOrder[],
  items: BackupItem[],
  range?: OrdersRange
): { columns: XlsxColumn[]; rows: XlsxCell[][] } {
  const columns: XlsxColumn[] = [
    { header: "Invoice", width: 12, kind: "text" },
    { header: "Date (Cambodia)", width: 20, kind: "datetime" },
    { header: "Business", width: 22, kind: "text" },
    { header: "Customer", width: 22, kind: "text" },
    { header: "Phone", width: 16, kind: "text" },
    { header: "Address", width: 36, kind: "text" },
    { header: "Status", width: 11, kind: "text" },
    { header: "Delivery status", width: 15, kind: "text" },
    { header: "Paid by", width: 12, kind: "text" },
    { header: "Ordered via", width: 18, kind: "text" },
    { header: "Delivery time (Cambodia)", width: 20, kind: "datetime" },
    { header: "Note", width: 30, kind: "text" },
    { header: "Product", width: 42, kind: "text" },
    { header: "Size", width: 9, kind: "text" },
    { header: "Qty", width: 8, kind: "number" },
    { header: "Unit price", width: 11, kind: "money" },
    { header: "Line total", width: 11, kind: "money" },
    { header: "Unit cost", width: 11, kind: "money" },
    { header: "Line cost", width: 11, kind: "money" },
    { header: "Order subtotal", width: 12, kind: "money" },
    { header: "Order discount", width: 12, kind: "money" },
    { header: "Order delivery fee", width: 12, kind: "money" },
    { header: "Order total", width: 12, kind: "money" },
    // ---- technical, at the end ----
    { header: "Order ID", width: 38, kind: "text" },
    { header: "Created at (Cambodia)", width: 20, kind: "datetime" },
    { header: "Customer email", width: 24, kind: "text" },
    { header: "Payment reference", width: 20, kind: "text" },
    { header: "Website", width: 16, kind: "text" },
    { header: "Website order ID", width: 20, kind: "text" },
    { header: "Product ID", width: 38, kind: "text" },
    { header: "Cost source", width: 11, kind: "text" },
    { header: "Tax", width: 8, kind: "money" },
  ];

  const itemsByOrder = new Map<string, BackupItem[]>();
  for (const it of items) {
    const list = itemsByOrder.get(it.order_id) ?? [];
    list.push(it);
    itemsByOrder.set(it.order_id, list);
  }
  const numbers = invoiceNumbers(orders);

  const rows: XlsxCell[][] = [];
  const newestFirst = orders.filter((o) => inRange(o, range)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  for (const o of newestFirst) {
    const orderedVia = o.channel === "online" ? `Website ${o.site ?? ""}`.trim() : (o.order_source ?? "");
    const lines = itemsByOrder.get(o.id) ?? [];
    const lineRows: (BackupItem | null)[] = lines.length ? lines : [null];
    lineRows.forEach((it, index) => {
      const first = index === 0;
      rows.push([
        numbers.get(o.id) ?? "",
        cambodiaSerial(o.paid_at),
        o.brands?.name ?? "",
        o.customer_name ?? "",
        o.customer_phone ?? "",
        o.customers?.address ?? "",
        o.status,
        o.fulfillment_status,
        o.payment_method ?? "",
        orderedVia,
        cambodiaSerial(o.delivery_at),
        o.note ?? "",
        it?.products?.name ?? "",
        it?.size_label ?? "",
        it ? it.quantity : null,
        it ? it.unit_price : null,
        it ? it.line_total : null,
        it?.unit_cost ?? null,
        it?.cogs ?? null,
        first ? o.subtotal : null,
        first ? o.discount : null,
        first ? o.delivery_fee : null,
        first ? o.total : null,
        o.id,
        cambodiaSerial(o.created_at),
        o.customer_email ?? "",
        o.payment_reference ?? "",
        o.site ?? "",
        o.site_order_id ?? "",
        it?.product_id ?? "",
        it?.cost_source ?? "",
        first ? o.tax : null,
      ]);
    });
  }
  return { columns, rows };
}
