// Marketing > Broadcast: turns a business's products into the "business > category > group > item" tree
// used for customer broadcasts, and into a copy-ready message and a month plan.
//
// Products carry no group of their own (most have no POS category at all), so each business has a
// BroadcastConfig that reads the group from the product name, see groupOf().

export type BroadcastGroup = string;

export type BroadcastConfig = {
  // brands.slug
  slug: string;
  // Groups in tree order. A product no rule puts in any of them (test rows, add-ons like lettuce or Sauce)
  // isn't broadcast: there is no "Other" group.
  groups: readonly string[];
  // First match on the product name wins, so the order matters.
  rules: [RegExp, BroadcastGroup][];
  // Tried when no name rule matched: the product's POS category.
  categoryRules?: [RegExp, BroadcastGroup][];
  // Where the group sits above it in the tree.
  path: (group: BroadcastGroup) => [business: string, category: string];
  // The month plan takes one group a day in this order. A group with nothing in stock is skipped (and joins
  // the rotation once restocked), so neighbouring days differ.
  planOrder: readonly BroadcastGroup[];
};

// A product with this much stock or less is announced as "limited stock".
export const LIMITED_STOCK = 5;

// ---- BOSBA Drink&Snack: Beverage > Premium Alcohol > group ----

const DRINK_TREE_GROUPS = [
  "Whisky",
  "Premium Beer",
  "Pre-Mixed Drink",
  "Plum Wine",
  "Shochu & Liquor",
  "Tea & Matcha",
  "Coffee & Water",
  "Mochi & Cake",
  "Sake Taste",
];

export const DRINK_SNACK: BroadcastConfig = {
  slug: "bosba-drink-snack",
  groups: [...DRINK_TREE_GROUPS, "Snack", "Health Drink"],
  // Sweets before tea/sake ("Matcha Mochikon", "Sake Cream Mochi"), pre-mixed before plum wine
  // ("Umeshu Sour"), tea before water ("Water Matcha").
  rules: [
    [/mochi|daifuku|cake|brownie|crepe|sweet potato/i, "Mochi & Cake"],
    [/whisk|hibiki|sakhrani/i, "Whisky"],
    [/jack daniel|canada dry|jelly wine|highball|umeshu sour/i, "Pre-Mixed Drink"],
    [/plum wine|umeshu|plum tonic/i, "Plum Wine"],
    [/shochu|liqueur|liquor|kotsuzumi/i, "Shochu & Liquor"],
    [/beer|lager|premium malt|ichiban|akiaji|sapporo|kirin/i, "Premium Beer"],
    [/tea|matcha|hojicha|houji|gyokuro/i, "Tea & Matcha"],
    [/coffee|water/i, "Coffee & Water"],
    [/\bsake\b|junmai|ginjo/i, "Sake Taste"],
    [/furikake|konjac|natto|surume/i, "Snack"],
    [/ukon|hawthorn|concentrate|buckthorn|vinegar/i, "Health Drink"],
  ],
  path: (g) => (DRINK_TREE_GROUPS.includes(g) ? ["Beverage", "Premium Alcohol"] : [g, ""]),
  planOrder: [
    "Premium Beer",
    "Mochi & Cake",
    "Pre-Mixed Drink",
    "Tea & Matcha",
    "Plum Wine",
    "Snack",
    "Health Drink",
    "Whisky",
    "Shochu & Liquor",
    "Coffee & Water",
    "Sake Taste",
  ],
};

// ---- BOSBA Premium Foods: Seafoods > Frozen / Fresh / Cooked, Meat & Poultry > Frozen Meat ----

const FROZEN_SEAFOOD = ["Premium Fish", "Roe", "Shellfish", "Fish"];
const FRESH_SEAFOOD = ["Premium Fresh Fish", "Fresh Roe", "Fresh Fish"];

export const PREMIUM_FOODS: BroadcastConfig = {
  slug: "bosba-premium-foods",
  groups: [...FROZEN_SEAFOOD, ...FRESH_SEAFOOD, "Cooked Seafoods", "Japanese Beef", "Pantry"],
  // Pantry first ("Fresh Wasabi" is a seasoning, not fresh fish), then fresh, then cooked, then the frozen
  // groups from the most specific (roe, shellfish) to the broadest (fish).
  rules: [
    [/wagyu|beef|bulgogi/i, "Japanese Beef"],
    [
      /soy sauce|shoyu|\bnori\b|\bwasabi\b|seaweed|wakame|sea grapes|shiso|udon|garlic|edamame|myoga|sudachi|benitade|kogiku|hanaho|yuzu peel|green yuzu|japonica|brown rice|white rice|sushi rice/i,
      "Pantry",
    ],
    [/^fresh .*(sea urchin|\buni\b|roe|caviar)/i, "Fresh Roe"],
    [/^fresh .*(bluefin|tuna|salmon|yellowtail|sea bream|madai|akamutsu|nodoguro|kinki|snapper|shima aji|sawara|sashimi)/i, "Premium Fresh Fish"],
    [/^fresh /i, "Fresh Fish"],
    [/deep fried|boiled(?! octopus)|simmered|seared|seasoned|marinated|tataki/i, "Cooked Seafoods"],
    [/sea urchin|\buni\b|roe|ikura|masago|caviar|tobiko|kazunoko|nishin|mentariko|mentaiko|shirako/i, "Roe"],
    [/crab|kani|oyster|shrimp|\bebi\b|clam|scallop|whelk|akagai|ark shell|hokkigai|torigai|cockle|surimi/i, "Shellfish"],
    [/tuna|otoro|akami|negitoro|hamachi|yellowtail|salmon|sashimi|sushi|\bset\b/i, "Premium Fish"],
    [/fish|eel|unagi|capelin|caplin|octopus|tako|squid|engawa|halibut|dory|cod\b|monkfish|narutomaki|kamaboko/i, "Fish"],
  ],
  path: (g) =>
    FROZEN_SEAFOOD.includes(g)
      ? ["Seafoods", "Frozen Seafoods"]
      : FRESH_SEAFOOD.includes(g)
        ? ["Seafoods", "Fresh Seafoods"]
        : g === "Cooked Seafoods"
          ? ["Seafoods", "Cooked Seafoods"]
          : g === "Japanese Beef"
            ? ["Meat & Poultry", "Frozen Meat"]
            : [g, ""],
  planOrder: [
    "Japanese Beef",
    "Roe",
    "Cooked Seafoods",
    "Shellfish",
    "Premium Fish",
    "Fish",
    "Premium Fresh Fish",
    "Fresh Roe",
    "Fresh Fish",
    "Pantry",
  ],
};

// ---- SORA SAKE: Beverage > Premium Alcohol > group ----
// The sheet groups sake by taste (Umami, Classic, Clean & Dry ...). Nothing in the data says how a sake tastes,
// so sake is grouped by what its name does say: grade, flavouring, sparkling.

const SAKE_GROUPS = ["Junmai Daiginjo", "Daiginjo", "Junmai Ginjo", "Flavored Sake", "Sparkling Sake", "Other Sake"];

export const SORA_SAKE: BroadcastConfig = {
  slug: "sora-sake",
  groups: [
    ...SAKE_GROUPS,
    "Whisky",
    "Premium Beer",
    "Pre-Mixed Drink",
    "Plum Wine",
    "Shochu & Liquor",
    "Non-Alcohol",
  ],
  rules: [
    [/non-alcohol|alcohol-free/i, "Non-Alcohol"],
    [/whisk|hibiki|sakhrani|yamazaki|hakushu|nikka/i, "Whisky"],
    [/jack daniel|highball|\bsour\b|jim beam|canad(?:a|ian) dry|coca-cola/i, "Pre-Mixed Drink"],
    [/plum|umeshu|choya/i, "Plum Wine"],
    [/shochu|kirishima|iichiko|liqueur|chill green|awamori/i, "Shochu & Liquor"],
    [/beer|asahi|kirin|sapporo|lager|abashiri/i, "Premium Beer"],
    [/sparkling/i, "Sparkling Sake"],
    [/yuzu|matcha|gari|flavor/i, "Flavored Sake"],
    [/junmai daiginjo|dassai/i, "Junmai Daiginjo"],
    [/daiginjo/i, "Daiginjo"],
    [/ginjo/i, "Junmai Ginjo"],
  ],
  categoryRules: [[/sake/i, "Other Sake"]],
  path: () => ["Beverage", "Premium Alcohol"],
  planOrder: [
    "Junmai Daiginjo",
    "Flavored Sake",
    "Daiginjo",
    "Junmai Ginjo",
    "Other Sake",
    "Sparkling Sake",
    "Whisky",
    "Premium Beer",
    "Pre-Mixed Drink",
    "Plum Wine",
    "Shochu & Liquor",
    "Non-Alcohol",
  ],
};

// In the order the Broadcast page offers them.
export const BROADCAST_CONFIGS: BroadcastConfig[] = [DRINK_SNACK, PREMIUM_FOODS, SORA_SAKE];

export function configForSlug(slug: string): BroadcastConfig | undefined {
  return BROADCAST_CONFIGS.find((c) => c.slug === slug);
}

export function groupOf(name: string, config: BroadcastConfig = DRINK_SNACK, category?: string | null): BroadcastGroup {
  for (const [re, group] of config.rules) if (re.test(name)) return group;
  if (category) for (const [re, group] of config.categoryRules ?? []) if (re.test(category)) return group;
  // In none of the business's groups: left out of the broadcast.
  return "Other";
}

export type BroadcastProduct = {
  id: string;
  name: string;
  price: number;
  // null = no stock row.
  stock: number | null;
  // Orders of the last 90 days that included it.
  orders: number;
  // The product's POS category name, if it has one.
  category?: string | null;
};

export type BroadcastOption = { pack: string; price: number };

export type BroadcastItem = {
  key: string;
  name: string;
  options: BroadcastOption[];
  stock: number;
  orders: number;
  limited: boolean;
  // Priority across every item of the business, 1 = broadcast first (see buildBroadcast).
  grade: number;
};

export type BroadcastSection = {
  group: BroadcastGroup;
  // Business and category above the group in the tree; category is "" when the group sits right under the business.
  path: [business: string, category: string];
  // Position in the business's month-plan rotation; -1 = not part of it.
  planRank: number;
  items: BroadcastItem[];
  // Products of the group that can't be broadcast right now (out of stock or no price).
  held: string[];
};

const PAREN = /\((?:[^()]|\([^()]*\))*\)/g;

// "Jack Daniel's Coca Cola Zero Sugar (24 Cans)" -> the product "Jack Daniel's Coca Cola Zero Sugar" sold in
// the pack "24 Cans". Only parentheses that describe a pack (start with a number, or "Case") are taken off;
// "(Apple)" / "(Peach)" stay, because those are different products.
export function splitPack(name: string): { base: string; pack: string } {
  let pack = "";
  const base = name
    .replace(PAREN, (m) => {
      const inner = m.slice(1, -1).trim();
      if (!/^(\d|case\b)/i.test(inner)) return m;
      const nested = inner.match(/\(([^()]*)\)/)?.[1]?.trim();
      const rest = inner.replace(/\([^()]*\)/g, "").trim();
      pack = nested && /^(\d+\s*(ml|g|kg|l)|case)$/i.test(rest) ? nested : rest;
      return "";
    })
    .replace(/\s{2,}/g, " ")
    .trim();
  if (/^\d+$/.test(pack)) pack = `×${pack}`;
  return { base, pack };
}

// Best first: most orders in the last 90 days, then most stock, then name.
const byGrade = (a: BroadcastItem, b: BroadcastItem) =>
  b.orders - a.orders || b.stock - a.stock || a.name.localeCompare(b.name);

export function buildBroadcast(products: BroadcastProduct[], config: BroadcastConfig = DRINK_SNACK): BroadcastSection[] {
  type Family = { base: string; group: BroadcastGroup; options: Map<string, BroadcastOption>; stock: number; orders: number };
  const families = new Map<string, Family>();
  for (const p of products) {
    const { base, pack } = splitPack(p.name);
    const group = groupOf(p.name, config, p.category);
    const key = `${group}|${base.toLowerCase()}`;
    const f = families.get(key) ?? { base, group, options: new Map(), stock: 0, orders: 0 };
    families.set(key, f);
    f.orders += p.orders;
    // Pack variants of one product share its stock.
    if ((p.stock ?? 0) > 0 && p.price > 0) {
      f.stock = Math.max(f.stock, p.stock ?? 0);
      f.options.set(`${pack}|${p.price}`, { pack, price: p.price });
    }
  }

  const sections: BroadcastSection[] = config.groups.map((group) => {
    const inGroup = [...families.entries()].filter(([, f]) => f.group === group);
    const items = inGroup
      .filter(([, f]) => f.options.size > 0)
      .map(([key, f]): BroadcastItem => ({
        key,
        name: f.base,
        options: [...f.options.values()].sort((a, b) => a.price - b.price),
        stock: f.stock,
        orders: f.orders,
        limited: f.stock <= LIMITED_STOCK,
        grade: 0,
      }))
      .sort(byGrade);
    const held = inGroup.filter(([, f]) => f.options.size === 0).map(([, f]) => f.base).sort();
    return { group, path: config.path(group), planRank: config.planOrder.indexOf(group), items, held };
  });

  // Grade: 1, 2, 3 ... over all items, best first.
  sections
    .flatMap((s) => s.items)
    .sort(byGrade)
    .forEach((item, i) => {
      item.grade = i + 1;
    });
  return sections.filter((s) => s.items.length > 0 || s.held.length > 0);
}

// ---- Month plan: which products to broadcast on each date ----

// Items announced on one day (fewer if the group has fewer).
export const PLAN_ITEMS_PER_DAY = 3;

export type PlanDay = {
  date: string;
  group: BroadcastGroup | null;
  path: [business: string, category: string];
  items: BroadcastItem[];
};

// Every date of `month` (1-12), each with one group and its next items. Items go round in most-ordered-first
// order, so the best sellers come up again soonest. Depends only on the stock list and the month, not on
// today's date, so a plan doesn't shift while the month goes by.
export function planMonth(sections: BroadcastSection[], year: number, month: number): PlanDay[] {
  const rotation = sections.filter((s) => s.planRank >= 0 && s.items.length > 0).sort((a, b) => a.planRank - b.planRank);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return Array.from({ length: daysInMonth }, (_, i): PlanDay => {
    const date = `${year}-${pad(month)}-${pad(i + 1)}`;
    if (rotation.length === 0) return { date, group: null, path: ["", ""], items: [] };
    const section = rotation[i % rotation.length];
    const turn = Math.floor(i / rotation.length);
    const take = Math.min(PLAN_ITEMS_PER_DAY, section.items.length);
    const items = Array.from({ length: take }, (_, j) => section.items[(turn * take + j) % section.items.length]);
    return { date, group: section.group, path: section.path, items };
  });
}

export function weekdayOf(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

// The plan as a plain list, one line per date.
export function formatPlan(days: PlanDay[]): string {
  return days
    .map((d) =>
      d.group ? `${d.date} (${weekdayOf(d.date)}) — ${d.group}: ${d.items.map((i) => i.name).join(", ")}` : `${d.date} — nothing in stock`
    )
    .join("\n");
}

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

export function formatOptions(options: BroadcastOption[]): string {
  return options.map((o) => (o.pack ? `${o.pack} ${money(o.price)}` : money(o.price))).join(" / ");
}

// The path line above a group, e.g. "Beverage › Premium Alcohol".
const pathLine = (path: [string, string]) => path.filter(Boolean).join(" › ");

// The message: one line per chosen item, in tree order. The path (e.g. "Beverage › Premium Alcohol") is printed
// when it changes; a group named like the last part of its path (Snack, Cooked Seafoods) isn't printed twice.
export function formatBroadcast(businessName: string, sections: BroadcastSection[], selected: ReadonlySet<string>): string {
  const lines: string[] = [businessName];
  let prevPath = "";
  for (const s of sections) {
    const chosen = s.items.filter((i) => selected.has(i.key));
    if (chosen.length === 0) continue;
    const path = pathLine(s.path);
    if (path !== prevPath) {
      if (lines.length > 1) lines.push("");
      lines.push(path);
      prevPath = path;
    }
    if (s.group !== s.path.filter(Boolean).at(-1)) lines.push("", s.group);
    lines.push(...chosen.map((i) => `  • ${i.name} — ${formatOptions(i.options)}${i.limited ? " (limited stock)" : ""}`));
  }
  return lines.length > 1 ? lines.join("\n") : "";
}
