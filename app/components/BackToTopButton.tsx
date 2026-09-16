"use client";

import { useEffect, useRef } from "react";
import { Glass, type GlassOptics } from "./liquid-glass";

const NAVIGATION_GAP = 18;
const MIN_VIEWPORT_EDGE_GAP = 12;
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
  dispersion: 0,
  frost: 1,
  saturate: 1.35,
  specular: 0,
  sheen: 0,
  sheenWidth: 2.5,
  glow: 0,
};

export function BackToTopButton() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const navigation = document.querySelector<HTMLElement>(".liquid-navigation");
    const separateRight = Number.parseFloat(getComputedStyle(root).right) || 22;
    let animationFrame = 0;

    const updateVisibility = () => {
      animationFrame = 0;
      const scrollRange = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const buttonWidth = root.offsetWidth;
      const navigationWidth = navigation?.offsetWidth ?? 0;
      const separateGap = navigation
        ? window.innerWidth
          - separateRight
          - buttonWidth
          - (window.innerWidth + navigationWidth) / 2
        : window.innerWidth - separateRight - buttonWidth;
      const canStaySeparate = separateGap >= NAVIGATION_GAP;
      const groupedWidth = navigationWidth + NAVIGATION_GAP + buttonWidth;
      const canGroup = navigation
        ? groupedWidth + MIN_VIEWPORT_EDGE_GAP * 2 <= window.innerWidth
        : canStaySeparate;
      const hasScrollablePage = scrollRange >= MIN_SCROLL_RANGE;
      const hasScrolledEnough = window.scrollY >= window.innerHeight * SHOW_AFTER_VIEWPORT_RATIO;
      const isGrouped = Boolean(
        navigation
        && hasScrollablePage
        && hasScrolledEnough
        && !canStaySeparate
        && canGroup,
      );

      root.dataset.grouped = String(isGrouped);
      root.style.setProperty("--bottom-group-half-width", `${groupedWidth / 2}px`);
      if (navigation) {
        navigation.dataset.grouped = String(isGrouped);
        navigation.style.setProperty(
          "--bottom-navigation-shift",
          `${(NAVIGATION_GAP + buttonWidth) / 2}px`,
        );
      }

      root.dataset.visible = String(
        (canStaySeparate || canGroup) && hasScrollablePage && hasScrolledEnough,
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
      delete root.dataset.grouped;
      root.style.removeProperty("--bottom-group-half-width");
      if (navigation) {
        delete navigation.dataset.grouped;
        navigation.style.removeProperty("--bottom-navigation-shift");
      }
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
