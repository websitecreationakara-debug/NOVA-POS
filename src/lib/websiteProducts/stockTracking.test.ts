import { describe, expect, it } from "vitest";
import { isStockUntracked } from "./stockTracking";
import type { WebsiteProduct } from "./types";

const base = { id: "p1", title: "x", variations: [] } as unknown as WebsiteProduct;

describe("isStockUntracked", () => {
  it("is untracked when a simple product's stock is blank", () => {
    expect(isStockUntracked({ ...base, stock: null }, "")).toBe(true);
  });

  it("is tracked when a simple product has a number, even 0", () => {
    expect(isStockUntracked({ ...base, stock: 5 }, "")).toBe(false);
    expect(isStockUntracked({ ...base, stock: 0 }, "")).toBe(false);
  });

  it("looks at the size's own stock for a variable product", () => {
    const product = {
      ...base,
      stock: null,
      variations: [
        { id: "a", stock: null },
        { id: "b", stock: 3 },
      ],
    } as unknown as WebsiteProduct;
    expect(isStockUntracked(product, "a")).toBe(true);
    expect(isStockUntracked(product, "b")).toBe(false);
  });

  it("treats an unknown size as tracked (push as before)", () => {
    expect(isStockUntracked(base, "missing")).toBe(false);
  });
});
