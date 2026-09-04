import type { Metadata } from "next";
import { GlassMotionController } from "./components/GlassMotionController";
import { LiquidGlassNavigation } from "./components/LiquidGlassNavigation";
import {
  serializeJsonLd,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  websiteJsonLd,
} from "./lib/seo";
import "./globals.css";

const CRITICAL_FALLBACK_CSS = `
@layer fallback {
  :root {
    color-scheme: dark;
    background: #09090d;
    color: #f4f4f5;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; min-width: 280px; background: #09090d; color: #f4f4f5; line-height: 1.65; }
  main { display: block; width: min(72rem, 100%); margin-inline: auto; padding: 1.5rem 1.125rem 3rem; }
  header, section, article, nav, footer { display: block; }
  h1, h2, h3, p { overflow-wrap: anywhere; }
  a { color: inherit; text-underline-offset: .2em; }
  img, svg { max-width: 100%; height: auto; }
  pre, table { max-width: 100%; overflow: auto; }
  pre { padding: 1rem; border-radius: .75rem; background: #18181f; }
  code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
  table { display: block; border-collapse: collapse; }
  th, td { padding: .5rem; border: 1px solid #3f3f46; }
  .ambient, .grain, .glass-card__base, .interaction-hint,
  .liquid-navigation__backdrop, .liquid-navigation__refraction,
  .liquid-navigation__indicator, .liquid-navigation__icon { display: none; }
  .site-header { display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 2rem; }
  .wordmark { font-weight: 700; }
  .card-collection, .card-collection__row, .post-list { display: grid; gap: 1rem; padding: 0; }
  .card-collection__item, .post-list__item, .about-card {
    padding: 1rem;
    border: 1px solid #3f3f46;
    border-radius: 1rem;
    list-style: none;
  }
  .collection-card-link, .post-list__link { display: block; }
  .collection-card__icon-wrap { width: 4rem; }
  .liquid-navigation { margin: 2rem 1.125rem; }
  .liquid-navigation__surface { display: flex; flex-wrap: wrap; gap: .75rem; }
  .liquid-navigation__item {
    display: inline-flex;
    padding: .5rem .75rem;
    border: 1px solid #52525b;
    border-radius: 999px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
}
`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: "积雨云", url: "https://github.com/zephyr-roc" }],
  creator: "积雨云（zephyr-roc）",
  publisher: "积雨云（zephyr-roc）",
  verification: {
    google: "tLrExgZ6RF0M_O2E_7xx2rkTIuWOvI6oGTv-ync8ccE",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: "/",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  icons: {
    icon: [
      { url: "/favicon.png?v=2", type: "image/png", sizes: "64x64" },
      { url: "/favicon.svg?v=2", type: "image/svg+xml", sizes: "any" },
    ],
    shortcut: [
      { url: "/favicon.png?v=2", type: "image/png", sizes: "64x64" },
    ],
    apple: [
      {
        url: "/apple-touch-icon.png?v=2",
        type: "image/png",
        sizes: "180x180",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <style data-critical-fallback>{CRITICAL_FALLBACK_CSS}</style>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(websiteJsonLd) }}
        />
      </head>
      <body>
        {children}
        <GlassMotionController />
        <LiquidGlassNavigation />
        <footer className="global-footer" data-nosnippet style={{ textAlign: "center", padding: "4rem 1rem 8rem", fontSize: "0.75rem", color: "rgba(255,255,255,0.4)" }}>
          <div style={{ marginBottom: "1.5rem" }}>
            <p style={{ margin: "0 0 0.75rem", opacity: 0.5, letterSpacing: "0.05em" }}>友情链接</p>
            <div style={{ display: "flex", justifyContent: "center", gap: "1.5rem", flexWrap: "wrap" }}>
              <a href="https://qingyou.studio/" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
                青柚工作室 - 用热爱创造无限可能
              </a>
              <a href="https://mxte.cc/" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
                Maxtune&apos;s Blog
              </a>
              <a href="https://shulaoda.me/" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
                shulaoda&apos;s blog
              </a>
              <a href="https://dreamlike-ocean.github.io/blog/" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
                dreamlike-ocean&apos;s Blog
              </a>
              <a href="https://kawhicurry.github.io/" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
                KawhiCurry&apos;s Blog
              </a>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: "1rem", flexWrap: "wrap" }}>
            <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
              沪ICP备2026040143号
            </a>
            <a href="https://github.com/zephyr-roc" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
              Copyright © 2026 Zephyr
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
