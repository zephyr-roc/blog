"use client";

import { useEffect, useRef } from "react";

const NAVIGATION_GAP = 18;
const MIN_SCROLL_RANGE = 240;
const SHOW_AFTER_VIEWPORT_RATIO = 0.65;
const FALLBACK_DELAY = 900;

export function BackToTopButton() {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;

    const navigation = document.querySelector<HTMLElement>(".liquid-navigation");
    let animationFrame = 0;

    const updateVisibility = () => {
      animationFrame = 0;
      const scrollRange = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const buttonBounds = button.getBoundingClientRect();
      const navigationBounds = navigation?.getBoundingClientRect();
      const hasHorizontalRoom = navigationBounds
        ? buttonBounds.left - navigationBounds.right >= NAVIGATION_GAP
        : buttonBounds.left >= NAVIGATION_GAP;
      const hasScrollablePage = scrollRange >= MIN_SCROLL_RANGE;
      const hasScrolledEnough = window.scrollY >= window.innerHeight * SHOW_AFTER_VIEWPORT_RATIO;

      button.dataset.visible = String(
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
    <button
      ref={buttonRef}
      className="back-to-top-button"
      type="button"
      data-visible="false"
      aria-label="返回页面顶部"
      onClick={returnToTop}
    >
      <svg className="back-to-top-button__yarn" viewBox="0 0 52 52" aria-hidden="true">
        <circle cx="26" cy="26" r="20" />
        <path d="M10 22c9 0 24 7 32 17M16 10c1 11 13 26 27 28M8 31c10-8 25-13 37-10M21 7c7 7 13 23 12 38" />
      </svg>
      <svg className="back-to-top-button__arrow" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m7 11 5-5 5 5M12 6v12" />
      </svg>
    </button>
  );
}
