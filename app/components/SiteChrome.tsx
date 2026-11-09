"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BackToTopButton } from "./BackToTopButton";
import { GlassMotionController } from "./GlassMotionController";
import { LiquidGlassNavigation } from "./LiquidGlassNavigation";

/** /gallery is deliberately a minimal iframe shell with only its two controls. */
export function SiteChrome({ footer }: { footer: ReactNode }) {
  const isGallery = usePathname().startsWith("/gallery");

  return (
    <>
      {!isGallery && <GlassMotionController />}
      <LiquidGlassNavigation />
      {!isGallery && <BackToTopButton />}
      {!isGallery && footer}
    </>
  );
}
