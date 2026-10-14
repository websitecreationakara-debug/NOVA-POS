import type { MetadataRoute } from "next";

// An internal POS: keep it out of search engines. Served as a real robots.txt
// (src/proxy.ts excludes it from the login redirect, which used to return the
// login page's HTML for this URL).
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
