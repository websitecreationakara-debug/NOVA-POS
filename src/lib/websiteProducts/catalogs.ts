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
  },
  {
    id: "bosba_drink_snack",
    label: "BOSBA Drink & Snack",
    brandSlug: "bosba-drink-snack",
    urlEnv: "BOSBA_DRINK_SNACK_PRODUCTS_API_URL",
    keyEnv: "BOSBA_DRINK_SNACK_PRODUCTS_API_TOKEN",
    auth: "bearer",
    listAllParam: "status=all",
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
