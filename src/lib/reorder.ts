// Reorder suggestions: how much of each product to buy so there is enough stock for the next month.
//
//   1. Average daily sales = units sold over the look-back window (30 / 60 / 90 days) / the days counted.
//      Days the product had no stock to sell are not counted (they would read as zero sales).
//   2. Need = average daily sales x (days to cover + delivery days).
//   3. Safety stock = a % of the need on top, so a busy week doesn't empty the shelf.
//   4. Suggested buy = need + safety - stock now - stock already on order; zero or less means "don't buy yet".
//   5. Rounded up to whole cases when the product has Units / case.
// A product with under 14 days of history has "not enough data", and one whose stock isn't tracked (unlimited on the
// website, or sold without its stock moving) gets no number.

export const HISTORY_DAYS = 90;
export const MIN_HISTORY_DAYS = 14;

export type ReorderProduct = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  // Stock now.
  stock: number;
  // Units in one case (the Daily Ledger's Units / case), null when it isn't sold in cases.
  caseSize: number | null;
  unitCost: number | null;
  // false: the quantity can't be relied on (unlimited on the website, or it sells without its stock moving).
  tracked: boolean;
  // Where its sales and stock come from: the Daily Ledger, or Stock / POS orders for a product not in the ledger.
  source: "ledger" | "stock";
  // How many days the product has existed (capped at HISTORY_DAYS).
  historyDays: number;
  // Units sold per day over the last HISTORY_DAYS days; the last entry is yesterday.
  daily: number[];
  // The same days: true when the product had no stock to sell that day (left out of the average).
  outOfStock: boolean[];
};

export type ReorderSettings = {
  // Look back this many days (30 / 60 / 90).
  windowDays: number;
  // Buy enough for this many days...
  coverDays: number;
  // ...plus the days it takes the supplier to deliver.
  leadDays: number;
  // Extra on top of the need, in percent.
  safetyPct: number;
};

export const DEFAULT_SETTINGS: ReorderSettings = { windowDays: 60, coverDays: 30, leadDays: 0, safetyPct: 15 };

export type ReorderStatus = "buy" | "enough" | "no_sales" | "not_enough_data" | "untracked";

export type Suggestion = {
  status: ReorderStatus;
  // Average units sold per day (days with stock only), null when it can't be worked out.
  dailyRate: number | null;
  // Days the current stock lasts at that rate, null when there are no sales.
  daysLeft: number | null;
  // Change in the daily rate: the most recent half of the window against the half before it, in %.
  trendPct: number | null;
  // Units wanted on the shelf for the covered days, with the safety stock included.
  target: number;
  // What to buy, in units (rounded up to whole cases when there is a case size) and as cases.
  buyUnits: number;
  cases: number | null;
  // Estimated cost of the purchase at the product's cost, null when the cost is unknown.
  cost: number | null;
  // The stock is below zero (more sold than was ever recorded in): it counts as 0 and the record needs a look.
  stockBelowZero: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function rateOver(p: ReorderProduct, from: number, to: number): { rate: number | null; days: number } {
  let sold = 0;
  let days = 0;
  for (let i = from; i < to; i++) {
    if (p.outOfStock[i]) continue;
    sold += p.daily[i] ?? 0;
    days++;
  }
  return { rate: days === 0 ? null : sold / days, days };
}

export function suggestReorder(p: ReorderProduct, settings: ReorderSettings, onOrder = 0): Suggestion {
  const stockBelowZero = p.stock < 0;
  const empty = { dailyRate: null, daysLeft: null, trendPct: null, target: 0, buyUnits: 0, cases: null, cost: null, stockBelowZero };
  if (!p.tracked) return { status: "untracked", ...empty };

  const windowDays = Math.min(HISTORY_DAYS, Math.max(1, Math.round(settings.windowDays)));
  const start = p.daily.length - windowDays;
  // Days before the product existed are not part of the average.
  const firstDay = Math.max(start, p.daily.length - Math.min(p.historyDays, p.daily.length));
  if (p.historyDays < MIN_HISTORY_DAYS) return { status: "not_enough_data", ...empty };

  const { rate, days } = rateOver(p, firstDay, p.daily.length);
  if (rate === null || days < 7) return { status: "not_enough_data", ...empty };
  if (rate === 0) return { status: "no_sales", ...empty, dailyRate: 0 };

  // Trend: the recent half of the counted window against the half before it.
  const mid = firstDay + Math.floor((p.daily.length - firstDay) / 2);
  const before = rateOver(p, firstDay, mid);
  const recent = rateOver(p, mid, p.daily.length);
  const trendPct =
    before.rate !== null && recent.rate !== null && before.days >= 5 && recent.days >= 5 && before.rate > 0
      ? Math.round(((recent.rate - before.rate) / before.rate) * 100)
      : null;

  const need = rate * (Math.max(0, settings.coverDays) + Math.max(0, settings.leadDays));
  // Whole units, as in the worked example: 36 x 1.15 = 41.4 -> 41.
  const target = Math.round(need * (1 + Math.max(0, settings.safetyPct) / 100));
  // A negative stock is a recording gap, not a debt: it counts as 0.
  const stock = Math.max(0, p.stock);
  const short = target - stock - Math.max(0, onOrder);
  const daysLeft = stock > 0 ? round2(stock / rate) : 0;
  const base = { dailyRate: round2(rate), daysLeft, trendPct, target, stockBelowZero };
  if (short <= 0.0001) return { status: "enough", ...base, buyUnits: 0, cases: null, cost: null };

  const caseSize = p.caseSize && p.caseSize > 0 ? p.caseSize : null;
  const cases = caseSize ? Math.ceil(short / caseSize - 1e-9) : null;
  const buyUnits = caseSize && cases !== null ? cases * caseSize : Math.ceil(short - 1e-9);
  return {
    status: "buy",
    ...base,
    buyUnits,
    cases,
    cost: p.unitCost === null ? null : round2(buyUnits * p.unitCost),
  };
}
