import type { Metadata } from "next";
import { GlassMotionController } from "./components/GlassMotionController";
import { LiquidGlassNavigation } from "./components/LiquidGlassNavigation";
import { MotionTiltControl } from "./components/MotionTiltControl";
import "./globals.css";

export const metadata: Metadata = {
  title: "積雨雲的空間站",
  description: "積雨雲的空間站",
  icons: { icon: "/favicon.svg" },
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
              {/* 在此添加友情链接，例如：
              <a href="https://example.com" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>示例站点</a>
              */}
            </div>
          </div>
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
            沪ICP备2026040143号
          </a>
        </footer>
      </body>
    </html>
  );
}
