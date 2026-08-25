import type { Metadata } from "next";
import { BackdropLayoutProvider } from "./components/BackdropLayoutContext";
import { GlassMotionController } from "./components/GlassMotionController";
import { LiquidGlassNavigation } from "./components/LiquidGlassNavigation";
import { MotionTiltControl } from "./components/MotionTiltControl";
import {
  serializeJsonLd,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  websiteJsonLd,
} from "./lib/seo";
import "./globals.css";

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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(websiteJsonLd) }}
        />
      </head>
      <body>
        <BackdropLayoutProvider>
          {children}
          <GlassMotionController />
          <MotionTiltControl />
          <LiquidGlassNavigation />
        </BackdropLayoutProvider>
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
