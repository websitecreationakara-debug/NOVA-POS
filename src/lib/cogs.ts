// Pure COGS/margin math shared by the charge_order()/adjust_stock() SQL
// (which this file's logic mirrors, for the JS-side recompute in
// updateOrderAction) and the Accountance/Dashboard reporting queries.
// Kept side-effect free and DB-free so it's unit-testable without a live
// Postgres instance -- see cogs.test.ts.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// A recipe's total unit cost = sum(ingredient quantity * ingredient cost).
// null (not 0) the moment any ingredient has no cost_price -- an unknown
// ingredient cost makes the whole recipe's cost unknown, never silently
// under-counted.
export function computeRecipeUnitCost(
  ingredients: { quantity: number; costPrice: number | null }[]
): number | null {
  if (ingredients.some((i) => i.costPrice === null)) return null;
  return round2(ingredients.reduce((sum, i) => sum + i.quantity * (i.costPrice as number), 0));
}

// A single order line's COGS. null propagates from an unknown unit cost --
// never treated as $0.
export function computeLineCogs(unitCost: number | null, quantity: number): number | null {
  if (unitCost === null) return null;
  return round2(unitCost * quantity);
}

// Cost of stock destroyed/given away by a manual adjustment -- only
// negative deltas (stock leaving) have a cost; adding stock back has none.
// null if the product has no cost_price recorded.
export function computeAdjustmentCostImpact(delta: number, costPrice: number | null): number | null {
  if (delta >= 0 || costPrice === null) return null;
  return round2(-delta * costPrice);
}

export function computeGrossMargin(
  revenue: number,
  cogs: number | null
): { grossProfit: number | null; grossMarginPct: number | null } {
  if (cogs === null) return { grossProfit: null, grossMarginPct: null };
  const grossProfit = round2(revenue - cogs);
  const grossMarginPct = revenue === 0 ? null : round2((grossProfit / revenue) * 10000) / 100;
  return { grossProfit, grossMarginPct };
}

// For a summary total across many lines (e.g. a whole day's COGS): sums
// whatever cost is known and flags the total as incomplete rather than
// hiding it entirely behind one missing cost price.
export function aggregatePartialCogs(cogsValues: (number | null)[]): {
  totalCogs: number;
  hasUnknownCost: boolean;
} {
  let totalCogs = 0;
  let hasUnknownCost = false;
  for (const v of cogsValues) {
    if (v === null) hasUnknownCost = true;
    else totalCogs += v;
  }
  return { totalCogs: round2(totalCogs), hasUnknownCost };
}

// One product's Margin Report figures from the order lines sold in range.
// Every line keeps the cost it was sold with, so Total COGS and profit never
// move when a cost later changes. Unit Cost is the product's CURRENT cost
// (currentCost -- Stock's), the same for every date range; without one it falls
// back to the latest cost recorded in range (by sale time), never an average.
// soldAt breaks the units sold down by the cost they were sold at, newest cost
// first, since Total COGS is built from those -- only when some sale in range
// was made at a cost other than the Unit Cost shown, otherwise empty. A line
// with no recorded cost makes the whole product's COGS unknown (see
// aggregateStrictCogs).
export type MarginLine = {
  quantity: number;
  lineTotal: number;
  cogs: number | null;
  unitCost: number | null;
  paidAt: string | null;
};

// Units sold at each recorded per-unit cost, newest cost first (by the sale
// time of its most recent line). Lines with no cost or no sale time are skipped.
export function unitsSoldByCost(lines: MarginLine[]): { unitCost: number; units: number }[] {
  const costs = lines
    .map((l) => ({
      paidAt: l.paidAt,
      quantity: l.quantity,
      unitCost: l.unitCost ?? (l.cogs !== null && l.quantity ? l.cogs / l.quantity : null),
    }))
    .filter((c): c is { paidAt: string; quantity: number; unitCost: number } => c.paidAt !== null && c.unitCost !== null)
    .map((c) => ({ paidAt: c.paidAt, quantity: c.quantity, unitCost: round2(Number(c.unitCost)) }))
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  const unitsByCost = new Map<number, number>();
  for (const c of costs) unitsByCost.set(c.unitCost, (unitsByCost.get(c.unitCost) ?? 0) + c.quantity);
  return [...unitsByCost].map(([cost, units]) => ({ unitCost: cost, units: round2(units) }));
}

export function summarizeMarginLines(lines: MarginLine[], currentCost: number | null = null) {
  const unitsSold = lines.reduce((s, l) => s + l.quantity, 0);
  const revenue = lines.reduce((s, l) => s + l.lineTotal, 0);
  const { totalCogs, hasUnknownCost } = aggregateStrictCogs(lines.map((l) => l.cogs));
  const { grossProfit, grossMarginPct } = computeGrossMargin(revenue, totalCogs);

  const soldAt = unitsSoldByCost(lines);
  const unitCost =
    currentCost ?? (totalCogs === null ? null : (soldAt[0]?.unitCost ?? round2(totalCogs / unitsSold)));
  const anyDifferent = unitCost !== null && soldAt.some((s) => s.unitCost !== round2(unitCost));

  return {
    unitsSold: round2(unitsSold),
    revenue: round2(revenue),
    unitCost: unitCost === null ? null : round2(unitCost),
    soldAt: totalCogs === null || !anyDifferent ? [] : soldAt,
    totalCogs,
    grossProfit,
    grossMarginPct,
    hasUnknownCost,
  };
}

// For one product's own row in the Margin Report: any sold line with an
// unknown cost makes that product's whole total unknown -- a partial sum
// would read as a real (but wrong) margin.
export function aggregateStrictCogs(cogsValues: (number | null)[]): {
  totalCogs: number | null;
  hasUnknownCost: boolean;
} {
  let total = 0;
  for (const v of cogsValues) {
    if (v === null) return { totalCogs: null, hasUnknownCost: true };
    total += v;
  }
  return { totalCogs: round2(total), hasUnknownCost: false };
}
