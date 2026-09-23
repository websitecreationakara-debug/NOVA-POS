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

// ---------- Set pricing model (Sets list) ----------
// Ports the user's existing pricing spreadsheet formulas verbatim (column
// letters below match that sheet). Set Cost (C) is the existing ingredient
// total from Items (computeSetTotalCost) -- not stored here. Target MU%,
// Labor Cost, and Base Price (D, G, K) are the only manually entered
// inputs; everything else derives from them plus Set Cost. Base Price is
// the seller's own price for the set (not scraped from a competitor) --
// "Competitor" is just an optional note on who it was benchmarked against.

export type SetPricingInputs = {
  setCost: number | null;
  targetMarkupPct: number | null;
  laborCost: number | null;
  competitorBasePrice: number | null;
};

export type SetPricing = {
  afterMarkup: number | null;
  costPurchase: number | null;
  totalCost: number | null;
  recommend: number | null;
  salePrice: number | null;
  percentOff: number | null;
  markupPct: number | null;
  grossProfit: number | null;
  profitStatus: string | null;
};

// E = C + C*D. null the moment either input is missing (matches the sheet's
// own (C="")+(D="") guard).
function computeAfterMarkup(setCost: number | null, targetMarkupPct: number | null): number | null {
  if (setCost === null || targetMarkupPct === null) return null;
  return round2(setCost + setCost * (targetMarkupPct / 100));
}

// F = K*10% (K<=$50) or K*7% (K>$50) -- a purchase/processing fee scaled off
// Base Price, not off Set Cost. null when there's no Base Price to base it
// on.
function computeCostPurchase(competitorBasePrice: number | null): number | null {
  if (competitorBasePrice === null) return null;
  return round2(competitorBasePrice * (competitorBasePrice <= 50 ? 0.1 : 0.07));
}

// M = K - F. Sale Price only exists once there's a Base Price (F is itself
// derived from K, so it's never null here when K isn't).
function computeSalePrice(competitorBasePrice: number | null, costPurchase: number | null): number | null {
  if (competitorBasePrice === null || costPurchase === null) return null;
  return round2(competitorBasePrice - costPurchase);
}

// L = (K - M) / K, as a percentage point (10 = 10%), matching marginPct's
// convention elsewhere in this file.
function computePercentOff(competitorBasePrice: number | null, salePrice: number | null): number | null {
  if (competitorBasePrice === null || salePrice === null || competitorBasePrice === 0) return null;
  return round2(((competitorBasePrice - salePrice) / competitorBasePrice) * 100);
}

export function computeSetPricing(inputs: SetPricingInputs): SetPricing {
  const { setCost, targetMarkupPct, laborCost, competitorBasePrice } = inputs;
  const afterMarkup = computeAfterMarkup(setCost, targetMarkupPct);
  const costPurchase = computeCostPurchase(competitorBasePrice);

  // H = C + F + G. The sheet only blanks this on a missing Set ID (never in
  // practice) -- a still-missing Cost/Purchase or Labor Cost contributes $0
  // rather than making the whole total unknown (mirrors the sheet's plain
  // "+", where Google Sheets treats a blank cell as 0 in arithmetic).
  const totalCost = setCost === null ? null : round2(setCost + (costPurchase ?? 0) + (laborCost ?? 0));

  // I = E + N(F) + N(G) -- same "blank contributes $0" rule, explicit here
  // via N() in the sheet.
  const recommend = afterMarkup === null ? null : round2(afterMarkup + (costPurchase ?? 0) + (laborCost ?? 0));

  const salePrice = computeSalePrice(competitorBasePrice, costPurchase);
  const percentOff = computePercentOff(competitorBasePrice, salePrice);

  // N = K/H - 1, as a percentage point.
  const markupPct =
    competitorBasePrice === null || totalCost === null || totalCost === 0
      ? null
      : round2((competitorBasePrice / totalCost - 1) * 100);

  // O = K - H.
  const grossProfit =
    competitorBasePrice === null || totalCost === null ? null : round2(competitorBasePrice - totalCost);

  const profitStatus = computeProfitStatus(grossProfit);

  return { afterMarkup, costPurchase, totalCost, recommend, salePrice, percentOff, markupPct, grossProfit, profitStatus };
}

// P: buckets Gross Profit into the sheet's labels. null (blank) below $2 or
// when Gross Profit itself is unknown/exactly 0.
function computeProfitStatus(grossProfit: number | null): string | null {
  if (grossProfit === null || grossProfit === 0) return null;
  if (grossProfit >= 20) return "Great";
  if (grossProfit >= 12) return "Nice";
  if (grossProfit >= 8) return "Good";
  if (grossProfit >= 4) return "Okay";
  if (grossProfit >= 2) return "Check";
  return null;
}

// Suggests a sell price hitting a target margin % off cost, e.g. a 30%
// target margin on a $10 cost -> sells for $10 / (1 - 0.30) = $14.29. null
// when the cost is unknown or the target is 100%+ (mathematically undefined
// -- would require an infinite or negative price).
export function suggestSellPrice(totalCost: number | null, targetMarginPct: number): number | null {
  if (totalCost === null || targetMarginPct >= 100) return null;
  return round2(totalCost / (1 - targetMarginPct / 100));
}
