import type { Metadata } from "next";
import { GlassMotionController } from "./components/GlassMotionController";
import { LiquidGlassNavigation } from "./components/LiquidGlassNavigation";
import { MotionTiltControl } from "./components/MotionTiltControl";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "积雨云的空间站",
    template: "%s — 积雨云的空间站",
  },
  description: "积雨云的空间站",
  verification: {
    google: "tLrExgZ6RF0M_O2E_7xx2rkTIuWOvI6oGTv-ync8ccE",
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: ["/favicon.svg"],
    apple: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <GlassMotionController />
        <MotionTiltControl />
        <LiquidGlassNavigation />
        <footer style={{ textAlign: "center", padding: "4rem 1rem 8rem", fontSize: "0.75rem", color: "rgba(255,255,255,0.4)" }}>
          <div style={{ marginBottom: "1.5rem" }}>
            <p style={{ margin: "0 0 0.75rem", opacity: 0.5, letterSpacing: "0.05em" }}>友情链接</p>
            <div style={{ display: "flex", justifyContent: "center", gap: "1.5rem", flexWrap: "wrap" }}>
              <a href="https://qingyou.studio/" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
                青柚工作室 - 用热爱创造无限可能
              </a>
              <a href="https://mxte.cc/" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
                Maxtune&apos;s Blog
              </a>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: "1rem", flexWrap: "wrap" }}>
            <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
              沪ICP备2026040143号
            </a>
            <a href="https://github.com/zephyr-roc" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
              Copyright © 2026 zephyr-roc
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
