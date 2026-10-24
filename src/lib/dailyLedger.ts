// The Stock > Daily Ledger: for one business and one month, every product's day-by-day stock --
//   P  purchase in  (stock added by hand, e.g. a delivery typed into the Stock page)
//   S  sale         (units sold; a can pack counts its cans)
//   O  other out    (waste, comps, stock taken back out by hand)
//   R  remaining    (what is left at the end of the day)
// plus the stock at the start of the month and the month's totals.
// R is worked out the way the stock sheet does it: the day before's R (the Begining stock on day 1)
// plus P, minus S and O -- so every row adds up. The Begining stock comes from the stock movement log
// (migration 0074); P, S and O come from the adjustments and the sold lines.
// A day after today is "future": it has no R until something is typed into its P, S or O.
// What the Delete button on a row does -- the same thing Stock's delete does for that kind of product.
//   ledger   a product already out of Stock: just dropped from the ledger
//   pos      a POS-only product: hidden from POS (Stock and Sales)
//   addon    a website add-on: removed from the website
//   product  a whole website product: removed from the website
//   size     one size of a website product that has others: that size is removed from the website
export type LedgerDeletion =
  | { kind: "ledger" }
  | { kind: "pos" }
  | { kind: "addon"; catalogId: string; addonId: string }
  | { kind: "product"; catalogId: string; productId: string }
  | { kind: "size"; catalogId: string; productId: string; variationId: string; sizeLabel: string };

export type LedgerSiteItem = {
  catalogId: string;
  siteProductId: string;
  variationId: string;
  title: string;
  price: number;
  imageUrl: string | null;
  stock: number | null;
};

export type LedgerDay = { p: number; s: number; o: number; r: number | null; future: boolean };

export type DailyLedgerRow = {
  productId: string;
  sku: string | null;
  name: string;
  // The "(24 Cans)" part of a variation's name, shown in its own column.
  size: string;
  unit: string;
  categoryName: string;
  // Which business the row belongs to; set by the page when it lists several businesses at once.
  brandId?: string;
  // What the row's Delete button does.
  deletion: LedgerDeletion;
  // Set on a website product that has no POS product yet: productId is then a placeholder, and the POS
  // product (what ensurePosProductForSiteProduct makes) is created the first time something is typed in.
  site?: LedgerSiteItem;
  // The expiry date typed into the ledger ("12/2026"); empty when none. Nothing else in POS stores one.
  exDate: string;
  // The cells (see LEDGER_FIELDS) whose value was typed into the ledger rather than worked out.
  edited: string[];
  // The product's selling price now.
  unitPrice: number;
  // Stock's Original Cost for a product linked to a website listing, else null -- the sheet's
  // "S-Price LOKA" is that same number.
  originalCost: number | null;
  // Stock's Total Cost 10% for a product linked to a website listing, else null.
  cost10: number | null;
  // What one unit costs (Stock's Total), null when there is none -- Ending value is built from it.
  totalCost: number | null;
  begin: number;
  days: LedgerDay[];
  totalIn: number;
  totalSold: number;
  totalOther: number;
  ending: number;
  // null when the product has no cost recorded.
  endingValue: number | null;
};

type Dated = { productId: string; day: string; qty: number };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// "Jack Daniel's Cola (24 Cans (350ml/can))" -> { name: "Jack Daniel's Cola", size: "24 Cans (350ml/can)" }
export function splitProductName(full: string): { name: string; size: string } {
  const m = /^(.*?)\s*\((.+)\)\s*$/.exec(full);
  return m && m[1].trim() ? { name: m[1].trim(), size: m[2].trim() } : { name: full, size: "" };
}

// Every day of a month, "YYYY-MM-DD", from "YYYY-MM".
export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

export function buildDailyLedger(input: {
  month: string;
  // The Phnom Penh day today -- days after it have no remaining stock yet.
  today: string;
  products: {
    id: string;
    sku: string | null;
    fullName: string;
    // How Stock names it (title and size); when given they replace the split of fullName.
    name?: string;
    size?: string;
    // A product taken out of Stock: kept in the ledger only while it has stock or activity.
    hideWhenEmpty?: boolean;
    deletion?: LedgerDeletion;
    unit: string;
    categoryName: string;
    price: number;
    originalCost: number | null;
    cost10: number | null;
    quantityNow: number;
    cost: number | null;
    site?: LedgerSiteItem;
  }[];
  // Stock changes inside the month, and those after it (up to now).
  movements: Dated[];
  movementsAfter: { productId: string; qty: number }[];
  purchases: Dated[];
  sold: Dated[];
  other: Dated[];
  // What staff typed into the ledger for this month (daily_ledger_entries).
  entries?: { productId: string; field: string; value: string }[];
}): DailyLedgerRow[] {
  const days = daysOfMonth(input.month);
  const index = new Map(days.map((d, i) => [d, i]));
  const lastDay = days[days.length - 1];
  // The last day that has a figure: the end of the month, or today if the month isn't over.
  const lastShown = input.today < lastDay ? input.today : lastDay;

  const perDay = (rows: Dated[]) => {
    const m = new Map<string, number[]>();
    for (const r of rows) {
      const i = index.get(r.day);
      if (i === undefined) continue;
      const arr = m.get(r.productId) ?? new Array<number>(days.length).fill(0);
      arr[i] += r.qty;
      m.set(r.productId, arr);
    }
    return m;
  };
  const moved = perDay(input.movements);
  const purchased = perDay(input.purchases);
  const soldBy = perDay(input.sold);
  const otherBy = perDay(input.other);
  const typedByProduct = new Map<string, [string, string][]>();
  for (const e of input.entries ?? []) {
    typedByProduct.set(e.productId, [...(typedByProduct.get(e.productId) ?? []), [e.field, e.value]]);
  }
  const after = new Map<string, number>();
  for (const r of input.movementsAfter) after.set(r.productId, (after.get(r.productId) ?? 0) + r.qty);

  const rows: DailyLedgerRow[] = [];
  for (const p of input.products) {
    const net = moved.get(p.id) ?? new Array<number>(days.length).fill(0);
    const monthEnd = round2(p.quantityNow - (after.get(p.id) ?? 0));
    const begin = round2(monthEnd - net.reduce((a, b) => a + b, 0));
    const pArr = purchased.get(p.id);
    const sArr = soldBy.get(p.id);
    const oArr = otherBy.get(p.id);

    const ledgerDays: LedgerDay[] = days.map((d, i) => ({
      p: round2(pArr?.[i] ?? 0),
      s: round2(sArr?.[i] ?? 0),
      o: round2(oArr?.[i] ?? 0),
      r: d <= lastShown ? 0 : null,
      future: d > lastShown,
    }));

    const { name, size } = p.name !== undefined ? { name: p.name, size: p.size ?? "" } : splitProductName(p.fullName);
    const typed = typedByProduct.get(p.id);
    const row: DailyLedgerRow = {
      productId: p.id,
      sku: p.sku,
      name,
      size,
      unit: p.unit,
      categoryName: p.categoryName,
      ...(p.site ? { site: p.site } : {}),
      deletion: p.deletion ?? { kind: "pos" },
      exDate: "",
      edited: [],
      unitPrice: p.price,
      originalCost: p.originalCost,
      cost10: p.cost10,
      totalCost: p.cost,
      begin,
      days: ledgerDays,
      totalIn: 0,
      totalSold: 0,
      totalOther: 0,
      ending: begin,
      endingValue: null,
    };
    for (const [field, value] of typed ?? []) applyLedgerEntry(row, field, value);
    recalcRow(row);

    // Nothing on the shelf and nothing happened: not worth a row (unless something was typed in it).
    if (
      p.hideWhenEmpty &&
      !typed &&
      begin === 0 &&
      row.ending === 0 &&
      row.totalIn === 0 &&
      row.totalSold === 0 &&
      row.totalOther === 0 &&
      net.every((n) => n === 0)
    ) {
      continue;
    }
    rows.push(row);
  }
  return rows;
}

// The cells that can be typed into -- the `field` of a daily_ledger_entries row. p:DD / s:DD / o:DD
// are the P, S and O cells of day DD.
export const LEDGER_FIELDS = [
  "sku",
  "weight",
  "unit",
  "unit_price",
  "ex_date",
  "s_price_loka",
  "tc10",
  "total_cost",
  "begin",
] as const;
export const LEDGER_DAY_FIELD = /^[pso]:(0[1-9]|[12][0-9]|3[01])$/;
export const LEDGER_TEXT_FIELDS: readonly string[] = ["sku", "weight", "unit", "ex_date"];

export function isLedgerField(field: string): boolean {
  return (LEDGER_FIELDS as readonly string[]).includes(field) || LEDGER_DAY_FIELD.test(field);
}

// Puts a typed value into a row (does not recalculate -- see recalcRow). The value is the text as
// stored; numeric cells that don't parse are ignored.
export function applyLedgerEntry(row: DailyLedgerRow, field: string, value: string): void {
  const num = Number(value);
  const numeric = value.trim() !== "" && Number.isFinite(num);
  switch (field) {
    case "sku":
      row.sku = value;
      break;
    case "weight":
      row.size = value;
      break;
    case "unit":
      row.unit = value;
      break;
    case "ex_date":
      row.exDate = value;
      break;
    case "unit_price":
      if (numeric) row.unitPrice = num;
      else return;
      break;
    case "s_price_loka":
      if (numeric) row.originalCost = num;
      else return;
      break;
    case "tc10":
      if (numeric) row.cost10 = num;
      else return;
      break;
    case "total_cost":
      if (numeric) row.totalCost = num;
      else return;
      break;
    case "begin":
      if (numeric) row.begin = num;
      else return;
      break;
    default: {
      const m = /^([pso]):(\d{2})$/.exec(field);
      const day = m ? Number(m[2]) - 1 : -1;
      if (!m || !numeric || day < 0 || day >= row.days.length) return;
      row.days[day][m[1] as "p" | "s" | "o"] = round2(num);
    }
  }
  if (!row.edited.includes(field)) row.edited.push(field);
}

// Works R, the month totals, Ending and Ending value out of the row's Begining stock and its P, S and O:
//   R = (previous R + P) - (S + O)      (the first day's previous R is the Begining stock)
// A day still to come has no R until something is typed into it (or an earlier coming day); from then
// on it has one. Ending is the last R shown. Changes the row in place and returns it.
export function recalcRow(row: DailyLedgerRow): DailyLedgerRow {
  let running = row.begin;
  let ending = row.begin;
  let typedAhead = false;
  for (const d of row.days) {
    running = round2(running + d.p - (d.s + d.o));
    if (d.future && (d.p !== 0 || d.s !== 0 || d.o !== 0)) typedAhead = true;
    if (!d.future || typedAhead) {
      d.r = running;
      ending = running;
    } else {
      d.r = null;
    }
  }
  row.totalIn = round2(row.days.reduce((a, d) => a + d.p, 0));
  row.totalSold = round2(row.days.reduce((a, d) => a + d.s, 0));
  row.totalOther = round2(row.days.reduce((a, d) => a + d.o, 0));
  row.ending = ending;
  row.endingValue = row.totalCost === null ? null : round2(ending * row.totalCost);
  // TC+10% is Total Cost / 0.9 unless a value was typed into it.
  if (!row.edited.includes("tc10")) row.cost10 = row.totalCost === null ? null : round2(row.totalCost / 0.9);
  return row;
}
