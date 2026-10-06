// An order can hold products from several businesses (order_brands, migration
// 0058). When a report is scoped to ONE business, that business only earns its
// `share` of the order -- the discount and delivery fee are split in the same
// proportion -- so the order's money fields are scaled down to that share.
// A share of 1 (every single-business order) returns the order untouched.

type Money = { subtotal: number; discount: number; tax: number; total: number; delivery_fee: number };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function orderForBrandShare<T extends Money>(order: T, share: number): T {
  if (share >= 1) return order;
  return {
    ...order,
    subtotal: round2(order.subtotal * share),
    discount: round2(order.discount * share),
    tax: round2(order.tax * share),
    total: round2(order.total * share),
    delivery_fee: round2(Number(order.delivery_fee ?? 0) * share),
  };
}
