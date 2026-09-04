import type { WebsiteCatalogId } from "./types";

// How a catalog's write endpoints expect the API credential to be presented.
type AuthScheme = "bearer" | "x-api-key";

export type WebsiteCatalog = {
  id: WebsiteCatalogId;
  label: string;
  // `slug` of the Supabase `brands` row this storefront belongs to. Stock >
  // Website shows the catalog for whichever brand is selected.
  brandSlug: string;
  // env var holding the API base URL, up to and including `/api/products`
  urlEnv: string;
  // env var holding the API credential (server-only, never NEXT_PUBLIC_)
  keyEnv: string;
  auth: AuthScheme;
  // When set, the list endpoint takes this query string to include drafts
  // (and requires auth to do so). Omit for catalogs whose list is all-or-nothing.
  listAllParam?: string;
  // Category filter chips for the Sales > Website tab. The storefront product
  // API only returns a `category_id` (a UUID) per product and has no endpoint
  // for category names, so the `label`s below were inferred from the products
  // in each group -- edit them to match the storefront's own wording. A
  // product whose `category_id` isn't listed here just isn't matched by any
  // chip (still shown under "All"). Order here is the chip order.
  categories?: { id: string; label: string }[];
};

export const CATALOGS: WebsiteCatalog[] = [
  {
    // sorasake.wine catalog API. URL env points at
    // `https://sorasake.wine/api/products` (list/create path). Every request
    // sends `Authorization: Bearer <token>`; the token is the site's
    // PRODUCTS_API_KEY (STOCK_SYNC_SECRET is its server-side fallback).
    id: "sorasake",
    label: "sorasake.wine",
    brandSlug: "sora-sake",
    urlEnv: "SORA_SAKE_PRODUCTS_API_URL",
    keyEnv: "SORA_SAKE_PRODUCTS_API_KEY",
    auth: "bearer",
    categories: [
      { id: "0c378c91-e44e-4682-95f9-3bdbc3bb4cbd", label: "Junmai Daiginjo" },
      { id: "6b25e917-3fa8-4b3e-a9cd-4c0d13c20300", label: "Junmai Ginjo" },
      { id: "f8957d9b-a277-4f02-9600-2354c907573c", label: "Junmai" },
      { id: "0f7fcf91-1e19-4893-9b8e-12b7e0ce51dd", label: "Tokubetsu Junmai" },
      { id: "96efe27a-0c1b-4845-b9d8-c3a76dfeee3f", label: "Honjozo" },
      { id: "1c5407eb-6b9e-4ece-aaca-75a9bc41d980", label: "Sparkling Sake" },
      { id: "f67d12bd-27c4-4c45-ad78-ec12deb4eed5", label: "Yuzu Liqueurs" },
      { id: "86dbe25f-203d-4513-b14e-8b0ae233823c", label: "Specialty & Limited" },
    ],
  },
  {
    id: "bosba_drink_snack",
    label: "BOSBA Drink & Snack",
    brandSlug: "bosba-drink-snack",
    urlEnv: "BOSBA_DRINK_SNACK_PRODUCTS_API_URL",
    keyEnv: "BOSBA_DRINK_SNACK_PRODUCTS_API_TOKEN",
    auth: "bearer",
    listAllParam: "status=all",
    categories: [
      { id: "1344104a-7f28-4571-8de3-5737fd6b5943", label: "Premium Beer" },
      { id: "8d71a882-9348-4e54-9794-5c820c6310dc", label: "Plum Wine" },
      { id: "5dc32014-2863-4b7a-a61d-f14243cc35db", label: "Shochu" },
      { id: "58a4cf5f-6c17-47dd-8938-1a2bbaed0011", label: "Pre-mixed Drink" },
      { id: "b6b25ff0-2b07-44aa-bdcd-f8a53f6826eb", label: "Matcha & Tea" },
      { id: "a7964c0a-2c0f-4b98-95df-c7178f3c6f6c", label: "Dessert" },
      { id: "b7868efe-11dd-49bf-9818-f04318b78bf2", label: "Convenient" },
    ],
  },
  {
    // bosbapremiumfoods.com public catalog API (v1). URL env must point at
    // `https://bosbapremiumfoods.com/api/v1/products` — the list/create path.
    id: "bosba_premium_food",
    label: "BOSBA Premium Foods",
    brandSlug: "bosba-premium-foods",
    urlEnv: "BOSBA_PREMIUM_FOODS_PRODUCTS_API_URL",
    keyEnv: "BOSBA_PREMIUM_FOODS_PRODUCTS_API_KEY",
    auth: "x-api-key",
    // status=all + drafts require the write key; limit is capped at 500.
    listAllParam: "status=all&limit=500",
    categories: [
      { id: "2bfa6d66-0314-4b31-b106-927f22562edd", label: "Shellfish" },
      { id: "12688a96-7835-4478-ab2d-413f1b242f3f", label: "Squid & Octopus" },
      { id: "27aac9d4-0ca6-44f3-a859-3a7cef39379d", label: "Fish" },
      { id: "ef53f57b-f062-4a97-89f9-56cd97ae060d", label: "Bluefin Tuna" },
      { id: "ca66bc98-89b8-4f44-af9e-81c90d3cabfb", label: "Roe" },
      { id: "567a5e28-c64d-443d-a447-548f007188be", label: "Seaweed" },
      { id: "a703cec2-3643-49e3-8e83-b0775bd9cc89", label: "Sashimi Sets" },
      { id: "3e002f3d-aeed-4131-b535-a50385d66acc", label: "Wagyu" },
      { id: "6e283908-db0f-4d15-aed3-bea95f778223", label: "Rice & Noodles" },
      { id: "747166db-f03c-4e45-b9c1-bb26fbfb458f", label: "Pantry" },
    ],
  },
];

export function getCatalog(id: WebsiteCatalogId): WebsiteCatalog {
  const catalog = CATALOGS.find((c) => c.id === id);
  if (!catalog) throw new Error(`Unknown website catalog: ${id}`);
  return catalog;
}

// Catalogs whose URL + key env vars are both configured in this environment.
export function configuredCatalogs(): WebsiteCatalog[] {
  return CATALOGS.filter((c) => process.env[c.urlEnv] && process.env[c.keyEnv]);
}

// The configured catalog for a brand, if that brand has a storefront wired up.
export function catalogForBrandSlug(slug: string): WebsiteCatalog | null {
  return configuredCatalogs().find((c) => c.brandSlug === slug) ?? null;
}
