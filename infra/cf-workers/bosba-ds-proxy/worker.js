// Transparent reverse proxy: bosba-ds-proxy.<subdomain>.workers.dev -> bosbadrinksnack.com
//
// Why this exists: bosbadrinksnack.com is on Cloudflare's free plan with Bot
// Fight Mode ON, which serves a JS "Just a moment..." challenge to requests
// from datacenter IPs (Vercel). The NOVA-POS server can't solve that. A Worker's
// outbound fetch originates from Cloudflare's own network, which Bot Fight Mode
// does not challenge -- so the POS calls this Worker instead of the domain
// directly. Public visitors still hit bosbadrinksnack.com with full protection.
//
// Deploy:  npx wrangler deploy   (from this directory)
const TARGET = "bosbadrinksnack.com";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.hostname = TARGET;
    url.port = "";

    const upstream = new Request(url.toString(), request);
    upstream.headers.set("host", TARGET);
    if (!upstream.headers.get("user-agent")) {
      upstream.headers.set("user-agent", "Mozilla/5.0 (NOVA-POS proxy)");
    }

    const resp = await fetch(upstream, { cf: { cacheEverything: false } });
    const headers = new Headers(resp.headers);
    headers.set("access-control-allow-origin", "*");
    return new Response(resp.body, { status: resp.status, headers });
  },
};
