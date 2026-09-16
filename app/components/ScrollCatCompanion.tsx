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
            <path d="M24 36C8 38 8 22 17 20c7-2 10 5 5 9" />
          </g>
          <g className="scroll-cat__body">
            <ellipse cx="40" cy="37" rx="22" ry="13" />
            <path className="scroll-cat__belly" d="M22 38c7 9 29 12 40 1-2 8-9 12-21 12-11 0-18-5-19-13Z" />
          </g>
          <g className="scroll-cat__head">
            <path d="M51 22 55 9l8 8 10-5 1 14a14 14 0 1 1-23-4Z" />
            <path className="scroll-cat__ear" d="m57 16 1-4 3 4m7 0 4-2v5" />
            <path className="scroll-cat__face" d="M59 26h.1m9 0h.1m-5 3 1 1 1-1m-1 1c-1 3-4 3-5 1m5-1c1 3 4 3 5 1" />
            <path className="scroll-cat__whiskers" d="m58 29-8-2m8 5-8 1m19-4 8-2m-8 5 8 1" />
          </g>
          <g className="scroll-cat__legs">
            <path className="scroll-cat__leg scroll-cat__leg--back" d="M29 45 24 56h8l4-9" />
            <path className="scroll-cat__leg scroll-cat__leg--front" d="m52 46 5 10h8l-6-12" />
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
