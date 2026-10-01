// Cambodian phone numbers are saved with the country code in front
// (85585251742). The Sales phone box shows "855" as a fixed prefix, so staff
// only type the rest -- this turns whatever they typed (or pasted) into the
// full number.

export const COUNTRY_PREFIX = "855";

// "85251742" -> "85585251742". Spaces, dashes and "+" are ignored; a leading 0
// ("085251742", how the number is dialled locally) is dropped; a pasted full
// number ("+855 85 251 742" / "85585251742") is kept as it is. "" when there are
// no digits, so an empty box stays empty rather than becoming just "855".
export function toFullPhone(typed: string): string {
  const digits = typed.replace(/\D/g, "");
  // A full international number is 855 + 8-9 digits = 11-12 long. Anything
  // shorter that happens to start with 855 is a local number, so it still gets
  // the prefix.
  if (digits.startsWith(COUNTRY_PREFIX) && digits.length >= 11) return digits;
  const local = digits.replace(/^0+/, "");
  return local ? COUNTRY_PREFIX + local : "";
}
