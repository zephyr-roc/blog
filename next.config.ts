import type { NextConfig } from "next";

const immutableCache = [
  {
    key: "Cache-Control",
    value: "public, max-age=31536000, immutable",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
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
