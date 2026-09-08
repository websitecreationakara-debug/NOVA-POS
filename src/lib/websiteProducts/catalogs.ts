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
    // Reconstructed from the live catalog: each id is a category actually in
    // use on a product, named from that group's contents (the storefront still
    // has no endpoint that returns category names). "Frozen Seafoods" and
    // "Premium Fish" are best guesses for one-off groups; the rest are certain.
    // Empty storefront categories (Sashimi Platters, Clam, Meat & Poultry, ...)
    // aren't listed because there's no product to read their id from.
    categories: [
      { id: "7104b338-dce2-4321-86ef-14a51f2c7eb6", label: "Sea Urchin Uni Set" },
      { id: "fa63a04e-ae55-4143-a92f-b5019a5bc48f", label: "Yellowtail Hamachi Set" },
      { id: "e8bdc51d-2414-412f-bdf6-97edd3dae098", label: "Fresh Salmon Set" },
      { id: "ac9fd32d-b2c6-4975-a38f-9031c206e661", label: "Bluefin Tuna Set" },
      { id: "d890551c-2bb6-4248-b412-b68f291926e4", label: "Premium Set 3in1" },
      { id: "6bbef514-6401-4cfb-aed0-24f362faf909", label: "Herring Fish Roe Nishin Set" },
      { id: "1ef789ee-a526-47e2-ac12-ddfa44fe2f26", label: "Fresh Smart Oyster Set" },
      { id: "32f16aec-f498-4172-bbc8-8ad6242c0350", label: "Frozen Seafoods" },
      { id: "12f5604f-cadd-47f9-a823-0a98f198c44c", label: "Premium Fish" },
      { id: "17e8d552-6523-4c3f-aa41-a91981987c16", label: "Oyster" },
      { id: "ad921dfe-9dd8-43a6-a0df-5d184e654e6e", label: "Shrimp" },
      { id: "8e175885-be70-43b0-8cb0-eca5ac6c753c", label: "Octopus" },
      { id: "4a3db7da-ecbd-44f6-841b-6afefb333bea", label: "Crab" },
      { id: "6a8245a4-7e2f-49e8-946a-61ab14748fa4", label: "Roe" },
      { id: "5ece57b0-2437-4f8c-997b-75e856c09a7f", label: "Fish" },
      { id: "b5c76baa-5747-481e-b2a9-1d67a3ef9c6a", label: "Japanese Wagyu" },
      { id: "d0d2f10b-cdf1-455c-8572-dcee309ce332", label: "Crossbred Wagyu" },
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
