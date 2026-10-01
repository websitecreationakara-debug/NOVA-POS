import { describe, expect, it } from "vitest";
import { toFullPhone } from "./phone";

describe("toFullPhone", () => {
  it("puts 855 in front of the digits typed", () => {
    expect(toFullPhone("85251742")).toBe("85585251742");
    expect(toFullPhone("12795200")).toBe("85512795200");
  });

  it("drops the local leading 0", () => {
    expect(toFullPhone("012795200")).toBe("85512795200");
  });

  it("keeps a full number that was typed or pasted", () => {
    expect(toFullPhone("85585251742")).toBe("85585251742");
    expect(toFullPhone("+855 85 251 742")).toBe("85585251742");
  });

  it("ignores spaces and dashes", () => {
    expect(toFullPhone("85-251 742")).toBe("85585251742");
  });

  it("still prefixes a short local number that starts with 855", () => {
    expect(toFullPhone("85512345")).toBe("85585512345");
  });

  it("stays empty when nothing is typed", () => {
    expect(toFullPhone("")).toBe("");
    expect(toFullPhone("0")).toBe("");
    expect(toFullPhone("abc")).toBe("");
  });
});
