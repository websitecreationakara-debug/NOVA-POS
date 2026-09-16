// Pure math for Marketing > Cost Control (Sets/Set Builder). Kept
// side-effect free and DB-free so it's unit-testable without a live Postgres
// instance -- see costControl.test.ts. Mirrors the same "null means unknown,
// never silently $0" discipline as src/lib/cogs.ts.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Matches set_items.unit_cost's numeric(12,4) precision -- a per-gram cost
// like $0.0630 needs more than cents to stay accurate across many grams.
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export type SetItemCost = {
  amount: number;
  unitCost: number | null;
};

// One line's cost. null (not 0) the moment the item has no unit cost
// recorded -- an unknown ingredient cost makes the whole set's total unknown.
export function computeLineTotal(item: SetItemCost): number | null {
  if (item.unitCost === null) return null;
  return round2(item.amount * item.unitCost);
}

// A set's total cost across all its line items. Lines with no unit cost yet
// are skipped (treated as $0) rather than making the whole total unknown --
// callers that want to flag a partial total should check
// countItemsMissingCost separately.
export function computeSetTotalCost(items: SetItemCost[]): number | null {
  let total = 0;
  for (const item of items) {
    const lineTotal = computeLineTotal(item);
    if (lineTotal === null) continue;
    total += lineTotal;
  }
  return round2(total);
}

// How many line items have no unit cost recorded -- used to flag a Total
// Cost as partial rather than silently treating it as complete.
export function countItemsMissingCost(items: SetItemCost[]): number {
  return items.filter((item) => item.unitCost === null).length;
}

export function computeMargin(
  totalCost: number | null,
  sellPrice: number | null
): { grossProfit: number | null; marginPct: number | null } {
  if (totalCost === null || sellPrice === null) return { grossProfit: null, marginPct: null };
  const grossProfit = round2(sellPrice - totalCost);
  const marginPct = sellPrice === 0 ? null : round2((grossProfit / sellPrice) * 10000) / 100;
  return { grossProfit, marginPct };
}

// Parses a weight-only unit label ("500g", "1kg", "0.5 kg") into grams.
// Anything else -- "pcs", "packet", bare "kg"/"g" with no number, etc --
// returns null.
export function parseWeightGrams(unit: string): number | null {
  const match = unit.trim().match(/^(\d+(?:\.\d+)?)\s*(kg|g)$/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (Number.isNaN(value) || value <= 0) return null;
  return match[2].toLowerCase() === "kg" ? value * 1000 : value;
}

// Falls back to a weight mentioned in the product name -- either
// parenthesized ("Herring Roe Nishin Red (500g)", "Deep Fried Capelin
// (180g/pkt)") or trailing ("Fresh Salmon 250g Set") -- covers products
// whose `unit` is a generic sales unit ("pcs") but whose pack weight is
// only recorded in the name.
export function parseWeightGramsFromName(name: string): number | null {
  const match = name.match(/(?:\(|\s)(\d+(?:\.\d+)?)\s*(kg|g)\b/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (Number.isNaN(value) || value <= 0) return null;
  return match[2].toLowerCase() === "kg" ? value * 1000 : value;
}

// How many grams a product's base cost (getEffectiveProductCost, i.e. one
// native pack/unit as tracked in Stock) actually represents -- so a Set
// line's Scale can be safely switched between pcs/box/... and kg/g without
// the cost silently meaning something else. Tries, in order: the product's
// own explicit Stock weight (products.weight_grams -- works for any
// product, e.g. any "pcs" item), a weight-only unit ("500g"), a bare
// "kg"/"g" unit (product is already priced per kilo/gram), then a weight
// parenthesized in the product name. null when none of these apply, so
// kg/g can't be offered/converted for that product.
export function productWeightGrams(
  unit: string,
  name: string,
  explicitWeightGrams?: number | null
): number | null {
  if (explicitWeightGrams !== undefined && explicitWeightGrams !== null) return explicitWeightGrams;
  const fromUnit = parseWeightGrams(unit);
  if (fromUnit !== null) return fromUnit;
  const trimmed = unit.trim().toLowerCase();
  if (trimmed === "kg") return 1000;
  if (trimmed === "g") return 1;
  return parseWeightGramsFromName(name);
}

// Unit cost for a Set line's chosen Scale, given the product's base cost
// (for one native pack/unit) and how many grams that pack weighs (null if
// unknown). "kg"/"g" rescale the cost by the pack's weight so e.g. a 500g
// pack at $31.50 becomes $63.00/kg or $0.0630/g; any other Scale (pcs, box,
// pack, set, ...) is assumed to mean "one native pack", so the cost passes
// through unchanged. null when a weight scale is picked but the weight is
// unknown -- never silently treat it as the flat pack cost.
export function computeUnitCostForScale(
  baseCostPerUnit: number,
  weightGrams: number | null,
  scale: string
): number | null {
  const s = scale.trim().toLowerCase();
  if (s === "kg") return weightGrams === null ? null : round4((baseCostPerUnit / weightGrams) * 1000);
  if (s === "g") return weightGrams === null ? null : round4(baseCostPerUnit / weightGrams);
  return baseCostPerUnit;
}

// Suggests a sell price hitting a target margin % off cost, e.g. a 30%
// target margin on a $10 cost -> sells for $10 / (1 - 0.30) = $14.29. null
// when the cost is unknown or the target is 100%+ (mathematically undefined
// -- would require an infinite or negative price).
export function suggestSellPrice(totalCost: number | null, targetMarginPct: number): number | null {
  if (totalCost === null || targetMarginPct >= 100) return null;
  return round2(totalCost / (1 - targetMarginPct / 100));
}
