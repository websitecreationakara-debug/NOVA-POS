// How the invoice prints a date and time -- the order date (ថ្ងៃបញ្ជាទិញ) and the
// delivery time. Always Phnom Penh time. The invoice is rendered on the server,
// and on the live site the server runs on UTC -- without a time zone here a
// 1:09 PM order printed as 6:09 AM (7 hours behind) while a local server, on
// Phnom Penh time, looked right.
export function formatDateTime(iso: string | null): string {
  if (!iso) return "...";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "Asia/Phnom_Penh",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}
