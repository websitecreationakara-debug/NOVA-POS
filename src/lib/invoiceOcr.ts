// Turns the text OCR read off a photo of a supplier's invoice into a form-ready invoice: who it is from, its
// number and date, and one line per product row (SKU, description, unit, quantity, unit price). OCR text is
// messy, so this only keeps what it can read with some confidence; the person checks everything before saving.

export type ParsedInvoice = {
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  lines: { sku: string; name: string; unit: string; packing?: string; quantity: number | null; unitCost: number | null }[];
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NUMBER = /^[$៛]?\d[\d,]*(?:\.\d+)?$/;
const SKIP_ROW = /\b(sub\s*-?\s*total|total|tax|vat|discount|delivery|shipping|balance|amount|paid|payment|cash|change|deposit|invoice|bill\s*to|ship\s*to|tel|phone|address|date|due)\b/i;
const UNITS = /^(pcs?|box(es)?|cases?|ctn|carton|btl|bottles?|kg|g|pkt|packs?|bags?|cans?|tray|set)$/i;
const SKU = /^[A-Za-z]{1,5}\d{2,}[A-Za-z]?$/;

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : "");

// The first date in the text, preferring one on a line that says "date". Day first (dd/mm/yyyy), as is usual here.
export function findInvoiceDate(text: string): string {
  const lines = text.split(/\r?\n/);
  const ordered = [...lines.filter((l) => /date/i.test(l)), ...lines];
  for (const line of ordered) {
    let m = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(line);
    if (m) {
      const d = iso(Number(m[1]), Number(m[2]), Number(m[3]));
      if (d) return d;
    }
    m = /\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b/.exec(line);
    if (m) {
      const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      let day = Number(m[1]);
      let month = Number(m[2]);
      if (month > 12 && day <= 12) [day, month] = [month, day];
      const d = iso(year, month, day);
      if (d) return d;
    }
    m = /\b(\d{1,2})\s*[-/.\s]\s*([A-Za-z0]{3})[a-z]*\.?,?\s*[-/.\s]?\s*(20\d{2})\b/.exec(line);
    if (m) {
      // OCR often reads the letter O of Oct / Nov as the digit 0.
      const month = MONTHS.indexOf(m[2].toLowerCase().replace(/0/g, "o")) + 1;
      const d = month ? iso(Number(m[3]), month, Number(m[1])) : "";
      if (d) return d;
    }
  }
  return "";
}

export function findInvoiceNumber(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const m = /\b(?:invoice|inv)\b\s*(?:no\.?|number|num|#)?\s*[:#.-]?\s*([A-Z0-9][A-Z0-9\-/]{2,})/i.exec(line);
    if (m && /\d/.test(m[1])) return m[1];
  }
  return "";
}

const toNumber = (token: string) => Number(token.replace(/[$៛,]/g, ""));
const closeEnough = (qty: number, price: number, total: number) => Math.abs(qty * price - total) <= Math.max(0.02 * total, 0.02);

// OCR often drops the decimal point ("12.23" read as "1223", "2.00" as "200"). When the last three numbers of a row
// (quantity, unit price, line total) don't multiply out, the smallest set of whole numbers that become right when
// divided by 100 is put back; a row that already adds up is left alone.
function recoverDecimals(nums: number[], raws: string[]): void {
  const n = nums.length;
  if (n < 3) return;
  const at = [n - 3, n - 2, n - 1];
  if (closeEnough(nums[at[0]], nums[at[1]], nums[at[2]])) return;
  const eligible = at.map((i) => !raws[i].includes(".") && raws[i].replace(/\D/g, "").length >= 3);
  let best = 0;
  let bestFlags = 99;
  for (let mask = 1; mask < 8; mask++) {
    const flagged = [0, 1, 2].filter((b) => mask & (1 << b));
    if (flagged.some((b) => !eligible[b])) continue;
    const v = at.map((i, b) => (mask & (1 << b) ? nums[i] / 100 : nums[i]));
    if (closeEnough(v[0], v[1], v[2]) && flagged.length < bestFlags) {
      best = mask;
      bestFlags = flagged.length;
    }
  }
  if (best === 0) return;
  at.forEach((i, b) => {
    if (best & (1 << b)) nums[i] = nums[i] / 100;
  });
}

// One product row: name, then numbers at the end (quantity, unit price, and usually the line total).
export function parseInvoiceRow(line: string): ParsedInvoice["lines"][number] | null {
  const clean = line.replace(/[|_]/g, " ").trim();
  if (!/[A-Za-z]{2}/.test(clean) || SKIP_ROW.test(clean)) return null;
  const tokens = clean.split(/\s+/);
  const nums: number[] = [];
  const raws: string[] = [];
  // Numbers at the end of the row; a "$" (or an OCR-misread "S") standing alone before a number is just its symbol.
  while (tokens.length > 1 && nums.length < 4) {
    const last = tokens[tokens.length - 1];
    if (/^[$៛]$|^S$/.test(last)) tokens.pop();
    else if (NUMBER.test(last)) {
      raws.unshift(last);
      nums.unshift(toNumber(tokens.pop() as string));
    } else break;
  }
  if (nums.length < 2) return null;
  recoverDecimals(nums, raws);

  let quantity = nums[0];
  let unitCost = nums[1];
  // With a line total, pick the quantity and price whose product is that total.
  for (let end = nums.length; end >= 3; end--) {
    const [q, p, t] = nums.slice(end - 3, end);
    if (closeEnough(q, p, t)) {
      quantity = q;
      unitCost = p;
      break;
    }
  }
  if (!(quantity > 0) || !(unitCost >= 0)) return null;

  const head = [...tokens];
  if (head.length > 1 && /^\d{1,3}[.)]?$/.test(head[0])) head.shift();
  // The unit of measure sits last; the packing, if there is one, is just before it ("(2L) Bottle", "pkt pkt").
  let unit = "";
  let packing = "";
  if (head.length > 1 && UNITS.test(head[head.length - 1])) {
    unit = head.pop() as string;
    const before = head[head.length - 1];
    if (head.length > 1 && before && (UNITS.test(before) || /^\(.+\)$/.test(before))) packing = head.pop() as string;
  }
  let sku = "";
  const skuAt = head.findIndex((t) => SKU.test(t));
  if (skuAt >= 0 && head.length > 1) sku = head.splice(skuAt, 1)[0];
  const name = head.join(" ").trim();
  if (name.replace(/[^A-Za-z]/g, "").length < 2) return null;
  return { sku, name, unit, packing, quantity, unitCost };
}

export function parseInvoiceText(text: string): ParsedInvoice {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const supplierName =
    rows
      .find(
        (l) =>
          /[A-Za-z]{3}/.test(l) &&
          !/^(tax\s+)?invoice\b|^bill\b|^page\b|^(company name|customer|attn|address|phone|to\b|ship|deliver|sold to)|description|unit price|\bsku\b|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/i.test(l)
      )
      ?.slice(0, 120) ?? "";
  return {
    supplierName,
    invoiceNumber: findInvoiceNumber(text),
    invoiceDate: findInvoiceDate(text),
    lines: rows.map(parseInvoiceRow).filter((l): l is ParsedInvoice["lines"][number] => l !== null),
  };
}

// ---- Pasted tables (copied from a chat, a spreadsheet or a PDF) ----------------------------------------------
// A pasted table has a header row, so each number goes to the column the header names -- "Q." and "Qty" are the
// quantity, "Unit Price" the price, "Amount" the line total -- instead of being guessed from its position.

type Column = "no" | "sku" | "name" | "packing" | "unit" | "qty" | "price" | "amount";

function columnOf(header: string): Column | null {
  const h = header.toLowerCase().replace(/[^a-z0-9/# ]/g, " ").replace(/\s+/g, " ").trim();
  if (!h) return null;
  if (/^(no|#|item no|line)$/.test(h)) return "no";
  if (/^(sku|code|item code|product code|barcode)$/.test(h)) return "sku";
  if (/^(description|desc|item|product|name|particulars|item name|product name)$/.test(h)) return "name";
  if (/^(packing|pack|pack size|size)$/.test(h)) return "packing";
  if (/^(unit price|price|u p|u\/p|rate|unit cost|cost|price unit)$/.test(h)) return "price";
  if (/^(q|qty|quantity|qnty|q ty|qt|pcs quantity|order qty)$/.test(h)) return "qty";
  if (/^(unit|uom)$/.test(h)) return "unit";
  if (/^(amount|total|amt|line total|sub total)$/.test(h)) return "amount";
  return null;
}

function splitCells(line: string, delimiter: string): string[] {
  const cells = line.split(delimiter).map((c) => c.trim());
  if (delimiter === "|") {
    if (cells[0] === "") cells.shift();
    if (cells[cells.length - 1] === "") cells.pop();
  }
  return cells;
}

const cellNumber = (cell: string | undefined): number | null => {
  if (!cell) return null;
  const n = Number(cell.replace(/[^0-9.\-]/g, ""));
  return cell.trim() !== "" && Number.isFinite(n) && /\d/.test(cell) ? n : null;
};

export function parsePastedTable(text: string): ParsedInvoice["lines"] {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^\|?[\s:|-]+\|?$/.test(l));
  const delimiter = rows.some((l) => l.includes("\t")) ? "\t" : rows.filter((l) => l.includes("|")).length >= 2 ? "|" : null;
  if (!delimiter) return [];

  let columns: (Column | null)[] | null = null;
  const lines: ParsedInvoice["lines"] = [];
  for (const row of rows) {
    const cells = splitCells(row, delimiter);
    if (cells.length < 2) continue;
    const named = cells.map(columnOf);
    if (!columns && named.includes("qty") && (named.includes("name") || named.includes("price"))) {
      columns = named;
      continue;
    }
    if (!columns) continue;
    const at = (c: Column) => {
      const i = columns!.indexOf(c);
      return i >= 0 ? cells[i] : undefined;
    };
    const name = (at("name") ?? "").trim();
    const quantity = cellNumber(at("qty"));
    let unitCost = cellNumber(at("price"));
    const amount = cellNumber(at("amount"));
    if (unitCost === null && amount !== null && quantity) unitCost = Math.round((amount / quantity) * 100) / 100;
    if (!name || SKIP_ROW.test(name) || quantity === null || quantity <= 0 || unitCost === null || unitCost < 0) continue;
    lines.push({ sku: (at("sku") ?? "").trim(), name, unit: (at("unit") ?? "").trim(), packing: (at("packing") ?? "").trim(), quantity, unitCost });
  }
  return lines;
}

// A pasted invoice: a table (with a header row) if there is one, else rows read like OCR text. The invoice number
// and date are taken from anywhere in the text.
export function parsePastedInvoice(text: string): ParsedInvoice {
  const table = parsePastedTable(text);
  const base = parseInvoiceText(text);
  return table.length > 0 ? { ...base, lines: table } : base;
}
