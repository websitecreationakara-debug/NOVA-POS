import { describe, expect, it } from "vitest";
import { stockGroupKey, stockGroupMembers } from "./stockGroups";

describe("stockGroupKey", () => {
  it("shares a group for the same flavor, whatever the can pack", () => {
    expect(stockGroupKey({ flavor: "Lemon", weight: "6 cans" })).toBe(stockGroupKey({ flavor: " lemon ", weight: "12 cans" }));
  });

  it("splits different flavors", () => {
    expect(stockGroupKey({ flavor: "test1", weight: "6can" })).not.toBe(stockGroupKey({ flavor: "test2", weight: "24can" }));
  });

  it("splits liquid sizes of the same flavor", () => {
    expect(stockGroupKey({ flavor: "Muscat", weight: "1.8L" })).not.toBe(stockGroupKey({ flavor: "Muscat", weight: "720 ml" }));
    expect(stockGroupKey({ flavor: "Muscat", weight: "720ml" })).toBe(stockGroupKey({ flavor: "muscat", weight: "720 ML" }));
  });

  it("treats no flavor as one group", () => {
    expect(stockGroupKey({ flavor: null, weight: "6 cans (350ml/can)" })).toBe(stockGroupKey({ flavor: "", weight: "24 cans (350ml/can)" }));
  });
});

describe("stockGroupMembers", () => {
  it("returns the variations drawing from the same count", () => {
    const vs = [
      { id: "a", flavor: "x", weight: "6can" },
      { id: "b", flavor: "x", weight: "24can" },
      { id: "c", flavor: "y", weight: "6can" },
    ];
    expect(stockGroupMembers(vs, vs[0]).map((v) => v.id)).toEqual(["a", "b"]);
  });
});
