"use client";

import { useLayoutEffect, useRef } from "react";
import { galleryViewportRect } from "../lib/gallery-viewport.mjs";

export function GalleryViewport() {
  const probeRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const probe = probeRef.current;
    if (!probe) return;

    root.dataset.galleryActive = "true";
    let frame = 0;
    const update = () => {
      frame = 0;
      const visualViewport = window.visualViewport;
      const rect = galleryViewportRect({
        visualHeight: visualViewport?.height,
        visualWidth: visualViewport?.width,
        visualOffsetTop: visualViewport?.offsetTop,
        visualOffsetLeft: visualViewport?.offsetLeft,
        visualScale: visualViewport?.scale,
        layoutHeight: window.innerHeight,
        layoutWidth: window.innerWidth,
      });
      if (!rect) return;

      // Afilmory's iframe is sized in CSS pixels to the current visible region,
      // not to Safari's large viewport or the physical screen dimensions.
      root.style.setProperty("--gallery-visual-height", `${rect.height}px`);
      root.style.setProperty("--gallery-visual-width", `${rect.width}px`);
      root.style.setProperty("--gallery-visual-top", `${rect.top}px`);
      root.style.setProperty("--gallery-visual-left", `${rect.left}px`);
      root.style.setProperty("--gallery-layout-height", `${rect.layoutHeight}px`);
      root.dataset.galleryViewportReady = "true";

      // The iframe may need the parent's inset for its own bottom UI. Pass the
      // inset rather than subtracting it twice from the iframe's dimensions.
      const safeBottom = Number.parseFloat(getComputedStyle(probe).paddingBottom) || 0;
      root.style.setProperty("--gallery-safe-bottom", `${safeBottom}px`);
      window.dispatchEvent(new CustomEvent("blog:gallery-viewport-change", {
        detail: {
          safeBottom,
          visualHeight: rect.height,
          visualWidth: rect.width,
          visualOffsetTop: rect.top,
          visualOffsetLeft: rect.left,
        },
      }));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("pageshow", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);

    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.removeEventListener("pageshow", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      if (frame) window.cancelAnimationFrame(frame);
      delete root.dataset.galleryViewportReady;
      delete root.dataset.galleryActive;
      for (const name of [
        "--gallery-visual-height",
        "--gallery-visual-width",
        "--gallery-visual-top",
        "--gallery-visual-left",
        "--gallery-layout-height",
        "--gallery-safe-bottom",
      ]) root.style.removeProperty(name);
    };
  }, []);

  return <span ref={probeRef} className="gallery-viewport-probe" aria-hidden="true" />;
}
