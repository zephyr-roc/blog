import type { Metadata } from "next";
import { GlassMotionController } from "./components/GlassMotionController";
import { LiquidGlassNavigation } from "./components/LiquidGlassNavigation";
import { MotionTiltControl } from "./components/MotionTiltControl";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kotlin, Nim & Zig — Languages in Motion",
  description: "三张会随指针旋转、折射光线的毛玻璃语言名片。",
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
        <footer style={{ textAlign: "center", padding: "1rem", fontSize: "0.75rem", color: "rgba(255,255,255,0.4)" }}>
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
            沪ICP备2026040143号
          </a>
        </footer>
      </body>
    </html>
  );
}
