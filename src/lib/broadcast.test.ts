import { describe, expect, it } from "vitest";
import {
  buildBroadcast,
  formatBroadcast,
  formatPlan,
  groupOf,
  planMonth,
  splitPack,
  DRINK_SNACK,
  PREMIUM_FOODS,
  SORA_SAKE,
  type BroadcastProduct,
} from "./broadcast";

const p = (name: string, price: number, stock: number | null, orders = 0): BroadcastProduct => ({
  id: name + price,
  name,
  price,
  stock,
  orders,
});

describe("groupOf", () => {
  it.each([
    ["Sakura Edition Sakhrani Whisky 700ml", "Whisky"],
    ["Sapporo Premium Beer - Can (24 Cans (500ml /Can))", "Premium Beer"],
    ["Suntory The Premium Malt's (6 Cans (350ml/Can))", "Premium Beer"],
    ["Jack Daniel's Canada Dry (6 cans)", "Pre-Mixed Drink"],
    ["Sparkling Jelly Wine (12 cans)", "Pre-Mixed Drink"],
    ["Suntory Umeshu Sour 350ml (case)", "Pre-Mixed Drink"],
    ["Ringohime Torokoku Plum Wine (Apple) (1 blt)", "Plum Wine"],
    ["Nakata Yuzu Umeshu", "Plum Wine"],
    ["Kurokirishima Shochu Imo (720ml)", "Shochu & Liquor"],
    ["Brown Rice Tea with Matcha (150g/pkt)", "Tea & Matcha"],
    ["YUTAS Water Matcha", "Tea & Matcha"],
    ["Kyoto OTOWA SPRING WATER Glass Bottle", "Coffee & Water"],
    ["Matcha Mochikon (5 pkt)", "Mochi & Cake"],
    ["Sake Cream Mochi Daifuku 30gx2", "Mochi & Cake"],
    ["Rice Flour Basque Cheesecake", "Mochi & Cake"],
    ["Premium Uni Furikake (5 pkt)", "Snack"],
    ["Ukon No Chikara - Original (6 blts)", "Health Drink"],
    ["Hawthorn Concentrate (3x Dilution) 500ml Bottle", "Health Drink"],
    ["product test", "Other"],
  ])("%s -> %s", (name, group) => {
    expect(groupOf(name)).toBe(group);
  });
});

describe("splitPack", () => {
  it("takes a pack off the name", () => {
    expect(splitPack("Jack Daniel's Coca Cola Zero Sugar (24 Cans)")).toEqual({
      base: "Jack Daniel's Coca Cola Zero Sugar",
      pack: "24 Cans",
    });
    expect(splitPack("Sapporo Premium Beer - Can (24 Cans (500ml /Can))").pack).toBe("24 Cans");
    expect(splitPack("Sapporo Lager Beer (Limited) (Case (24 cans))")).toEqual({
      base: "Sapporo Lager Beer (Limited)",
      pack: "24 cans",
    });
    expect(splitPack("Sapporo Lager Beer (Limited) (350ml (6 cans))").pack).toBe("6 cans");
    expect(splitPack("Baked Sweet Potato (10)").pack).toBe("×10");
  });

  it("keeps a flavour in the name", () => {
    expect(splitPack("Nakata Plum Wine (Apple)")).toEqual({ base: "Nakata Plum Wine (Apple)", pack: "" });
  });
});

describe("buildBroadcast", () => {
  const products = [
    p("Jack Daniel's Canada Dry (6 cans)", 19, 10, 23),
    p("Jack Daniel's Canada Dry (24 cans)", 70, 10, 2),
    p("Sapporo Premium Beer - Bottle (24 blts (330ml/blt))", 45, 23, 9),
    p("Sapporo Premium Beer - Bottle (6 blts (330ml/blt))", 11.9, 23, 0),
    p("Kishu Plum Wine (Red) (6 blts)", 36, 0, 0), // out of stock
    p("Sakura Edition Sakhrani Whisky 700ml", 0, 3), // no price
    p("Nakata Plum Wine (Apple)", 5.5, 2, 3), // limited
    p("Sparkling Jelly Wine (6 cans)", 17.5, 22, 1),
    p("Sparkling Jelly Wine (6 cans)", 17.5, 15, 2), // duplicate row of the same product
    p("Mashed Potatos", 3, -4), // negative stock
  ];
  const sections = buildBroadcast(products);
  const section = (g: string) => sections.find((s) => s.group === g);

  it("merges pack variants and sorts by orders", () => {
    const mixed = section("Pre-Mixed Drink")!;
    expect(mixed.items.map((i) => i.name)).toEqual(["Jack Daniel's Canada Dry", "Sparkling Jelly Wine"]);
    expect(mixed.items[0].options).toEqual([
      { pack: "6 cans", price: 19 },
      { pack: "24 cans", price: 70 },
    ]);
  });

  it("collapses duplicate rows and shares stock across packs", () => {
    const jelly = section("Pre-Mixed Drink")!.items[1];
    expect(jelly.options).toHaveLength(1);
    expect(jelly.stock).toBe(22);
    expect(jelly.orders).toBe(3);
  });

  it("holds back out-of-stock and unpriced products, and flags low stock", () => {
    expect(section("Plum Wine")!.held).toEqual(["Kishu Plum Wine (Red)"]);
    expect(section("Whisky")!.items).toEqual([]);
    expect(section("Whisky")!.held).toEqual(["Sakura Edition Sakhrani Whisky 700ml"]);
    expect(section("Plum Wine")!.items[0]).toMatchObject({ name: "Nakata Plum Wine (Apple)", limited: true });
    expect(section("Other")).toBeUndefined();
  });

  it("writes the message in tree order for the chosen items only", () => {
    const all = new Set(sections.flatMap((s) => s.items.map((i) => i.key)));
    const text = formatBroadcast("BOSBA Drink&Snack", sections, all);
    expect(text).toBe(
      [
        "BOSBA Drink&Snack",
        "Beverage › Premium Alcohol",
        "",
        "Premium Beer",
        "  • Sapporo Premium Beer - Bottle — 6 blts $11.90 / 24 blts $45",
        "",
        "Pre-Mixed Drink",
        "  • Jack Daniel's Canada Dry — 6 cans $19 / 24 cans $70",
        "  • Sparkling Jelly Wine — 6 cans $17.50",
        "",
        "Plum Wine",
        "  • Nakata Plum Wine (Apple) — $5.50 (limited stock)",
      ].join("\n")
    );
    const onlyBeer = new Set(section("Premium Beer")!.items.map((i) => i.key));
    expect(formatBroadcast("X", sections, onlyBeer)).not.toContain("Plum Wine");
    expect(formatBroadcast("X", sections, new Set())).toBe("");
  });
});

describe("planMonth", () => {
  const stocked = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => p(`${prefix} ${i + 1}`, 10, 20, n - i));
  const sections = buildBroadcast([
    ...stocked(4, "Sapporo Beer"), // Premium Beer, 4 items
    ...stocked(1, "Basque Cheesecake"), // Mochi & Cake, 1 item
    p("Hibiki Whisky", 100, 0), // out of stock: not in the rotation
  ]);

  it("lists every date of the month", () => {
    expect(planMonth(sections, 2026, 11)).toHaveLength(30);
    expect(planMonth(sections, 2028, 2)).toHaveLength(29);
    expect(planMonth(sections, 2026, 11)[0].date).toBe("2026-11-01");
    expect(planMonth(sections, 2026, 11)[29].date).toBe("2026-11-30");
  });

  it("alternates the groups in stock and goes round their items", () => {
    const days = planMonth(sections, 2026, 11);
    expect(days.slice(0, 4).map((d) => d.group)).toEqual(["Premium Beer", "Mochi & Cake", "Premium Beer", "Mochi & Cake"]);
    // 3 of 4 beers a day: day 1 = beers 1-3, day 3 = beers 4,1,2.
    expect(days[0].items.map((i) => i.name)).toEqual(["Sapporo Beer 1", "Sapporo Beer 2", "Sapporo Beer 3"]);
    expect(days[2].items.map((i) => i.name)).toEqual(["Sapporo Beer 4", "Sapporo Beer 1", "Sapporo Beer 2"]);
    expect(days[1].items).toHaveLength(1);
    expect(days.some((d) => d.group === "Whisky")).toBe(false);
  });

  it("copes with nothing in stock", () => {
    const days = planMonth([], 2026, 11);
    expect(days.every((d) => d.group === null && d.items.length === 0)).toBe(true);
    expect(formatPlan(days.slice(0, 1))).toBe("2026-11-01 — nothing in stock");
  });

  it("writes the plan as one line per date", () => {
    expect(formatPlan(planMonth(sections, 2026, 11).slice(0, 2))).toBe(
      [
        "2026-11-01 (Sun) — Premium Beer: Sapporo Beer 1, Sapporo Beer 2, Sapporo Beer 3",
        "2026-11-02 (Mon) — Mochi & Cake: Basque Cheesecake 1",
      ].join("\n")
    );
  });
});

describe("grade", () => {
  const sections = buildBroadcast([
    p("Sapporo Beer A", 10, 5, 2),
    p("Sapporo Beer B", 10, 50, 2), // same orders as A, more stock
    p("Basque Cheesecake", 4, 9, 7), // best seller
    p("Hojicha Tea", 15, 30, 0),
    p("product test", 1, 99, 99), // in no group: not broadcast, and takes no grade
  ]);
  const grades = Object.fromEntries(sections.flatMap((s) => s.items).map((i) => [i.name, i.grade]));

  it("numbers every item 1..N, best first", () => {
    expect(grades).toEqual({
      "Basque Cheesecake": 1,
      "Sapporo Beer B": 2,
      "Sapporo Beer A": 3,
      "Hojicha Tea": 4,
    });
  });

  it("keeps each group in grade order", () => {
    const beer = sections.find((s) => s.group === "Premium Beer")!;
    expect(beer.items.map((i) => i.grade)).toEqual([2, 3]);
  });
});

describe("section paths", () => {
  it("puts drinks under Beverage > Premium Alcohol and Snack on its own", () => {
    const paths = Object.fromEntries(
      buildBroadcast([p("Sapporo Beer", 5, 9), p("Matcha Mochikon", 5, 9), p("Konjac Black Pepper", 2, 9)]).map((s) => [s.group, s.path])
    );
    expect(paths["Premium Beer"]).toEqual(["Beverage", "Premium Alcohol"]);
    expect(paths["Mochi & Cake"]).toEqual(["Beverage", "Premium Alcohol"]);
    expect(paths["Snack"]).toEqual(["Snack", ""]);
  });
});

describe("BOSBA Premium Foods", () => {
  it.each([
    ["A4 Wagyu Sirloin Steak (350g)", "Japanese Beef"],
    ["Miyazaki Wagyu Bulgogi", "Japanese Beef"],
    ["Fresh Sea Urchin Ogawa Bara 250g", "Fresh Roe"],
    ["Fresh Salmon (1kg)", "Premium Fresh Fish"],
    ["Fresh Horse Mackerel Seki Saba", "Fresh Fish"],
    ["Fresh Wasabi (70g)", "Pantry"],
    ["Deep Fried Oysters", "Cooked Seafoods"],
    ["Boiled Snow Crab Claw Meat", "Cooked Seafoods"],
    ["Boiled Octopus Tako", "Fish"],
    ["Salmon Roe Ikura (100g)", "Roe"],
    ["Herring Roe Nishin Yellow (500g)", "Roe"],
    ["Sea Urchin Uni Set 100g", "Roe"],
    ["Crab Butter Kanimiso", "Shellfish"],
    ["Frozen Snow Crab Surimi", "Shellfish"],
    ["Frozen Minced Tuna Negitoro", "Premium Fish"],
    ["Fatty Bluefin Tuna Otoro (1kg)", "Premium Fish"],
    ["Grilled Eel Fillet Unagi (220g)", "Fish"],
    ["Capelin Fish", "Fish"],
    ["Frozen Japanese Fish Cake Narutomaki", "Fish"],
    ["Clear Soy sauce (Golden)", "Pantry"],
    ["Roasted Seaweed Nori", "Pantry"],
    ["Octopus Green Takowasabi", "Fish"],
    ["product test", "Other"],
  ])("%s -> %s", (name, group) => {
    expect(groupOf(name, PREMIUM_FOODS)).toBe(group);
  });

  it("builds the Seafoods / Meat tree and a message from it", () => {
    const sections = buildBroadcast(
      [
        p("A4 Wagyu Sirloin Steak (350g)", 49, 2, 4),
        p("A4 Wagyu Sirloin Steak (700g)", 98, 3, 1),
        p("Salmon Roe Ikura (100g)", 18, 2, 3),
        p("Deep Fried Oysters", 25, 21, 2),
        p("Clear Soy sauce (Golden)", 10, 11),
      ],
      PREMIUM_FOODS
    );
    expect(sections.map((s) => [s.group, ...s.path])).toEqual([
      ["Roe", "Seafoods", "Frozen Seafoods"],
      ["Cooked Seafoods", "Seafoods", "Cooked Seafoods"],
      ["Japanese Beef", "Meat & Poultry", "Frozen Meat"],
      ["Pantry", "Pantry", ""],
    ]);
    const all = new Set(sections.flatMap((s) => s.items.map((i) => i.key)));
    expect(formatBroadcast("BOSBA Premium Foods", sections, all)).toBe(
      [
        "BOSBA Premium Foods",
        "Seafoods › Frozen Seafoods",
        "",
        "Roe",
        "  • Salmon Roe Ikura — 100g $18 (limited stock)",
        "",
        "Seafoods › Cooked Seafoods",
        "  • Deep Fried Oysters — $25",
        "",
        "Meat & Poultry › Frozen Meat",
        "",
        "Japanese Beef",
        "  • A4 Wagyu Sirloin Steak — 350g $49 / 700g $98 (limited stock)",
        "",
        "Pantry",
        "  • Clear Soy sauce (Golden) — $10",
      ].join("\n")
    );
  });
});

describe("SORA SAKE", () => {
  it.each([
    ["Sakari No.11 Junmai Daiginjo 720ml", "Junmai Daiginjo"],
    ["SOUHANA Junmai Daiginjo 720ml", "Junmai Daiginjo"],
    ["Dassai 45 - 720ml", "Junmai Daiginjo"],
    ["Sakari No.12 Daiginjo 720ml", "Daiginjo"],
    ["Sakari No.13 Junmai Ginjo 720ml", "Junmai Ginjo"],
    ["Sakari No.21 YUZU (720ml)", "Flavored Sake"],
    ["SAKARI NO.22 MATCHA", "Flavored Sake"],
    ["Sakari No.23 Gari 700ml", "Flavored Sake"],
    ["Hinoshita Musou Junmai Sparkling 720ml", "Sparkling Sake"],
    ["Hibiki Japanese Harmony", "Whisky"],
    ["Jack Daniel's Coca Cola 350ml", "Pre-Mixed Drink"],
    ["Asahi Future Lemon Sour 345ml (Plain)", "Pre-Mixed Drink"],
    ["Asahi Super Dry 330ml (Case)", "Premium Beer"],
    ["Asahi Dry Zero Non-Alcohol Drink 350ml", "Non-Alcohol"],
    ["Choya Kishu Plum Wine", "Plum Wine"],
    ["Akane Kirishima 900ml", "Shochu & Liquor"],
    ["hello", "Other"],
  ])("%s -> %s", (name, group) => {
    expect(groupOf(name, SORA_SAKE)).toBe(group);
  });

  it("falls back to the POS category for a sake the name doesn't describe", () => {
    expect(groupOf("Fisherman Sokujo 720ml", SORA_SAKE, "Sake")).toBe("Other Sake");
    expect(groupOf("Fisherman Sokujo 720ml", SORA_SAKE)).toBe("Other");
  });

  it("puts every group under Beverage > Premium Alcohol", () => {
    const sections = buildBroadcast([p("Sakari No.21 YUZU (720ml)", 29, 3), p("SOUHANA Junmai Daiginjo 720ml", 59, 12)], SORA_SAKE);
    expect(sections.map((s) => s.path)).toEqual([
      ["Beverage", "Premium Alcohol"],
      ["Beverage", "Premium Alcohol"],
    ]);
    expect(planMonth(sections, 2026, 11).slice(0, 2).map((d) => d.group)).toEqual(["Junmai Daiginjo", "Flavored Sake"]);
  });
});

describe("no Other group", () => {
  const products = [
    p("hello", 1, 10),
    p("product test (100ml)", 5, 12, 3),
    p("lettuce", 0.35, 2, 1),
    p("Ukon No Chikara - Original (6 blts)", 21, 10, 3),
    p("Sapporo Beer", 5, 9, 2),
  ];

  it("leaves unmatched products out of every business's sections, plan and message", () => {
    for (const config of [DRINK_SNACK, PREMIUM_FOODS, SORA_SAKE]) {
      const sections = buildBroadcast(products, config);
      expect(sections.some((s) => s.group === "Other")).toBe(false);
      const names = sections.flatMap((s) => [...s.items.map((i) => i.name), ...s.held]);
      expect(names).not.toEqual(expect.arrayContaining(["hello"]));
      expect(names).not.toEqual(expect.arrayContaining(["lettuce"]));
      expect(names.some((n) => /product test/.test(n))).toBe(false);
    }
  });

  it("keeps real products that used to fall in Other", () => {
    const sections = buildBroadcast(products);
    expect(sections.find((s) => s.group === "Health Drink")!.items.map((i) => i.name)).toEqual(["Ukon No Chikara - Original"]);
    expect(planMonth(sections, 2026, 11).some((d) => d.group === "Health Drink")).toBe(true);
  });
});
