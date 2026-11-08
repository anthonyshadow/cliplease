import type { NextConfig } from "next";

// Read raw: next build fixes these headers into its manifest, and importing src/server/env.ts here would make every
// config load (typegen included) need a complete env. Build and start with the same APP_ENV.
const isProduction = process.env.APP_ENV === "production";
const NOINDEX = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
// Buyer-token pages (02 §9.5): the key is in the URL, so no referrer leaves them.
const BUYER_TOKEN = [
  ...NOINDEX,
  { key: "Referrer-Policy", value: "no-referrer" },
];

const nextConfig: NextConfig = {
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // 02 §4.6. When two rules set one key the later wins, so the buyer-token and My licenses rows follow /(.*). CSP is
  // [H2].
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          ...(isProduction
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains",
                },
              ]
            : []),
        ],
      },
      { source: "/sign-in", headers: NOINDEX },
      { source: "/dashboard/:path*", headers: NOINDEX },
      { source: "/onboarding", headers: NOINDEX },
      { source: "/admin/:path*", headers: NOINDEX },
      // The public record, its 404 and its 308 (01 J10.5): noindex only; it keeps the default referrer policy.
      { source: "/verify/:path*", headers: NOINDEX },
      { source: "/r/:path*", headers: BUYER_TOKEN },
      { source: "/l/:path*", headers: BUYER_TOKEN },
      { source: "/api/licenses/:path*", headers: BUYER_TOKEN },
      // My licenses (P20b; 07 D126): private to the session, so no index and no referrer, as the buyer-token pages.
      { source: "/licenses/:path*", headers: BUYER_TOKEN },
      // Its two session downloads: never cached either (the routes also send DOWNLOAD_HEADERS).
      {
        source: "/api/my/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
  // /@handle and /@handle/slug are served by /u/[handle] and the license page /u/[handle]/[slug] (02 §4.3; afterFiles,
  // the array form). Never redirect /u/* to /@*.
  async rewrites() {
    return [
      { source: "/@:handle", destination: "/u/:handle" },
      { source: "/@:handle/:slug", destination: "/u/:handle/:slug" },
    ];
  },
  // The dev storage route's signed URLs carry object keys, upload ids and signatures, and buyer links their key: keep
  // them out of `next dev`'s request log (P10a, P16a: never log them).
  logging: {
    incomingRequests: {
      ignore: [/\/api\/dev\/storage\//, /^\/(?:r|l|api\/licenses)\//],
    },
  },
  // The license PDF reads its fonts from disk (src/server/pdf/fonts.ts), which tracing can't see: ship them with both
  // of its routes. Keys are route globs, so the dynamic segment's brackets are escaped.
  outputFileTracingIncludes: {
    "/api/licenses/\\[token\\]/pdf": ["./src/server/pdf/fonts/**/*"],
    "/api/my/licenses/\\[licenseId\\]/pdf": ["./src/server/pdf/fonts/**/*"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "1mb",
    },
  },
};

export default nextConfig;
