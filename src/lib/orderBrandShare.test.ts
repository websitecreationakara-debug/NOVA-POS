import { describe, expect, it } from "vitest";
import { orderForBrandShare } from "./orderBrandShare";

const order = { id: "o1", subtotal: 40, discount: 4, tax: 0, total: 41, delivery_fee: 5 };

describe("orderForBrandShare", () => {
  it("leaves a whole (single-business) order untouched", () => {
    expect(orderForBrandShare(order, 1)).toBe(order);
  });

  it("scales every money field to the business's share", () => {
    // $10 of the $40 subtotal belongs to this business -> 25%.
    expect(orderForBrandShare(order, 0.25)).toEqual({
      id: "o1",
      subtotal: 10,
      discount: 1,
      tax: 0,
      total: 10.25,
      delivery_fee: 1.25,
    });
  });

  it("splits an order evenly across three businesses to the cent-ish total", () => {
    const third = 1 / 3;
    const parts = [1, 2, 3].map(() => orderForBrandShare(order, third).total);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(41, 1);
  });
});
