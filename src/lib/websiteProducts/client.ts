import { getCatalog } from "./catalogs";
import type { WebsiteCatalogId, WebsiteProduct, WebsiteProductWrite } from "./types";

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
  init?: RequestInit
): Promise<T> {
  const { baseUrl } = config(catalogId);
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
    if (looksLikeHtml(contentType, body)) {
      const cf = res.headers.get("cf-mitigated") || res.headers.get("cf-ray");
      const snippet = body.replace(/\s+/g, " ").trim().slice(0, 160);
      throw new Error(
        `Website products API returned HTML (${res.status}) from ${url}` +
          (cf ? ` — looks like a Cloudflare block/challenge on the storefront (cf: ${cf}).` : " — the endpoint looks undeployed or misrouted, not a real JSON API.") +
          (snippet ? ` Body: "${snippet}"` : "")
      );
    }
    throw new Error(
      `Website products API ${res.status}: ${body.slice(0, 500) || res.statusText}`
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
// using the API base URL's origin before handing them to the UI.
function absolutizeMedia(catalogId: WebsiteCatalogId, product: WebsiteProduct): WebsiteProduct {
  const { origin } = new URL(config(catalogId).baseUrl);
  const fix = (u: string | null) =>
    u && u.startsWith("/") ? `${origin}${u}` : u;
  return { ...product, image_url: fix(product.image_url), video_url: fix(product.video_url) };
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

// Stock is an admin view, so include drafts where the catalog supports it.
export async function listWebsiteProducts(
  catalogId: WebsiteCatalogId
): Promise<WebsiteProduct[]> {
  const { listAllParam } = getCatalog(catalogId);
  // Always send the credential: some catalogs (sorasake.wine) require auth on
  // every request, others use it only to widen the list to include drafts.
  const payload = await request<unknown>(catalogId, listAllParam ? `?${listAllParam}` : "", {
    headers: authHeaders(catalogId),
  });
  const products = unwrap<WebsiteProduct[]>(payload, ["data", "products"]);
  if (!Array.isArray(products)) {
    throw new Error(
      `Website products API returned an unexpected shape (expected an array or { products: [] }).`
    );
  }
  return products.map((p) => absolutizeMedia(catalogId, p));
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
    body: JSON.stringify(relativizeMediaWrite(catalogId, input)),
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
    body: JSON.stringify(relativizeMediaWrite(catalogId, input)),
  });
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
