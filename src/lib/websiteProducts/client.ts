import { getCatalog } from "./catalogs";
import type {
  WebsiteAddon,
  WebsiteAddonWrite,
  WebsiteCatalogId,
  WebsiteProduct,
  WebsiteProductWrite,
} from "./types";

function config(catalogId: WebsiteCatalogId) {
  const catalog = getCatalog(catalogId);
  const baseUrl = process.env[catalog.urlEnv];
  const key = process.env[catalog.keyEnv];
  if (!baseUrl) throw new Error(`${catalog.urlEnv} is not set`);
  if (!key) throw new Error(`${catalog.keyEnv} is not set`);
  return { catalog, baseUrl, key };
}

function authHeaders(catalogId: WebsiteCatalogId): Record<string, string> {
  const { catalog, key } = config(catalogId);
  return catalog.auth === "bearer"
    ? { Authorization: `Bearer ${key}` }
    : { "x-api-key": key };
}

// A response is only usable if it's actually JSON. Storefront sites are SPAs
// with a catch-all HTML fallback, so a missing/misrouted API endpoint answers
// with the site's 404 page (often HTTP 200) instead of an error status. Detect
// that and surface something actionable rather than a JSON.parse crash.
function looksLikeHtml(contentType: string | null, body: string): boolean {
  if (contentType?.includes("text/html")) return true;
  return /^\s*<(?:!doctype|html)\b/i.test(body);
}

async function request<T>(
  catalogId: WebsiteCatalogId,
  path: string,
  init?: RequestInit,
  baseUrlOverride?: string
): Promise<T> {
  const baseUrl = baseUrlOverride ?? config(catalogId).baseUrl;
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      // Some storefronts sit behind Cloudflare Bot Fight Mode, which serves a
      // 403 HTML challenge to requests with no/suspicious User-Agent. The
      // datacenter this runs in (Vercel) is exactly what that targets, so
      // present a normal browser UA. Real fix is a WAF skip rule on the
      // storefront for /api/ traffic; this is the client-side mitigation.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      ...init?.headers,
    },
  });

  const contentType = res.headers.get("content-type");

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const label = getCatalog(catalogId).label;
    if (looksLikeHtml(contentType, body)) {
      const cf = res.headers.get("cf-mitigated") || res.headers.get("cf-ray");
      const snippet = body.replace(/\s+/g, " ").trim().slice(0, 160);
      throw new Error(
        `Website products API returned HTML (${res.status}) from ${url}` +
          (cf ? ` — looks like a Cloudflare block/challenge on the storefront (cf: ${cf}).` : " — the endpoint looks undeployed or misrouted, not a real JSON API.") +
          (snippet ? ` Body: "${snippet}"` : "")
      );
    }
    // Pull the storefront's own error string out of a JSON error body.
    let storefrontError = "";
    try {
      const parsed = JSON.parse(body) as { error?: string; message?: string };
      storefrontError = parsed.error || parsed.message || "";
    } catch {
      /* not JSON */
    }
    // 5xx = the storefront is up but its API is broken (missing DB binding,
    // mid-deploy, etc.). Nothing this app can do about it.
    if (res.status >= 500) {
      throw new Error(
        `The ${label} storefront's product API is down` +
          (storefrontError ? ` ("${storefrontError}")` : ` (HTTP ${res.status})`) +
          ` — this is a problem on the storefront itself, not the POS.`
      );
    }
    throw new Error(
      `${label} products API ${res.status}: ${storefrontError || body.slice(0, 300) || res.statusText}`
    );
  }

  if (res.status === 204) return undefined as T;

  const raw = await res.text();
  if (looksLikeHtml(contentType, raw)) {
    throw new Error(
      `Website products API returned HTML instead of JSON from ${url} — the endpoint looks undeployed or misrouted (got the site's fallback page).`
    );
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `Website products API returned invalid JSON from ${url}: ${raw.slice(0, 500)}`
    );
  }
}

// Catalogs store `image_url` (and `video_url`) as a site-relative path like
// `/media/hojicha-abc123.jpg` — the filename is derived from the product. Those
// resolve against the storefront origin, not this app's, so make them absolute
// using the API base URL's origin before handing them to the UI. A "variable"
// product's variations carry their own image_url the same way.
function absolutizeMedia(catalogId: WebsiteCatalogId, product: WebsiteProduct): WebsiteProduct {
  const { origin } = new URL(config(catalogId).baseUrl);
  const fix = (u: string | null) =>
    u && u.startsWith("/") ? `${origin}${u}` : u;
  return {
    ...product,
    image_url: fix(product.image_url),
    video_url: fix(product.video_url),
    variations: product.variations?.map((v) => ({ ...v, image_url: fix(v.image_url) })),
  };
}

// Inverse of absolutizeMedia: strip our own origin prefix off a media URL so the
// catalog keeps storing it the same site-relative way it always has. Leaves
// URLs pointing elsewhere (a real CDN) untouched.
function relativizeMediaWrite(
  catalogId: WebsiteCatalogId,
  input: Partial<WebsiteProductWrite>
): Partial<WebsiteProductWrite> {
  const { origin } = new URL(config(catalogId).baseUrl);
  const strip = (u: string | null | undefined) =>
    typeof u === "string" && u.startsWith(`${origin}/`) ? u.slice(origin.length) : u;
  const out = { ...input };
  if ("image_url" in out) out.image_url = strip(out.image_url);
  if ("video_url" in out) out.video_url = strip(out.video_url);
  return out;
}

// The storefront DBs reject an empty string where they want null -- most
// visibly `category_id`, which is a UUID column, so `""` from a blank form
// field 500s the whole create. Normalise "" -> null on the nullable text
// fields before sending.
const NULLABLE_TEXT_FIELDS = [
  "description",
  "category_id",
  "image_url",
  "video_url",
  "weight",
  "taste_notes",
  "promotion_id",
] as const;

function blankToNull(input: Partial<WebsiteProductWrite>): Partial<WebsiteProductWrite> {
  const out: Record<string, unknown> = { ...input };
  for (const key of NULLABLE_TEXT_FIELDS) {
    if (typeof out[key] === "string" && (out[key] as string).trim() === "") {
      out[key] = null;
    }
  }
  return out as Partial<WebsiteProductWrite>;
}

// Catalogs disagree on envelope shape: some return a bare array / object, others
// wrap it as `{ count, products: [...] }` / `{ product: {...} }` (BOSBA Drink &
// Snack) or `{ data: ... }` (BOSBA Premium Foods). Try each wrapper key in turn.
function unwrap<T>(payload: unknown, keys: ("data" | "products" | "product")[]): T {
  if (payload && typeof payload === "object") {
    for (const key of keys) {
      if (key in payload) return (payload as Record<string, unknown>)[key] as T;
    }
  }
  return payload as T;
}

// One page of listWebsiteProducts -- factored out so the paged and unpaged
// paths below share the same request/unwrap/validate logic.
async function fetchProductsPage(
  catalogId: WebsiteCatalogId,
  query: string
): Promise<WebsiteProduct[]> {
  const payload = await request<unknown>(catalogId, query ? `?${query}` : "", {
    headers: authHeaders(catalogId),
  });
  const products = unwrap<WebsiteProduct[]>(payload, ["data", "products"]);
  if (!Array.isArray(products)) {
    throw new Error(
      `Website products API returned an unexpected shape (expected an array or { products: [] }).`
    );
  }
  return products;
}

// Stock is an admin view, so include drafts where the catalog supports it.
export async function listWebsiteProducts(
  catalogId: WebsiteCatalogId
): Promise<WebsiteProduct[]> {
  const { listAllParam, listPageSize } = getCatalog(catalogId);
  // Always send the credential: some catalogs (sorasake.wine) require auth on
  // every request, others use it only to widen the list to include drafts.
  let products: WebsiteProduct[];
  if (listPageSize) {
    // Page through instead of one big request -- see listPageSize's comment.
    products = [];
    for (let offset = 0; ; offset += listPageSize) {
      const base = listAllParam ? `${listAllParam}&` : "";
      const page = await fetchProductsPage(catalogId, `${base}limit=${listPageSize}&offset=${offset}`);
      products.push(...page);
      if (page.length < listPageSize) break;
    }
  } else {
    products = await fetchProductsPage(catalogId, listAllParam ?? "");
  }
  return products.map((p) => absolutizeMedia(catalogId, p));
}

// Throws for a catalog with no add-on endpoint configured -- unlike the read
// path below, a write action (edit/delete) should fail loudly rather than
// silently no-op.
function addonsBaseUrl(catalogId: WebsiteCatalogId): string {
  const catalog = getCatalog(catalogId);
  if (!catalog.addonsUrlEnv) throw new Error(`${catalog.label} has no add-on API configured`);
  const url = process.env[catalog.addonsUrlEnv];
  if (!url) throw new Error(`${catalog.addonsUrlEnv} is not set`);
  return url;
}

// This storefront's separate add-on catalog (rice, sauce, extra ikura, ...),
// if it has one -- see addonsUrlEnv on the catalog config. Empty array (not
// an error) for a catalog with no add-on endpoint configured yet, so
// Sales/Stock just show nothing for those businesses instead of failing.
export async function listWebsiteAddons(catalogId: WebsiteCatalogId): Promise<WebsiteAddon[]> {
  const catalog = getCatalog(catalogId);
  if (!catalog.addonsUrlEnv) return [];
  const baseUrl = process.env[catalog.addonsUrlEnv];
  if (!baseUrl) return [];

  const payload = await request<unknown>(catalogId, "?status=all", {
    headers: authHeaders(catalogId),
  }, baseUrl);
  const addons = unwrap<WebsiteAddon[]>(payload, ["data"]);
  if (!Array.isArray(addons)) {
    throw new Error(
      `Website add-ons API returned an unexpected shape (expected an array or { data: [] }).`
    );
  }
  const { origin } = new URL(baseUrl);
  return addons.map((a) => ({
    ...a,
    image_url: a.image_url && a.image_url.startsWith("/") ? `${origin}${a.image_url}` : a.image_url,
  }));
}

// Stock's Addons modal: edit price/stock, or delete, directly against the
// storefront's own add-on table (PATCH/DELETE /api/v1/addons/:id) -- separate
// from the product write endpoints, so an addon id never flows through them.
export async function updateWebsiteAddon(
  catalogId: WebsiteCatalogId,
  id: string,
  input: { price?: number; stock?: number | null; status?: WebsiteAddon["status"] }
): Promise<WebsiteAddon> {
  const baseUrl = addonsBaseUrl(catalogId);
  const payload = await request<unknown>(catalogId, `/${id}`, {
    method: "PATCH",
    headers: authHeaders(catalogId),
    body: JSON.stringify(input),
  }, baseUrl);
  return unwrap<WebsiteAddon>(payload, ["data"]);
}

export async function createWebsiteAddon(
  catalogId: WebsiteCatalogId,
  input: WebsiteAddonWrite
): Promise<WebsiteAddon> {
  const baseUrl = addonsBaseUrl(catalogId);
  const payload = await request<unknown>(catalogId, "", {
    method: "POST",
    headers: authHeaders(catalogId),
    body: JSON.stringify(input),
  }, baseUrl);
  return unwrap<WebsiteAddon>(payload, ["data"]);
}

export async function deleteWebsiteAddon(catalogId: WebsiteCatalogId, id: string): Promise<void> {
  const baseUrl = addonsBaseUrl(catalogId);
  await request<void>(catalogId, `/${id}`, {
    method: "DELETE",
    headers: authHeaders(catalogId),
  }, baseUrl);
}

// Add-ons ride along in the same sellable grid as regular products (Sales
// only -- see SalesWebsiteGrid) under a synthetic "Addon" category, so tapping
// one to sell it reuses all the existing website-product cart/link machinery
// instead of a parallel one. Never merged into Stock's editable product panel:
// an add-on's id lives in a different table on the storefront, so running it
// through the product edit/delete endpoints there would silently no-op or 404.
export const ADDON_CATEGORY_ID = "__addon__";

export function addonToWebsiteProduct(addon: WebsiteAddon): WebsiteProduct {
  return {
    id: addon.id,
    title: addon.title,
    description: addon.description,
    price: addon.price,
    sale_price: null,
    category_id: ADDON_CATEGORY_ID,
    stock: addon.stock,
    status: addon.status,
    image_url: addon.image_url,
    badge: null,
    rating: null,
    weight: null,
    pcs: null,
    type: "simple",
    sort_order: addon.sort_order,
    featured: false,
    promotion_id: null,
    video_url: null,
  };
}

// Sales' sellable grid: regular products plus, if this storefront has one,
// its add-on catalog merged in as its own "Addon" category (see
// addonToWebsiteProduct). Used for both the initial page load and the grid's
// own polling refresh, so add-ons don't disappear again a few seconds after
// the page first renders them. Stock's product panel deliberately calls
// listWebsiteProducts directly instead -- see addonToWebsiteProduct's comment
// on why add-ons never go through the editable product list.
export async function listSellableWebsiteProducts(
  catalogId: WebsiteCatalogId
): Promise<{ products: WebsiteProduct[]; addonCount: number }> {
  const [products, addons] = await Promise.all([
    listWebsiteProducts(catalogId),
    listWebsiteAddons(catalogId).catch(() => []),
  ]);
  return {
    products: addons.length > 0 ? [...products, ...addons.map(addonToWebsiteProduct)] : products,
    addonCount: addons.length,
  };
}

export async function getWebsiteProduct(
  catalogId: WebsiteCatalogId,
  idOrSlug: string
): Promise<WebsiteProduct> {
  const payload = await request<unknown>(catalogId, `/${idOrSlug}`, {
    headers: authHeaders(catalogId),
  });
  return absolutizeMedia(catalogId, unwrap<WebsiteProduct>(payload, ["data", "product"]));
}

export async function createWebsiteProduct(
  catalogId: WebsiteCatalogId,
  input: WebsiteProductWrite
): Promise<{ id: string }> {
  const payload = await request<unknown>(catalogId, "", {
    method: "POST",
    headers: authHeaders(catalogId),
    body: JSON.stringify(relativizeMediaWrite(catalogId, blankToNull(input))),
  });
  return unwrap<{ id: string }>(payload, ["data", "product"]);
}

export function updateWebsiteProduct(
  catalogId: WebsiteCatalogId,
  id: string,
  input: Partial<WebsiteProductWrite>
): Promise<void> {
  return request<void>(catalogId, `/${id}`, {
    method: "PATCH",
    headers: authHeaders(catalogId),
    body: JSON.stringify(relativizeMediaWrite(catalogId, blankToNull(input))),
  });
}

// Updates one variation's own price/stock (etc.) directly on the storefront,
// via its dedicated sub-route -- the plain product PATCH/PUT never touches
// child variation rows (confirmed: a `variations` body 422s there, or on
// catalogs where PUT tolerates unknown fields, silently drops the change).
// Catalogs disagree on the response envelope key just like everywhere else
// in this file (BOSBA Drink & Snack and sorasake wrap it as `{ product }`,
// BOSBA Premium Foods as `{ data }`) -- unwrap() tries each in turn instead
// of assuming one, which crashed here reading `.image_url` off `undefined`
// on the catalog that doesn't use `product`.
export async function updateWebsiteProductVariation(
  catalogId: WebsiteCatalogId,
  productId: string,
  variationId: string,
  input: { price?: number; stock?: number | null }
): Promise<WebsiteProduct> {
  const payload = await request<unknown>(catalogId, `/${productId}/variations/${variationId}`, {
    method: "PATCH",
    headers: authHeaders(catalogId),
    body: JSON.stringify(input),
  });
  return absolutizeMedia(catalogId, unwrap<WebsiteProduct>(payload, ["data", "product"]));
}

export function deleteWebsiteProduct(
  catalogId: WebsiteCatalogId,
  id: string
): Promise<void> {
  return request<void>(catalogId, `/${id}`, {
    method: "DELETE",
    headers: authHeaders(catalogId),
  });
}

// Deletes a single variation of a "variable" product via its dedicated
// sub-route, leaving the parent product and its other variations in place --
// the plain product DELETE above takes the whole product with every size. Same
// route family as updateWebsiteProductVariation (PATCH /:id/variations/:vid).
export function deleteWebsiteProductVariation(
  catalogId: WebsiteCatalogId,
  productId: string,
  variationId: string
): Promise<void> {
  return request<void>(catalogId, `/${productId}/variations/${variationId}`, {
    method: "DELETE",
    headers: authHeaders(catalogId),
  });
}
