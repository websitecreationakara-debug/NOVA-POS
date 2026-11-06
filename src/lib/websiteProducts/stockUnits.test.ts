import { describe, expect, it } from "vitest";
import { canPackSize, canPackSizeFromName } from "./stockUnits";

describe("canPackSize", () => {
  it("reads the number in front of can", () => {
    expect(canPackSize("24can")).toBe(24);
    expect(canPackSize("6 cans (350ml/can)")).toBe(6);
    expect(canPackSize(" 12 CANS")).toBe(12);
  });

  it("is 1 when the weight isn't a can pack", () => {
    expect(canPackSize("6 blts")).toBe(1);
    expect(canPackSize("10 pcs / box")).toBe(1);
    expect(canPackSize("canned")).toBe(1);
    expect(canPackSize(null)).toBe(1);
    expect(canPackSize("0can")).toBe(1);
  });
});

describe("canPackSizeFromName", () => {
  it("reads the pack out of a variation's POS name", () => {
    expect(canPackSizeFromName("test (24can)")).toBe(24);
    expect(canPackSizeFromName("Abashiri Draft - Can (6 cans (350ml/can))")).toBe(6);
    expect(canPackSizeFromName("Plain Product")).toBe(1);
    expect(canPackSizeFromName("Nakata Plum Wine (6 blts)")).toBe(1);
  });
});
