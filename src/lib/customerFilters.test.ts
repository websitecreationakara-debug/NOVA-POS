import { describe, expect, it } from "vitest";
import { NO_CUSTOMER_FILTERS, parseCustomerFilters } from "./customerFilters";

describe("parseCustomerFilters", () => {
  it("returns no filters for an empty URL", () => {
    expect(parseCustomerFilters({})).toEqual(NO_CUSTOMER_FILTERS);
  });

  it("keeps valid values", () => {
    expect(
      parseCustomerFilters({
        sort: "spent",
        state: " Phnom Penh ",
        gender: "F",
        age: "25-34",
        since_from: "2025-01-01",
        since_to: "2025-12-31",
        bought_from: "2026-10-03",
        bought_to: "2026-10-03",
      })
    ).toEqual({
      sort: "spent",
      state: "Phnom Penh",
      gender: "F",
      age: "25-34",
      sinceFrom: "2025-01-01",
      sinceTo: "2025-12-31",
      boughtFrom: "2026-10-03",
      boughtTo: "2026-10-03",
    });
  });

  it("drops an unknown sort and malformed dates", () => {
    const f = parseCustomerFilters({ sort: "drop table", since_from: "yesterday", since_to: "2025-1-1" });
    expect(f.sort).toBe("name");
    expect(f.sinceFrom).toBe("");
    expect(f.sinceTo).toBe("");
    expect(parseCustomerFilters({ bought_from: "10/03/2026" }).boughtFrom).toBe("");
  });
});
