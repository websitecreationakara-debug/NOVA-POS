import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Gitignored local Cloudflare build output (from cf:build/preview/deploy)
    // -- not source, and eslint's flat config doesn't read .gitignore itself.
    ".open-next/**",
    ".wrangler/**",
    // A committed Vite production bundle (minified storefront build output,
    // not hand-written source) -- linting it crashes ESLint's formatter
    // (RangeError: Invalid string length) on its sheer size/line count.
    "idx.js",
  ]),
]);

export default eslintConfig;
