// Expiry warnings for the Daily Ledger's EX-DATE column. The ex-dates were typed or imported from sheets in many
// spellings ("2026-12-01", "12/2026", "26.02.2025", "Jun-2026", "2027.4.1", ...), so the text is read leniently;
// a value that can't be read as a date ("N/A", "6-7/2026") simply gets no warning.
//
//   expired     the day has passed
//   week        7 days or fewer left
//   two_weeks   8 - 14 days left
//   month       15 - 30 days left
// A month with no day ("12/2026", "Jun-2026") expires at the END of that month. A date that could be day/month or
// month/day ("03/04/2026") counts as the earlier of the two, so a warning is early rather than late.

export type ExpiryTier = "expired" | "week" | "two_weeks" | "month";

export type ExpiryStatus = {
  tier: ExpiryTier | null;
  // Whole days from today to the expiry day; negative once it has passed.
  days: number;
  // The expiry day, YYYY-MM-DD.
  date: string;
};

const DAY_MS = 24 * 3600 * 1000;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const endOfMonth = (y: number, m: number) => Date.UTC(y, m, 0);
// A real calendar day (not 31 February).
const valid = (y: number, m: number, d: number) => {
  const t = new Date(utc(y, m, d));
  return y >= 2000 && y <= 2100 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// The expiry day of the text, as ms at UTC midnight, or null when it isn't a date.
function parseExpiryMs(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  let m: RegExpExecArray | null;

  // 2026-12-01, 2027.4.1, 2027.04.01
  if ((m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(t))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valid(y, mo, d) ? utc(y, mo, d) : null;
  }
  // 26.02.2025 (day.month.year)
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t))) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valid(y, mo, d) ? utc(y, mo, d) : null;
  }
  // 03/04/2026 or 26-02-2025: day/month or month/day -- whichever fits; if both do, the earlier one
  if ((m = /^(\d{1,2})([/-])(\d{1,2})\2(\d{4})$/.exec(t))) {
    const [a, b, y] = [Number(m[1]), Number(m[3]), Number(m[4])];
    const options = [valid(y, b, a) ? utc(y, b, a) : null, valid(y, a, b) ? utc(y, a, b) : null].filter((v): v is number => v !== null);
    return options.length ? Math.min(...options) : null;
  }
  // 12/2026 (month/year): the end of that month
  if ((m = /^(\d{1,2})[/-](\d{4})$/.exec(t))) {
    const [mo, y] = [Number(m[1]), Number(m[2])];
    return mo >= 1 && mo <= 12 && y >= 2000 && y <= 2100 ? endOfMonth(y, mo) : null;
  }
  // 10/26 (month/two-digit year)
  if ((m = /^(\d{1,2})\/(\d{2})$/.exec(t))) {
    const [mo, yy] = [Number(m[1]), Number(m[2])];
    return mo >= 1 && mo <= 12 && yy >= 20 ? endOfMonth(2000 + yy, mo) : null;
  }
  // Jun-2026, June 2026
  if ((m = /^([A-Za-z]{3,9})[-\s/.](\d{4})$/.exec(t))) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    const y = Number(m[2]);
    return mo >= 1 && y >= 2000 && y <= 2100 ? endOfMonth(y, mo) : null;
  }
  return null;
}

// How close the product is to its ex-date. `today` is the day now (YYYY-MM-DD, Phnom Penh).
export function expiryStatus(text: string, today: string): ExpiryStatus | null {
  const ms = parseExpiryMs(text);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (ms === null || Number.isNaN(now)) return null;
  const days = Math.round((ms - now) / DAY_MS);
  const tier: ExpiryTier | null = days < 0 ? "expired" : days <= 7 ? "week" : days <= 14 ? "two_weeks" : days <= 30 ? "month" : null;
  return { tier, days, date: isoOf(ms) };
}

export const EXPIRY_LABEL: Record<ExpiryTier, string> = {
  expired: "Expired",
  week: "1 week",
  two_weeks: "2 weeks",
  month: "1 month",
};

// The sentence for a cell's tooltip.
export function expiryTitle(s: ExpiryStatus): string {
  if (s.days < 0) return `Expired ${-s.days} day${s.days === -1 ? "" : "s"} ago (${s.date})`;
  if (s.days === 0) return `Expires today (${s.date})`;
  return `Expires in ${s.days} day${s.days === 1 ? "" : "s"} (${s.date})`;
}

// The short line shown under an ex-date in the ledger.
export function expiryDaysText(s: ExpiryStatus): string {
  if (s.days < 0) return `Expired ${-s.days}d ago`;
  if (s.days === 0) return "Expires today";
  return `${s.days} day${s.days === 1 ? "" : "s"} left`;
}
