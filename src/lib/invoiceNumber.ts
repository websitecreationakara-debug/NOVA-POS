// Invoice numbers are derived from the order's creation date rather than
// stored -- `YYYYMMDD` for the first order of the day, `YYYYMMDD-2`, `-3` …
// for the rest. Computed at read time (see getInvoice / getOrdersList) so it
// needs no schema change; the stored `orders.invoice_number` (old
// `INV-000045` values) is just ignored for display.

// Asia/Phnom_Penh is UTC+7 year-round (no DST), so a fixed offset is safe.
const PP_OFFSET_MIN = 7 * 60;

function ppParts(iso: string) {
  const d = new Date(new Date(iso).getTime() + PP_OFFSET_MIN * 60_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate() };
}

// The order's Phnom Penh date as YYYYMMDD.
export function invoiceDateStamp(iso: string): string {
  const { y, m, day } = ppParts(iso);
  return `${y}${String(m + 1).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

// Midnight of that Phnom Penh day as a UTC ISO instant -- the lower bound for
// "same day" range queries.
export function invoiceDayStartIso(iso: string): string {
  const { y, m, day } = ppParts(iso);
  return new Date(Date.UTC(y, m, day) - PP_OFFSET_MIN * 60_000).toISOString();
}

// YYYYMMDD, plus `-N` when this is the Nth (N > 1) order of that day.
export function formatInvoiceNumber(iso: string | null, seqInDay: number): string | null {
  if (!iso) return null;
  const stamp = invoiceDateStamp(iso);
  return seqInDay <= 1 ? stamp : `${stamp}-${seqInDay}`;
}
