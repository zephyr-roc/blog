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
  bounds: DOMRect,
  transitionSize: number,
  clientX: number,
  clientY: number,
) {
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
  const pointerFrame = useRef<number | null>(null);
  const latestPointer = useRef<{ x: number; y: number } | null>(null);
  const pointerActiveCards = useRef(new Set<HTMLElement>());
  const edgeTransitions = useRef(new WeakMap<HTMLElement, number>());

  useEffect(() => {
    cardsRef.current = Array.from(
      document.querySelectorAll<HTMLElement>("[data-motion-card='true']"),
    );
    cardsRef.current.forEach((card) => {
      const perspective = card.closest<HTMLElement>(".card-perspective");
      const transitionSize = perspective
        ? Number.parseFloat(
            getComputedStyle(perspective).getPropertyValue("--edge-transition"),
          ) || 44
        : 44;
      edgeTransitions.current.set(card, transitionSize);
    });

    const resetCard = (card: HTMLElement) => {
      keyboardTilt.current.delete(card);
      applyTilt(card, 0, 0, false);
    };
    const resetAll = () => {
      pointerActiveCards.current.clear();
      cardsRef.current.forEach(resetCard);
    };

    const flushPointer = () => {
      pointerFrame.current = null;
      const pointer = latestPointer.current;
      if (!pointer) return;

      // Read every rectangle first, then write styles. This avoids a forced
      // layout after each card update and keeps one pointer event to one frame.
      const measurements = cardsRef.current.map((card) => ({
        card,
        bounds: card.getBoundingClientRect(),
        transitionSize: edgeTransitions.current.get(card) ?? 44,
      }));
      const nextActiveCards = new Set<HTMLElement>();

      measurements.forEach(({ card, bounds, transitionSize }) => {
        const isNear = pointer.x >= bounds.left - transitionSize
          && pointer.x <= bounds.right + transitionSize
          && pointer.y >= bounds.top - transitionSize
          && pointer.y <= bounds.bottom + transitionSize;

        if (isNear) {
          nextActiveCards.add(card);
          applyPointerPressure(
            card,
            bounds,
            transitionSize,
            pointer.x,
            pointer.y,
          );
        } else if (pointerActiveCards.current.has(card)) {
          resetCard(card);
        }
      });

      pointerActiveCards.current = nextActiveCards;
    };

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      latestPointer.current = { x: event.clientX, y: event.clientY };
      if (pointerFrame.current !== null) return;
      pointerFrame.current = window.requestAnimationFrame(flushPointer);
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

    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (finePointer) {
      window.addEventListener("pointermove", handlePointerMove, { passive: true });
      window.addEventListener("pointerout", handlePointerExit, { passive: true });
    }
    window.addEventListener(GLASS_MOTION_TILT_EVENT, handleMotionTilt);
    window.addEventListener(GLASS_MOTION_RESET_EVENT, resetAll);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusout", handleFocusOut);

    return () => {
      if (finePointer) {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerout", handlePointerExit);
      }
      if (pointerFrame.current !== null) {
        window.cancelAnimationFrame(pointerFrame.current);
        pointerFrame.current = null;
      }
      latestPointer.current = null;
      pointerActiveCards.current.clear();
      window.removeEventListener(GLASS_MOTION_TILT_EVENT, handleMotionTilt);
      window.removeEventListener(GLASS_MOTION_RESET_EVENT, resetAll);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusout", handleFocusOut);
      cardsRef.current = [];
    };
  }, [pathname]);

  return null;
}
