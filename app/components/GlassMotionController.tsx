"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  GLASS_MOTION_RESET_EVENT,
  GLASS_MOTION_TILT_EVENT,
  type MotionTiltDetail,
} from "./motionTilt";

type Tilt = { x: number; y: number };

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

function applyTilt(card: HTMLElement, x: number, y: number, active = true) {
  const boundedX = clamp(x);
  const boundedY = clamp(y);
  card.dataset.active = active ? "true" : "false";
  card.style.setProperty("--rotate-x", `${-boundedY * 8.5}deg`);
  card.style.setProperty("--rotate-y", `${boundedX * 11.5}deg`);
  card.style.setProperty("--pointer-x", `${(boundedX + 1) * 50}%`);
  card.style.setProperty("--pointer-y", `${(boundedY + 1) * 50}%`);
  card.style.setProperty("--shadow-x", `${-boundedX * 30}px`);
  card.style.setProperty("--shadow-y", `${34 + boundedY * 15}px`);
  card.style.setProperty("--content-shadow-x", `${-boundedX * 7}px`);
  card.style.setProperty("--content-shadow-y", `${12 - boundedY * 5}px`);
  card.style.setProperty("--content-x", `${boundedX * 5}px`);
  card.style.setProperty("--content-y", `${boundedY * 4}px`);
  card.style.setProperty("--logo-x", `${boundedX * 8}px`);
  card.style.setProperty("--logo-y", `${boundedY * 6}px`);
  card.style.setProperty("--detail-x", `${boundedX * 3}px`);
  card.style.setProperty("--detail-y", `${boundedY * 2.5}px`);
}

function applyPointerPressure(
  card: HTMLElement,
  clientX: number,
  clientY: number,
) {
  const perspective = card.closest<HTMLElement>(".card-perspective");
  if (!perspective) return;

  const bounds = card.getBoundingClientRect();
  const transitionSize = Number.parseFloat(
    getComputedStyle(perspective).getPropertyValue("--edge-transition"),
  ) || 44;
  const rawX = ((clientX - bounds.left) / bounds.width) * 2 - 1;
  const rawY = ((clientY - bounds.top) / bounds.height) * 2 - 1;
  const outsideX = Math.max(bounds.left - clientX, clientX - bounds.right, 0);
  const outsideY = Math.max(bounds.top - clientY, clientY - bounds.bottom, 0);
  const edgeProgress = Math.min(
    1,
    Math.max(outsideX / transitionSize, outsideY / transitionSize),
  );
  const smoothProgress = edgeProgress * edgeProgress * (3 - 2 * edgeProgress);
  const pressure = 1 - smoothProgress;

  applyTilt(
    card,
    clamp(rawX) * pressure,
    clamp(rawY) * pressure,
    pressure > 0,
  );
}

export function GlassMotionController() {
  const pathname = usePathname();
  const cardsRef = useRef<HTMLElement[]>([]);
  const keyboardTilt = useRef(new WeakMap<HTMLElement, Tilt>());

  useEffect(() => {
    cardsRef.current = Array.from(
      document.querySelectorAll<HTMLElement>("[data-motion-card='true']"),
    );

    const resetCard = (card: HTMLElement) => {
      keyboardTilt.current.delete(card);
      applyTilt(card, 0, 0, false);
    };
    const resetAll = () => cardsRef.current.forEach(resetCard);

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      if (event.pointerType === "touch") return;
      cardsRef.current.forEach((card) => {
        applyPointerPressure(card, event.clientX, event.clientY);
      });
    };
    const handlePointerExit = (event: globalThis.PointerEvent) => {
      if (event.relatedTarget === null) resetAll();
    };
    const handleMotionTilt = (event: Event) => {
      const { x, y } = (event as CustomEvent<MotionTiltDetail>).detail;
      cardsRef.current.forEach((card) => applyTilt(card, x, y));
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const card = (event.target as Element | null)?.closest<HTMLElement>(
        "[data-motion-card='true']",
      );
      if (!card) return;

      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        resetCard(card);
        return;
      }

      const directions: Record<string, [number, number]> = {
        ArrowLeft: [-0.18, 0],
        ArrowRight: [0.18, 0],
        ArrowUp: [0, -0.18],
        ArrowDown: [0, 0.18],
      };
      const direction = directions[event.key];
      if (!direction) return;

      event.preventDefault();
      const current = keyboardTilt.current.get(card) ?? { x: 0, y: 0 };
      const next = {
        x: clamp(current.x + direction[0]),
        y: clamp(current.y + direction[1]),
      };
      keyboardTilt.current.set(card, next);
      applyTilt(card, next.x, next.y);
    };
    const handleFocusOut = (event: FocusEvent) => {
      const card = (event.target as Element | null)?.closest<HTMLElement>(
        "[data-motion-card='true']",
      );
      if (card && !card.contains(event.relatedTarget as Node | null)) resetCard(card);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerout", handlePointerExit, { passive: true });
    window.addEventListener(GLASS_MOTION_TILT_EVENT, handleMotionTilt);
    window.addEventListener(GLASS_MOTION_RESET_EVENT, resetAll);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusout", handleFocusOut);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerout", handlePointerExit);
      window.removeEventListener(GLASS_MOTION_TILT_EVENT, handleMotionTilt);
      window.removeEventListener(GLASS_MOTION_RESET_EVENT, resetAll);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusout", handleFocusOut);
      cardsRef.current = [];
    };
  }, [pathname]);

  return null;
}
