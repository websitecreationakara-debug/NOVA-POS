// This app is used in Cambodia, so a "day" always means a Phnom Penh day
// (midnight to midnight, UTC+7 all year -- Cambodia has no daylight saving).
// Never the UTC day and never the day of whatever computer happens to run the
// code: the live server runs on UTC, 7 hours behind, which put an order placed
// at 3 AM Cambodia time on the previous day in every report, and made "today"
// stay yesterday until 7 AM. Everything that groups or filters by day goes
// through here.

const PP_OFFSET_MS = 7 * 60 * 60 * 1000;

// The Phnom Penh calendar day (YYYY-MM-DD) of an instant. "" for an empty or
// invalid timestamp, so callers can keep their `if (!day) continue` checks.
export function ppDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return new Date(ms + PP_OFFSET_MS).toISOString().slice(0, 10);
}

// The Phnom Penh hour of day (0-23) of an instant.
export function ppHour(iso: string): number {
  return new Date(Date.parse(iso) + PP_OFFSET_MS).getUTCHours();
}

// Today's date in Phnom Penh.
export function ppToday(): string {
  return ppDay(new Date().toISOString());
}

// The exact instants a Phnom Penh calendar day starts and ends -- for filtering
// a timestamp column (paid_at, created_at) to a [from, to] range of days.
export function ppDayStart(day: string): string {
  return `${day}T00:00:00.000+07:00`;
}

export function ppDayEnd(day: string): string {
  return `${day}T23:59:59.999+07:00`;
}
