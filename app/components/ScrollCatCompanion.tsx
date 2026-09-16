"use client";

import { useEffect, useRef, useState } from "react";

const CAT_TRAVEL = 88;
const MIN_VIEWPORT_HEIGHT = 520;
const MIN_SCROLL_RANGE = 80;
const NAVIGATION_GAP = 18;
const BOTTOM_TOLERANCE = 3;
const RUN_IDLE_DELAY = 150;

export function ScrollCatCompanion() {
  const companionRef = useRef<HTMLDivElement>(null);
  const [caught, setCaught] = useState(false);

  useEffect(() => {
    const companion = companionRef.current;
    if (!companion) return;

    const navigation = document.querySelector<HTMLElement>(".liquid-navigation");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animationFrame = 0;
    let idleTimer = 0;

    const getScrollRange = () => Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );

    const updatePosition = () => {
      animationFrame = 0;
      const scrollRange = getScrollRange();
      const progress = scrollRange === 0
        ? 0
        : Math.max(0, Math.min(1, window.scrollY / scrollRange));
      const isCaught = scrollRange > 0
        && window.scrollY >= scrollRange - BOTTOM_TOLERANCE;

      companion.style.setProperty("--cat-offset", `${progress * CAT_TRAVEL}px`);
      companion.style.setProperty("--yarn-rotation", `${progress * 900}deg`);
      companion.dataset.caught = String(isCaught);
      if (isCaught) companion.dataset.running = "false";
      setCaught(isCaught);
    };

    const updateVisibility = () => {
      const companionBounds = companion.getBoundingClientRect();
      const navigationBounds = navigation?.getBoundingClientRect();
      const hasHorizontalRoom = navigationBounds
        ? companionBounds.left - navigationBounds.right >= NAVIGATION_GAP
        : companionBounds.left >= NAVIGATION_GAP;
      const hasVerticalRoom = window.innerHeight >= MIN_VIEWPORT_HEIGHT;
      const hasScrollablePage = getScrollRange() >= MIN_SCROLL_RANGE;

      companion.dataset.visible = String(
        hasHorizontalRoom && hasVerticalRoom && hasScrollablePage,
      );
      updatePosition();
    };

    const schedulePositionUpdate = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(updatePosition);
    };

    const handleScroll = () => {
      companion.dataset.running = "true";
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        companion.dataset.running = "false";
      }, RUN_IDLE_DELAY);
      schedulePositionUpdate();
    };

    const resizeObserver = new ResizeObserver(updateVisibility);
    resizeObserver.observe(document.documentElement);
    if (navigation) resizeObserver.observe(navigation);
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", updateVisibility, { passive: true });
    window.addEventListener("load", updateVisibility, { once: true });
    reducedMotion.addEventListener("change", updatePosition);
    updateVisibility();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", updateVisibility);
      window.removeEventListener("load", updateVisibility);
      reducedMotion.removeEventListener("change", updatePosition);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(idleTimer);
    };
  }, []);

  const returnToTop = () => {
    const companion = companionRef.current;
    if (!companion) return;

    setCaught(false);
    companion.dataset.caught = "false";
    companion.dataset.running = "true";
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  };

  return (
    <div
      ref={companionRef}
      className="scroll-cat-companion"
      data-visible="false"
      data-running="false"
      data-caught="false"
    >
      <span className="scroll-cat__cat-wrap" aria-hidden="true">
        <svg className="scroll-cat__cat" viewBox="0 0 82 60">
          <g className="scroll-cat__tail">
            <path className="scroll-cat__tail-outline" d="M23 38C9 43 5 34 9 25c3-7 10-9 14-4 3 4 0 8-4 7" />
            <path className="scroll-cat__tail-fur" d="M23 38C9 43 5 34 9 25c3-7 10-9 14-4 3 4 0 8-4 7" />
          </g>

          <g className="scroll-cat__legs">
            <path className="scroll-cat__leg scroll-cat__leg--back" d="M28 42c-1 5-5 10-6 13 0 2 1 3 3 3h6c2 0 3-1 3-2 0-2-2-3-5-3l6-9Z" />
            <path className="scroll-cat__leg scroll-cat__leg--front" d="M51 43c1 5 4 10 7 13 1 2 3 2 5 1 1-1 1-3 0-4l-5-10Z" />
          </g>

          <g className="scroll-cat__body">
            <ellipse cx="40" cy="36" rx="23" ry="13" />
            <path className="scroll-cat__fur-light" d="M23 31c5-6 13-8 21-7-5 3-10 6-20 10Z" />
            <path className="scroll-cat__fur-light scroll-cat__fur-light--back" d="M48 25c7 2 12 5 14 10-5 0-10-3-14-10Z" />
          </g>

          <g className="scroll-cat__head">
            <path className="scroll-cat__head-shape" d="M48 23 51 9l9 7 11-6 1 14c5 3 7 8 6 13-2 8-10 12-19 10-9-1-15-8-14-15 0-4 1-7 3-9Z" />
            <path className="scroll-cat__inner-ear" d="m53 13 5 4-6 2Zm16 1-6 4 7 2Z" />
            <path className="scroll-cat__fur-light scroll-cat__fur-light--head" d="M48 24c4-5 9-8 15-8-1 5-5 9-11 12Z" />
            <ellipse className="scroll-cat__eye" cx="59" cy="30" rx="2.45" ry="3.05" />
            <ellipse className="scroll-cat__eye" cx="69" cy="29" rx="2.45" ry="3.05" />
            <circle className="scroll-cat__eye-glint" cx="59.8" cy="29" r=".72" />
            <circle className="scroll-cat__eye-glint" cx="69.8" cy="28" r=".72" />
            <path className="scroll-cat__nose" d="m64 34 2-.2-1 1.7Z" />
            <path className="scroll-cat__mouth" d="M65 35c-1 2-3 2-4 1m4-1c1 2 3 2 4 0" />
            <path className="scroll-cat__whiskers" d="m57 34-8-2m8 5-8 1m21-5 8-3m-7 6 7 1" />
          </g>
        </svg>
      </span>

      <span className="scroll-cat__thread" aria-hidden="true" />

      <button
        className="scroll-cat__yarn"
        type="button"
        disabled={!caught}
        aria-label={caught ? "返回页面顶部" : "毛线球"}
        onClick={returnToTop}
      >
        <svg className="scroll-cat__yarn-mark" viewBox="0 0 52 52" aria-hidden="true">
          <circle cx="26" cy="26" r="20" />
          <path d="M10 22c9 0 24 7 32 17M16 10c1 11 13 26 27 28M8 31c10-8 25-13 37-10M21 7c7 7 13 23 12 38" />
        </svg>
        <svg className="scroll-cat__top-arrow" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7 11 5-5 5 5M12 6v12" />
        </svg>
      </button>
    </div>
  );
}
