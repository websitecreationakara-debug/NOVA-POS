// Numbers behind the Marketing > CRM Charts page: customers counted by province,
// gender, age range, nationality and district, plus new customers per month.
// Pure functions over the customer rows so they can be tested without a database.

export type Slice = { name: string; value: number };

export type TopBuyer = { name: string; orders: number; units: number; spent: number };

export type CrmChartData = {
  totalCustomers: number;
  // Customers with at least one order (same rule as the CRM list's Orders column).
  buyers: number;
  newThisMonth: number;
  newLastMonth: number;
  byState: Slice[];
  byGender: Slice[];
  byAge: Slice[];
  byNationality: Slice[];
  // Phnom Penh customers by district.
  byDistrict: Slice[];
  // The last 24 months, oldest first; `month` is YYYY-MM.
  newByMonth: { month: string; value: number }[];
  topBuyers: TopBuyer[];
};

export const UNKNOWN = "Unknown";
export const OTHER = "Other";

const clean = (v: string | null | undefined) => (v ?? "").trim();

// Counts each distinct value, biggest first. Blank / missing values count as
// "Unknown" and always come last (they are not a real category, and would
// otherwise dwarf the rest). With `top`, only the biggest `top` real values stay
// and the rest are summed into one "Other" slice, just before "Unknown".
export function tally(values: (string | null | undefined)[], top?: number): Slice[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const v = clean(raw) || UNKNOWN;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const unknown = counts.get(UNKNOWN) ?? 0;
  counts.delete(UNKNOWN);
  const slices = [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const shown = top && slices.length > top ? slices.slice(0, top) : slices;
  const rest = top && slices.length > top ? slices.slice(top).reduce((sum, s) => sum + s.value, 0) : 0;
  return [
    ...shown,
    ...(rest > 0 ? [{ name: OTHER, value: rest }] : []),
    ...(unknown > 0 ? [{ name: UNKNOWN, value: unknown }] : []),
  ];
}

// Age ranges in their natural order (youngest first). Anything that isn't one of
// the standard ranges (an old free-typed value) is folded into "Other"; a blank
// one is "Unknown". Ranges nobody is in are left out.
export const AGE_ORDER = ["18-24", "25-34", "35-44", "45-54", "55+"];

export function ageTally(values: (string | null | undefined)[]): Slice[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const v = clean(raw);
    const key = !v ? UNKNOWN : AGE_ORDER.includes(v) ? v : OTHER;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...AGE_ORDER, OTHER, UNKNOWN]
    .filter((name) => counts.has(name))
    .map((name) => ({ name, value: counts.get(name)! }));
}

// "2026-10" minus n months -> "2026-07".
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

// Customers per month (by their "customer since" date) for the `months` months
// ending at `endMonth` (YYYY-MM), oldest first, with 0 for quiet months.
export function monthlyCounts(
  dates: (string | null | undefined)[],
  endMonth: string,
  months = 24
): { month: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const month = clean(d).slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return Array.from({ length: months }, (_, i) => {
    const month = shiftMonth(endMonth, i - (months - 1));
    return { month, value: counts.get(month) ?? 0 };
  });
}
