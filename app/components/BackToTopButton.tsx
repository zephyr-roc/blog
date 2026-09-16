"use client";

import { useEffect, useRef } from "react";
import { Glass, type GlassOptics } from "./liquid-glass";

const NAVIGATION_GAP = 18;
const MIN_SCROLL_RANGE = 240;
const SHOW_AFTER_VIEWPORT_RATIO = 0.65;
const FALLBACK_DELAY = 900;

const backToTopGlassOptics: Partial<GlassOptics> = {
  strength: .2,
  scaleX: .22,
  scaleY: .18,
  depth: .92,
  curvature: .72,
  bend: .88,
  bendWidth: .28,
  dispersion: .72,
  frost: 1,
  saturate: 1.35,
  specular: .9,
  sheen: .4,
  sheenWidth: 2.5,
  glow: 0,
};

export function BackToTopButton() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const navigation = document.querySelector<HTMLElement>(".liquid-navigation");
    let animationFrame = 0;

    const updateVisibility = () => {
      animationFrame = 0;
      const scrollRange = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const rootBounds = root.getBoundingClientRect();
      const navigationBounds = navigation?.getBoundingClientRect();
      const hasHorizontalRoom = navigationBounds
        ? rootBounds.left - navigationBounds.right >= NAVIGATION_GAP
        : rootBounds.left >= NAVIGATION_GAP;
      const hasScrollablePage = scrollRange >= MIN_SCROLL_RANGE;
      const hasScrolledEnough = window.scrollY >= window.innerHeight * SHOW_AFTER_VIEWPORT_RATIO;

      root.dataset.visible = String(
        hasHorizontalRoom && hasScrollablePage && hasScrolledEnough,
      );
    };

    const scheduleVisibilityUpdate = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(updateVisibility);
    };

    const resizeObserver = new ResizeObserver(scheduleVisibilityUpdate);
    resizeObserver.observe(document.documentElement);
    if (navigation) resizeObserver.observe(navigation);
    window.addEventListener("scroll", scheduleVisibilityUpdate, { passive: true });
    window.addEventListener("resize", scheduleVisibilityUpdate, { passive: true });
    updateVisibility();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("scroll", scheduleVisibilityUpdate);
      window.removeEventListener("resize", scheduleVisibilityUpdate);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  const returnToTop = () => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      window.scrollTo(0, 0);
      return;
    }

    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    window.setTimeout(() => {
      if (window.scrollY > 1) window.scrollTo(0, 0);
    }, FALLBACK_DELAY);
  };

  return (
    <div
      ref={rootRef}
      className="back-to-top-button"
      data-visible="false"
    >
      <Glass
        className="back-to-top-button__glass"
        radius={999}
        optics={backToTopGlassOptics}
        aria-hidden="true"
      >
        <span className="back-to-top-button__glass-tint" />
      </Glass>
      <button
        className="back-to-top-button__control"
        type="button"
        aria-label="返回页面顶部"
        onClick={returnToTop}
      >
        <svg className="back-to-top-button__arrow" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7 11 5-5 5 5M12 6v12" />
        </svg>
      </button>
    </div>
  );
}
