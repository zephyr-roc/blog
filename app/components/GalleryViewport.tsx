"use client";

import { useLayoutEffect, useRef } from "react";
import { galleryPaintHeight } from "../lib/gallery-viewport.mjs";

export function GalleryViewport() {
  const probeRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const probe = probeRef.current;
    if (!probe) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const height = galleryPaintHeight({
        isPhone: /iPhone|iPod/.test(navigator.userAgent),
        standalone: window.matchMedia("(display-mode: standalone)").matches
          || Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
        scale: window.visualViewport?.scale ?? 1,
        width: window.innerWidth,
        height: window.innerHeight,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        // Measure a resolved padding value: custom properties containing env()
        // are not consistently resolved to pixels by WebKit's getComputedStyle.
        safeTop: Number.parseFloat(getComputedStyle(probe).paddingTop) || 0,
      });
      if (height === null) root.style.removeProperty("--gallery-paint-height");
      else root.style.setProperty("--gallery-paint-height", `${height}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("pageshow", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.removeEventListener("pageshow", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
      root.style.removeProperty("--gallery-paint-height");
    };
  }, []);

  return <span ref={probeRef} className="gallery-viewport-probe" aria-hidden="true" />;
}
