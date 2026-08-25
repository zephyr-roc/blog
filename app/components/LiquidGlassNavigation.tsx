"use client";

import { useBackdropLayout } from "./BackdropLayoutContext";
import { Glass, type GlassOptics } from "./liquid-glass";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  useLayoutEffect,
  useRef,
} from "react";

const navigationItems = [
  { href: "/", label: "主页", icon: "home" },
  { href: "/tinkering", label: "折腾", icon: "tinkering" },
  { href: "/about", label: "关于我", icon: "profile" },
] as const;

const navigationGlassOptics: Partial<GlassOptics> = {
  strength: .18,
  scaleX: .2,
  scaleY: .14,
  depth: .94,
  curvature: .58,
  bend: .9,
  bendWidth: .24,
  dispersion: .8,
  // The backplate supplies the soft blur; keep the live lens single-sample.
  frost: 0,
  saturate: 1.4,
  brightness: 0,
  specular: .82,
  sheen: .34,
  sheenWidth: 2.5,
  glow: 0,
  splay: .04,
};

const DRAG_ACTIVATION_DISTANCE = 12;
const TOUCH_TAP_DISTANCE = 28;

type GestureStart = {
  x: number;
  y: number;
  targetIndex: 0 | 1 | 2;
};

type NavigationStyle = CSSProperties & Record<`--${string}`, string>;

export function LiquidGlassNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { revision: backdropRevision } = useBackdropLayout();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<GestureStart | null>(null);
  const dragOffset = useRef(0);
  const pointerTravel = useRef(0);
  const suppressClickUntil = useRef(0);
  const activeIndex = pathname === "/about" ? 2 : pathname.startsWith("/tinkering") ? 1 : 0;
  const navigationStyle: NavigationStyle = {
    "--active-index": String(activeIndex),
    "--drag-offset": "0px",
    "--drag-strength": "0",
  };

  const getSegmentTravel = () => {
    const surface = surfaceRef.current;
    if (!surface) return 112;

    const items = surface.querySelectorAll<HTMLElement>(".liquid-navigation__item");
    if (items.length < 2) return 112;
    return items[1].offsetLeft - items[0].offsetLeft;
  };

  const setDragOffset = (offset: number) => {
    const surface = surfaceRef.current;
    if (!surface) return;

    dragOffset.current = offset;
    surface.style.setProperty("--drag-offset", `${offset}px`);
    surface.style.setProperty(
      "--drag-strength",
      String(Math.min(1, Math.abs(offset) / getSegmentTravel())),
    );
  };

  const suppressGeneratedClick = () => {
    suppressClickUntil.current = window.performance.now() + 700;
  };

  const isGeneratedClick = () => window.performance.now() < suppressClickUntil.current;

  const finishDrag = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const surface = surfaceRef.current;
    const start = dragStart.current;
    if (!surface || start === null) return;

    if (surface.hasPointerCapture(event.pointerId)) {
      surface.releasePointerCapture(event.pointerId);
    }

    const offset = dragOffset.current;
    const travel = getSegmentTravel();
    const travelled = pointerTravel.current;
    const wasTouchTap = !cancelled
      && event.pointerType !== "mouse"
      && travelled < TOUCH_TAP_DISTANCE;
    const wasDrag = travelled >= DRAG_ACTIVATION_DISTANCE;
    const shouldSwitch = !cancelled && wasDrag && Math.abs(offset) >= travel * .34;
    dragStart.current = null;
    pointerTravel.current = 0;
    surface.dataset.dragging = "false";

    if (wasTouchTap) {
      event.preventDefault();
      suppressGeneratedClick();
      setDragOffset(0);
      if (start.targetIndex !== activeIndex) {
        router.push(navigationItems[start.targetIndex].href);
      }
    } else if (shouldSwitch) {
      suppressGeneratedClick();
      const tabDelta = Math.sign(offset)
        * Math.max(1, Math.round(Math.abs(offset) / travel));
      const targetIndex = Math.max(
        0,
        Math.min(navigationItems.length - 1, activeIndex + tabDelta),
      ) as 0 | 1 | 2;
      const targetTravel = (targetIndex - activeIndex) * travel;
      setDragOffset(targetTravel);
      router.push(navigationItems[targetIndex].href);
    } else {
      setDragOffset(0);
      if (!cancelled && wasDrag) suppressGeneratedClick();
      else suppressClickUntil.current = 0;
    }
  };

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    dragStart.current = null;
    dragOffset.current = 0;
    pointerTravel.current = 0;
    suppressClickUntil.current = 0;
    surface.dataset.dragging = "false";
    surface.style.setProperty("--drag-offset", "0px");
    surface.style.setProperty("--drag-strength", "0");
  }, [pathname]);

  return (
      <nav className="liquid-navigation" aria-label="页面导航">
        <div
          ref={surfaceRef}
          className="liquid-navigation__surface"
          style={navigationStyle}
          data-dragging="false"
          data-active-index={activeIndex}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const fraction = (event.clientX - bounds.left) / bounds.width;
            const targetIndex = Math.min(
              navigationItems.length - 1,
              Math.floor(fraction * navigationItems.length),
            ) as 0 | 1 | 2;
            dragStart.current = {
              x: event.clientX,
              y: event.clientY,
              targetIndex,
            };
            pointerTravel.current = 0;
            suppressClickUntil.current = 0;
          }}
          onPointerMove={(event) => {
            const start = dragStart.current;
            if (start === null) return;

            const travel = getSegmentTravel();
            const rawOffset = event.clientX - start.x;
            const rawVerticalOffset = event.clientY - start.y;
            pointerTravel.current = Math.max(
              pointerTravel.current,
              Math.hypot(rawOffset, rawVerticalOffset),
            );
            const minOffset = -activeIndex * travel;
            const maxOffset = (navigationItems.length - 1 - activeIndex) * travel;
            const boundedOffset = Math.max(
              minOffset,
              Math.min(maxOffset, rawOffset),
            );

            if (pointerTravel.current >= DRAG_ACTIVATION_DISTANCE) {
              event.currentTarget.dataset.dragging = "true";
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.setPointerCapture(event.pointerId);
              }
            }
            setDragOffset(boundedOffset);
          }}
          onPointerUp={(event) => finishDrag(event)}
          onPointerCancel={(event) => finishDrag(event, true)}
          onClick={(event: MouseEvent<HTMLDivElement>) => {
            if (event.defaultPrevented) return;
            if (isGeneratedClick()) {
              event.preventDefault();
              return;
            }
            if ((event.target as Element).closest("a")) return;

            const bounds = event.currentTarget.getBoundingClientRect();
            const fraction = (event.clientX - bounds.left) / bounds.width;
            const targetIndex = Math.min(
              navigationItems.length - 1,
              Math.floor(fraction * navigationItems.length),
            ) as 0 | 1 | 2;
            if (targetIndex !== activeIndex) {
              router.push(navigationItems[targetIndex].href);
            }
          }}
        >
          <Glass
            className="liquid-navigation__refraction"
            radius={999}
            optics={navigationGlassOptics}
            backdropRevision={backdropRevision}
            aria-hidden="true"
          >
            <span className="liquid-navigation__refraction-content" />
          </Glass>
          <span className="liquid-navigation__indicator" aria-hidden="true" />
          <span className="sr-only">可拖动活动玻璃块切换页面</span>
          {navigationItems.map((item, index) => {
            const isActive = index === activeIndex;

            return (
              <Link
                className="liquid-navigation__item"
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                key={item.href}
                draggable={false}
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  if (isGeneratedClick()) return;
                  if (!isActive) router.push(item.href);
                }}
              >
                <span
                  className={`liquid-navigation__icon liquid-navigation__icon--${item.icon}`}
                  aria-hidden="true"
                />
                <span className="liquid-navigation__label">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
  );
}
