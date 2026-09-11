// Invoice numbers are derived from the order's creation date rather than
// stored -- `YYYYMM` for the first order of the month, `YYYYMM-2`, `-3` …
// for the rest. Computed at read time (see getInvoice / getOrdersList) so it
// needs no schema change; the stored `orders.invoice_number` (old
// `INV-000045` values) is just ignored for display.

// Asia/Phnom_Penh is UTC+7 year-round (no DST), so a fixed offset is safe.
const PP_OFFSET_MIN = 7 * 60;

function ppParts(iso: string) {
  const d = new Date(new Date(iso).getTime() + PP_OFFSET_MIN * 60_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate() };
}

// The order's Phnom Penh month as YYYYMM.
export function invoiceMonthStamp(iso: string): string {
  const { y, m } = ppParts(iso);
  return `${y}${String(m + 1).padStart(2, "0")}`;
}

// Midnight on the 1st of that Phnom Penh month as a UTC ISO instant -- the
// lower bound for "same month" range queries.
export function invoiceMonthStartIso(iso: string): string {
  const { y, m } = ppParts(iso);
  return new Date(Date.UTC(y, m, 1) - PP_OFFSET_MIN * 60_000).toISOString();
}

// YYYYMM, plus `-N` when this is the Nth (N > 1) order of that month.
export function formatInvoiceNumber(iso: string | null, seqInMonth: number): string | null {
  if (!iso) return null;
  const stamp = invoiceMonthStamp(iso);
  return seqInMonth <= 1 ? stamp : `${stamp}-${seqInMonth}`;
}
