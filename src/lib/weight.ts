// Selling part of a pack (100g of a 350g steak): helpers for reading a pack's
// weight out of its name and working out the fraction sold. Quantities are
// stored with two decimals (order_items.quantity / stock_levels.quantity are
// numeric(12,2)), so the fraction is rounded the same way.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// "A4 Wagyu Sirloin Steak (350g)" -> 350, "Whole Salmon 1kg" -> 1000. null when
// the text has no weight in it.
export function parseGrams(text: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(kg|g)\b/i.exec(text);
  if (!m) return null;
  const grams = parseFloat(m[1]) * (m[2].toLowerCase() === "kg" ? 1000 : 1);
  return grams > 0 ? grams : null;
}

// The weight to print after a product's Khmer name. The English name carries
// its weight ("Salmon Roe Ikura (100g)", "Whole Salmon 1kg") or the website
// listing does ("1pc (125g)"); the Khmer name usually has neither, so it would
// print with no weight at all. Prefers the listing's text, else the weight
// written in the English name, in brackets. null when there is no Khmer name
// (the English name is shown, weight and all), the Khmer name already has a
// weight, or there is none to show.
export function khmerNameWeight(item: {
  nameKm?: string | null;
  name: string;
  weightLabel?: string | null;
}): string | null {
  const km = item.nameKm?.trim();
  if (!km) return null;
  if (/\d\s*(?:kg|g)\b/i.test(km)) return null;
  const label = item.weightLabel?.trim();
  if (label) return label;
  const m = /(\d+(?:\.\d+)?\s*(?:kg|g)\b(?:\s*\/\s*\w+)?)/i.exec(item.name);
  return m ? `(${m[1].replace(/\s+/g, "")})` : null;
}

// The size label saved on the order line: "100g", or "1.5kg" for 1000g+.
export function formatGrams(grams: number): string {
  if (grams >= 1000) return `${round2(grams / 1000)}kg`;
  return `${round2(grams)}g`;
}

// What selling `soldGrams` of a `packGrams` pack looks like as an order line:
// the fraction of a unit (what stock goes down by) and the per-unit price that
// makes quantity x unitPrice equal the pack price scaled to that weight.
// null when the weight is unusable or rounds to no quantity at all.
export function sizedLine(
  packGrams: number,
  soldGrams: number,
  packPrice: number
): { quantity: number; unitPrice: number; label: string } | null {
  if (!(packGrams > 0) || !(soldGrams > 0)) return null;
  const quantity = round2(soldGrams / packGrams);
  if (quantity <= 0) return null;
  return {
    quantity,
    unitPrice: round2((packPrice * (soldGrams / packGrams)) / quantity),
    label: formatGrams(soldGrams),
  };
}
