import { describe, expect, it } from "vitest";
import { formatGrams, parseGrams, sizedLine } from "./weight";

describe("parseGrams", () => {
  it("reads grams and kilograms from a name", () => {
    expect(parseGrams("A4 Wagyu Sirloin Steak (350g)")).toBe(350);
    expect(parseGrams("Whole Salmon 1kg")).toBe(1000);
    expect(parseGrams("Fresh Sea Urchin Uni 100g Set")).toBe(100);
    expect(parseGrams("Tuna 1.5 KG")).toBe(1500);
  });

  it("returns null when there is no weight", () => {
    expect(parseGrams("Miyazaki Wagyu Bulgogi")).toBeNull();
    expect(parseGrams("Gift box 0g")).toBeNull();
  });
});

describe("formatGrams", () => {
  it("uses g below a kilo and kg from a kilo", () => {
    expect(formatGrams(100)).toBe("100g");
    expect(formatGrams(1000)).toBe("1kg");
    expect(formatGrams(1500)).toBe("1.5kg");
  });
});

describe("sizedLine", () => {
  it("scales quantity and price to the weight sold", () => {
    // 100g of a 350g $49 steak: $14.00 for 0.29 of a unit.
    const l = sizedLine(350, 100, 49)!;
    expect(l.label).toBe("100g");
    expect(l.quantity).toBe(0.29);
    expect(Math.round(l.quantity * l.unitPrice * 100) / 100).toBe(14);
  });

  it("works for part of a kilo", () => {
    const l = sizedLine(1000, 250, 80)!;
    expect(l.quantity).toBe(0.25);
    expect(l.unitPrice).toBe(80);
  });

  it("rejects unusable input", () => {
    expect(sizedLine(0, 100, 49)).toBeNull();
    expect(sizedLine(350, 0, 49)).toBeNull();
    expect(sizedLine(350, 0.1, 49)).toBeNull(); // rounds to 0 units
  });
});
