import type { NextConfig } from "next";

const immutableCache = [
  {
    key: "Cache-Control",
    value: "public, max-age=31536000, immutable",
  },
];

// Imported explicitly by vite.config.ts. Keeping this under a non-Next.js
// filename prevents EdgeOne from loading its OpenNext server adapter.
const nextConfig: NextConfig = {
  output: process.env.CLOUDFLARE_STATIC === "1" ? "export" : "standalone",
  images: { unoptimized: true },
  expireTime: 120,
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: immutableCache,
      },
      {
        source: "/favicon.svg",
        headers: immutableCache,
      },
      {
        source: "/favicon.png",
        headers: immutableCache,
      },
      {
        source: "/apple-touch-icon.png",
        headers: immutableCache,
      },
      {
        source: "/zig-logomark.svg",
        headers: immutableCache,
      },
      {
        source: "/covers/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, stale-while-revalidate=2592000",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
