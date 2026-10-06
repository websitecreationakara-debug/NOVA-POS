// Periods for the CRM Charts page: a day, week, month, year or a custom range of
// days (or all time), and optionally several more of the same kind to compare it
// with (a day with other days, a month with other months, a range with other
// ranges ...). A period is named by an "anchor": a day (YYYY-MM-DD) for a day, a
// week (snapped to its Monday) is the same, YYYY-MM for a month, YYYY for a year
// and FROM..TO (two days) for a range. Pure functions, so they can be tested
// without a database.

import { ageTally, shiftMonth, tally, type Slice, type TopBuyer } from "./crmCharts";

export type Granularity = "day" | "week" | "month" | "year" | "range" | "all";

export const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
  range: "Range",
  all: "All time",
};

export function parseGranularity(v: string | undefined): Granularity {
  return v && v in GRANULARITY_LABELS ? (v as Granularity) : "all";
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const mondayOf = (ymd: string) => addDaysYmd(ymd, -((new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7));
const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// A custom range is named "FROM..TO" (two days, YYYY-MM-DD..YYYY-MM-DD, inclusive).
function parseRange(v: string): { from: string; to: string } | null {
  const [x = "", y = ""] = v.split("..");
  if (!isYmd(x) || !isYmd(y)) return null;
  return x <= y ? { from: x, to: y } : { from: y, to: x };
}
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5) + 1;

// A usable anchor for the granularity: the one asked for if valid, else the one
// containing `today` (for a range: the last 7 days).
export function normalizeAnchor(gran: Granularity, raw: string | undefined, today: string): string {
  const v = (raw ?? "").trim();
  switch (gran) {
    case "day":
      return isYmd(v) ? v : today;
    case "week":
      return mondayOf(isYmd(v) ? v : today);
    case "month":
      return /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : today.slice(0, 7);
    case "year":
      return /^\d{4}$/.test(v) ? v : today.slice(0, 4);
    case "range": {
      const r = parseRange(v) ?? { from: addDaysYmd(today, -6), to: today };
      return `${r.from}..${r.to}`;
    }
    case "all":
      return "";
  }
}

// The same kind of period `delta` steps away (-1 = the one before). A range moves
// by its own length, so -1 is the stretch of the same number of days just before it.
export function shiftAnchor(gran: Granularity, anchor: string, delta: number): string {
  switch (gran) {
    case "day":
      return addDaysYmd(anchor, delta);
    case "week":
      return addDaysYmd(anchor, delta * 7);
    case "month":
      return shiftMonth(anchor, delta);
    case "year":
      return String(Number(anchor) + delta);
    case "range": {
      const r = parseRange(anchor);
      if (!r) return anchor;
      const step = daysBetween(r.from, r.to) * delta;
      return `${addDaysYmd(r.from, step)}..${addDaysYmd(r.to, step)}`;
    }
    case "all":
      return "";
  }
}

// First and last day (inclusive). "all" has no start.
export function periodRange(gran: Granularity, anchor: string, today: string): { from: string | null; to: string } {
  switch (gran) {
    case "day":
      return { from: anchor, to: anchor };
    case "week":
      return { from: anchor, to: addDaysYmd(anchor, 6) };
    case "month": {
      const [y, m] = anchor.split("-").map(Number);
      return { from: `${anchor}-01`, to: `${anchor}-${String(lastDayOfMonth(y, m)).padStart(2, "0")}` };
    }
    case "year":
      return { from: `${anchor}-01-01`, to: `${anchor}-12-31` };
    case "range": {
      const r = parseRange(anchor) ?? { from: addDaysYmd(today, -6), to: today };
      return r;
    }
    case "all":
      return { from: null, to: today };
  }
}

export function periodLabel(gran: Granularity, anchor: string): string {
  const pretty = (ymd: string) => `${MONTH_SHORT[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}`;
  switch (gran) {
    case "day":
      return `${WEEKDAYS[(new Date(`${anchor}T00:00:00Z`).getUTCDay() + 6) % 7]}, ${pretty(anchor)}, ${anchor.slice(0, 4)}`;
    case "week": {
      const end = addDaysYmd(anchor, 6);
      return `${pretty(anchor)} – ${pretty(end)}, ${end.slice(0, 4)}`;
    }
    case "month":
      return `${MONTH_LONG[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}`;
    case "year":
      return anchor;
    case "range": {
      const r = parseRange(anchor);
      if (!r) return anchor;
      // The year is only spelled out where it is needed to tell the ends apart.
      return r.from.slice(0, 4) === r.to.slice(0, 4)
        ? `${pretty(r.from)} – ${pretty(r.to)}, ${r.to.slice(0, 4)}`
        : `${pretty(r.from)}, ${r.from.slice(0, 4)} – ${pretty(r.to)}, ${r.to.slice(0, 4)}`;
    }
    case "all":
      return "All time";
  }
}

// A range of up to about two months is drawn day by day, a longer one month by month.
export const RANGE_DAILY_MAX_DAYS = 62;

// What the page shows for one period.
export type Bucket = { label: string; buyers: number; newCustomers: number; orders: number; spent: number };

export type PeriodStats = {
  label: string;
  from: string | null;
  to: string;
  // Customers with at least one order in the period.
  buyers: number;
  // Customers whose "customer since" date falls in the period.
  newCustomers: number;
  orders: number;
  spent: number;
  // Hours (a day), weekdays (a week), days (a month), months (a year / all time).
  buckets: Bucket[];
  // The make-up of the customers: those who bought in the period, or -- for all
  // time -- every customer.
  byState: Slice[];
  byGender: Slice[];
  byAge: Slice[];
  byNationality: Slice[];
  byDistrict: Slice[];
  topBuyers: TopBuyer[];
};

export type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  second_phone: string | null;
  state: string | null;
  gender: string | null;
  age: string | null;
  nationality: string | null;
  capital: string | null;
  // The day they became a customer (YYYY-MM-DD).
  since: string;
};

// An order, with its Phnom Penh day and hour worked out. `subtotal` is the item
// prices (before any order discount / delivery fee).
export type PeriodOrder = {
  id: string;
  customerId: string | null;
  phone: string | null;
  subtotal: number;
  day: string;
  hour: number;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function buildPeriod(opts: {
  gran: Granularity;
  anchor: string;
  today: string;
  customers: CustomerRow[];
  orders: PeriodOrder[];
  province: string;
}): PeriodStats {
  const { gran, anchor, today, customers, province } = opts;
  const { from, to } = periodRange(gran, anchor, today);
  const inPeriod = (day: string) => (from === null || day >= from) && day <= to;

  // Which customers an order belongs to: the one it is linked to, plus anyone whose
  // phone / second phone is the order's phone (older orders carry only the phone).
  const byPhone = new Map<string, string[]>();
  for (const c of customers) {
    for (const p of [c.phone, c.second_phone]) {
      const phone = p?.trim();
      if (phone) byPhone.set(phone, [...(byPhone.get(phone) ?? []), c.id]);
    }
  }
  const scope = province ? customers.filter((c) => (c.state ?? "").trim() === province) : customers;
  const scoped = new Map(scope.map((c) => [c.id, c]));

  // The buckets the period is drawn in.
  const rangeDaily = gran === "range" && from !== null && daysBetween(from, to) <= RANGE_DAILY_MAX_DAYS;
  const byDay = gran === "week" || gran === "month" || rangeDaily;
  const keyOf = (day: string, hour: number): string =>
    gran === "day" ? String(hour) : byDay ? day : day.slice(0, 7);
  const bucketList: { key: string; label: string }[] = [];
  if (gran === "day") {
    for (let h = 0; h < 24; h++) bucketList.push({ key: String(h), label: `${String(h).padStart(2, "0")}:00` });
  } else if (gran === "week") {
    for (let i = 0; i < 7; i++) {
      const d = addDaysYmd(anchor, i);
      bucketList.push({ key: d, label: `${WEEKDAYS[i]} ${Number(d.slice(8, 10))}` });
    }
  } else if (gran === "month") {
    for (let d = from!; d <= to; d = addDaysYmd(d, 1)) bucketList.push({ key: d, label: String(Number(d.slice(8, 10))) });
  } else if (rangeDaily) {
    for (let d = from!; d <= to; d = addDaysYmd(d, 1)) {
      bucketList.push({ key: d, label: `${MONTH_SHORT[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}` });
    }
  } else if (gran === "range") {
    // A long range: every month it touches, with the year to tell them apart.
    for (let m = from!.slice(0, 7); m <= to.slice(0, 7); m = shiftMonth(m, 1)) {
      bucketList.push({ key: m, label: `${MONTH_SHORT[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}` });
    }
  } else {
    const endMonth = gran === "year" ? `${anchor}-12` : today.slice(0, 7);
    const months = gran === "year" ? 12 : 24;
    for (let i = 0; i < months; i++) {
      const m = shiftMonth(endMonth, i - (months - 1));
      bucketList.push({
        key: m,
        label: `${MONTH_SHORT[Number(m.slice(5, 7)) - 1]}${gran === "all" ? ` ${m.slice(2, 4)}` : ""}`,
      });
    }
  }
  const index = new Map(bucketList.map((b, i) => [b.key, i]));
  const buckets = bucketList.map((b) => ({
    label: b.label,
    spent: 0,
    orders: 0,
    newCustomers: 0,
    buyerSet: new Set<string>(),
  }));
  const bucketFor = (day: string, hour: number) => {
    const i = index.get(keyOf(day, hour));
    return i === undefined ? undefined : buckets[i];
  };

  const buyerSet = new Set<string>();
  const spentBy = new Map<string, number>();
  const ordersBy = new Map<string, number>();
  let orderCount = 0;
  let spent = 0;
  for (const o of opts.orders) {
    if (!inPeriod(o.day)) continue;
    const owners = new Set<string>();
    if (o.customerId && scoped.has(o.customerId)) owners.add(o.customerId);
    const phone = o.phone?.trim();
    if (phone) for (const id of byPhone.get(phone) ?? []) if (scoped.has(id)) owners.add(id);
    // With a province chosen only that province's customers' orders count; with
    // none, every order does, even one that matches no customer.
    if (province && owners.size === 0) continue;
    orderCount += 1;
    spent += o.subtotal;
    const b = bucketFor(o.day, o.hour);
    if (b) {
      b.orders += 1;
      b.spent += o.subtotal;
    }
    for (const id of owners) {
      buyerSet.add(id);
      spentBy.set(id, (spentBy.get(id) ?? 0) + o.subtotal);
      ordersBy.set(id, (ordersBy.get(id) ?? 0) + 1);
      b?.buyerSet.add(id);
    }
  }

  let newCustomers = 0;
  for (const c of scope) {
    if (!inPeriod(c.since)) continue;
    newCustomers += 1;
    // A customer has a date but no time, so a single day isn't split by hour.
    if (gran !== "day") {
      const b = bucketFor(c.since, 0);
      if (b) b.newCustomers += 1;
    }
  }

  // The make-up: everyone for "all time", else the customers who bought.
  const people = gran === "all" ? scope : scope.filter((c) => buyerSet.has(c.id));
  const topBuyers = [...buyerSet]
    .map((id) => ({
      name: scoped.get(id)!.name,
      orders: ordersBy.get(id) ?? 0,
      units: 0,
      spent: round2(spentBy.get(id) ?? 0),
    }))
    .sort((a, b) => b.spent - a.spent || a.name.localeCompare(b.name))
    .slice(0, 10);

  return {
    label: periodLabel(gran, anchor),
    from,
    to,
    buyers: buyerSet.size,
    newCustomers,
    orders: orderCount,
    spent: round2(spent),
    buckets: buckets.map((b) => ({
      label: b.label,
      buyers: b.buyerSet.size,
      newCustomers: b.newCustomers,
      orders: b.orders,
      spent: round2(b.spent),
    })),
    byState: tally(people.map((c) => c.state), 8),
    byGender: tally(people.map((c) => c.gender)),
    byAge: ageTally(people.map((c) => c.age)),
    byNationality: tally(people.map((c) => c.nationality)),
    byDistrict: tally(
      people.filter((c) => (c.state ?? "").trim() === "Phnom Penh").map((c) => c.capital),
      10
    ),
    topBuyers,
  };
}

// How many periods can be put next to the main one (12 in all -- a year of months).
export const MAX_COMPARE = 11;

// "Compare a range" for years: every year from `start` to `end` (either order)
// except the main one. With more than MAX_COMPARE the ones nearest the main year
// are kept. Newest first. Nothing if either end is not a plausible year.
export function yearsInRange(start: number, end: number, main: string): string[] {
  const ok = (y: number) => Number.isInteger(y) && y >= 1900 && y <= 2200;
  if (!ok(start) || !ok(end)) return [];
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  const years: number[] = [];
  for (let y = lo; y <= hi; y++) if (String(y) !== main) years.push(y);
  const m = Number(main);
  return years
    .sort((a, b) => Math.abs(a - m) - Math.abs(b - m) || b - a)
    .slice(0, MAX_COMPARE)
    .sort((a, b) => b - a)
    .map(String);
}

// The periods to compare with, from the address (comma separated): each snapped to
// a valid anchor, repeats and the main period itself dropped, at most MAX_COMPARE.
export function parseCompareAnchors(
  gran: Granularity,
  raw: string | undefined,
  main: string,
  today: string
): string[] {
  if (gran === "all" || !raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    if (!part.trim()) continue;
    const anchor = normalizeAnchor(gran, part, today);
    if (anchor !== main && !out.includes(anchor)) out.push(anchor);
    if (out.length === MAX_COMPARE) break;
  }
  return out;
}

// What getCrmChartDataAction hands the page: the main period first, then the
// periods compared with it (same order as `anchors`), and the choices for the pickers.
export type CrmChartsResult = {
  gran: Granularity;
  anchors: string[];
  // The province filter ("" = all provinces).
  province: string;
  provinces: Slice[];
  totalCustomers: number;
  // Years to pick from, newest first.
  years: number[];
  periods: PeriodStats[];
};
