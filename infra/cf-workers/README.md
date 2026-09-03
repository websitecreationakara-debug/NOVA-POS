# Cloudflare Worker proxies for the BOSBA storefront APIs

`bosbapremiumfoods.com` and `bosbadrinksnack.com` run on Cloudflare's **free**
plan with **Bot Fight Mode** enabled. Bot Fight Mode serves a JavaScript
challenge ("Just a moment…", HTTP 403) to requests coming from datacenter IP
ranges — which is exactly where the NOVA-POS server runs (Vercel). A server
cannot solve a JS challenge, so the Stock ▸ Website tab for those two brands
failed in production while working locally (a residential IP is not challenged).

Free Bot Fight Mode has **no per-path / per-IP exception** (only *Super* Bot
Fight Mode on the Pro plan does). A WAF "skip" rule cannot override it either.

## The fix

A tiny transparent reverse-proxy Worker per storefront, on `*.workers.dev`.
A Worker's outbound `fetch()` originates from Cloudflare's own network, which
Bot Fight Mode does not challenge. The POS calls the Worker; the Worker calls
the storefront. Public visitors still hit the real domain with full protection.

| Worker | Route | Forwards to |
| --- | --- | --- |
| `bosba-pf-proxy` | `https://bosba-pf-proxy.websitecreation-akara.workers.dev/*` | `https://bosbapremiumfoods.com/*` |
| `bosba-ds-proxy` | `https://bosba-ds-proxy.websitecreation-akara.workers.dev/*` | `https://bosbadrinksnack.com/*` |
| `sora-proxy` | `https://sora-proxy.websitecreation-akara.workers.dev/*` | `https://sorasake.wine/*` |

The POS points at these via env vars (Vercel project `nova-pos`, all environments):

```
BOSBA_PREMIUM_FOODS_PRODUCTS_API_URL = https://bosba-pf-proxy.websitecreation-akara.workers.dev/api/v1/products
BOSBA_DRINK_SNACK_PRODUCTS_API_URL    = https://bosba-ds-proxy.websitecreation-akara.workers.dev/api/products
SORA_SAKE_PRODUCTS_API_URL            = https://sora-proxy.websitecreation-akara.workers.dev/api/products
```

`sorasake.wine` initially worked without a proxy, but Bot Fight Mode is adaptive
and began challenging the Vercel egress IP after sustained traffic — so it needs
the proxy too.

## Deploy / update

```bash
cd infra/cf-workers/bosba-pf-proxy && npx wrangler deploy
cd infra/cf-workers/bosba-ds-proxy && npx wrangler deploy
```

Requires `wrangler login` with an account that can deploy Workers. The proxies
pass through method, headers (including `x-api-key` / `Authorization`), body and
status unchanged, so no maintenance is needed unless a storefront changes domain.
