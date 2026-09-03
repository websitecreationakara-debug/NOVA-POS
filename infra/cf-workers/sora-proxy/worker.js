// Transparent reverse proxy: sora-proxy.<subdomain>.workers.dev -> sorasake.wine
//
// Same rationale as bosba-pf-proxy / bosba-ds-proxy: sorasake.wine is on
// Cloudflare with Bot Fight Mode, which (adaptively) began challenging requests
// from the Vercel datacenter. A Worker's outbound fetch comes from Cloudflare's
// network and is not challenged. See ../README.md.
//
// Deploy:  npx wrangler deploy   (from this directory)
const TARGET = "sorasake.wine";

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
