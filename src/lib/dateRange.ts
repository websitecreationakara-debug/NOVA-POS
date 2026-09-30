// Shared Day/Week/Month/Quarter/Year range math -- same semantics as the
// Accountance page's own picker (src/app/(app)/accountance/page.tsx), kept
// here as its own module so the Dashboard can use an identical picker
// without duplicating logic into (or risking a regression in) that page.

export type RangeMode = "day" | "week" | "month" | "quarter" | "year";

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Any date -> the Monday on or before it (UTC) -- a business's week always
// starts Monday, same convention used everywhere else in the app.
export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const dow = d.getUTCDay(); // 0 = Sun .. 6 = Sat
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}

// `weekStr` is any date within the target week (canonically its Monday, but
// stepping/navigation just needs *a* date inside the week) -> that week's
// Monday-Sunday range.
export function weekRange(weekStr: string): { from: string; to: string } {
  const from = mondayOf(weekStr);
  const sunday = new Date(`${from}T00:00:00.000Z`);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return { from, to: sunday.toISOString().slice(0, 10) };
}

// "2026-09" -> the first and last calendar day of that month. Date.UTC's
// day-0 rolls back to the last day of the *previous* month, so passing the
// target month as if it were 1-indexed (m, not m - 1) lands on its last day.
export function monthRange(monthStr: string): { from: string; to: string } {
  const [y, m] = monthStr.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${monthStr}-01`, to: `${monthStr}-${String(lastDay).padStart(2, "0")}` };
}

// "2026-Q3" -> that quarter's first and last calendar day.
export function quarterRange(quarterStr: string): { from: string; to: string } {
  const [yearPart, qPart] = quarterStr.split("-Q");
  const y = Number(yearPart);
  const startMonth = (Number(qPart) - 1) * 3; // 0-indexed
  const lastDay = new Date(Date.UTC(y, startMonth + 3, 0)).getUTCDate();
  return {
    from: `${y}-${String(startMonth + 1).padStart(2, "0")}-01`,
    to: `${y}-${String(startMonth + 3).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function quarterOf(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

export function yearRange(yearStr: string): { from: string; to: string } {
  return { from: `${yearStr}-01-01`, to: `${yearStr}-12-31` };
}

export type ResolvedRange = {
  mode: RangeMode;
  week: string;
  month: string;
  quarter: string;
  year: string;
  fromDate: string;
  toDate: string;
};

// Same resolution the Accountance page does inline: mode + its own param
// (week/month/quarter/year), or a free-form from/to (day mode, also covers
// "Custom Date Range") -> the concrete [fromDate, toDate] a query needs.
export function resolveRange(params: {
  mode?: string;
  from?: string;
  to?: string;
  date?: string;
  week?: string;
  month?: string;
  quarter?: string;
  year?: string;
}): ResolvedRange {
  const today = todayIso();
  const mode: RangeMode =
    params.mode === "week" || params.mode === "month" || params.mode === "quarter" || params.mode === "year"
      ? params.mode
      : "day";
  const week = params.week || mondayOf(today);
  const month = params.month || today.slice(0, 7);
  const quarter = params.quarter || quarterOf(today);
  const year = params.year || today.slice(0, 4);

  let fromDate: string;
  let toDate: string;
  if (mode === "week") ({ from: fromDate, to: toDate } = weekRange(week));
  else if (mode === "month") ({ from: fromDate, to: toDate } = monthRange(month));
  else if (mode === "quarter") ({ from: fromDate, to: toDate } = quarterRange(quarter));
  else if (mode === "year") ({ from: fromDate, to: toDate } = yearRange(year));
  else {
    fromDate = params.from || params.date || today;
    toDate = params.to || fromDate;
  }

  return { mode, week, month, quarter, year, fromDate, toDate };
}

// Human-readable label for a resolved range, used to suffix stat card
// labels (e.g. "Total Revenue (Today)") -- "Today" for the single current
// day, the date itself for any other single day, else the two endpoints.
export function rangeLabel(fromDate: string, toDate: string): string {
  const today = todayIso();
  if (fromDate === toDate) return fromDate === today ? "Today" : fromDate;
  return `${fromDate} – ${toDate}`;
}
