// How alike two product names are, 0..1 -- used to suggest which Stock product a Daily Ledger product is
// ("Frozen No Shell Scallop" ~ "Frozen Scallop", "Masago" ~ "Masago 50g"). Words are compared without
// capitals or punctuation; one name that holds all the words of the other counts as a strong match, and
// two different weights ("50g" vs "100g") count against it.

const WEIGHT = /^\d+(\.\d+)?(g|kg|ml|l|cl|oz|pcs|pc|pack|can|cans)$/;

export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/(\d)\s+(g|kg|ml|l|cl|oz)\b/g, "$1$2")
    .replace(/[^a-z0-9.]+/g, " ")
    .split(" ")
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean)
    // "seafoods" ~ "seafood": a plural word is its singular.
    .map((t) => (t.length > 4 && t.endsWith("s") && !/\d/.test(t) ? t.slice(0, -1) : t));
}

export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  const shared = [...ta].filter((t) => tb.has(t));
  if (shared.length === 0) return 0;
  const union = new Set([...ta, ...tb]).size;
  const jaccard = shared.length / union;
  const contain = shared.length / Math.min(ta.size, tb.size);
  let score = 0.5 * jaccard + 0.5 * contain;
  const wa = [...ta].filter((t) => WEIGHT.test(t));
  const wb = [...tb].filter((t) => WEIGHT.test(t));
  if (wa.length > 0 && wb.length > 0 && !wa.some((t) => wb.includes(t))) score *= 0.6;
  return Math.round(score * 1000) / 1000;
}
