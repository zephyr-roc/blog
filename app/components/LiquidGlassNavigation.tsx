"use client";

import {
  Glass,
  type GlassOptics,
  useLiquidGlassSupport,
} from "./liquid-glass";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  useId,
  useLayoutEffect,
  useRef,
} from "react";

const navigationItems = [
  { href: "/", label: "主页", icon: "home" },
  { href: "/radar", label: "雷达", icon: "radar" },
  { href: "/tinkering", label: "折腾", icon: "tinkering" },
  { href: "/about", label: "关于我", icon: "profile" },
] as const;

type NavigationIndex = 0 | 1 | 2 | 3;

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
  targetIndex: NavigationIndex;
};

type NavigationStyle = CSSProperties & Record<`--${string}`, string>;

export function LiquidGlassNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const supportsLiquidGlass = useLiquidGlassSupport();
  const backdropClipId = `navigation-backdrop-${useId().replace(/:/g, "")}`;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const backdropClipPathRef = useRef<SVGPathElement>(null);
  const dragStart = useRef<GestureStart | null>(null);
  const dragOffset = useRef(0);
  const pointerTravel = useRef(0);
  const suppressClickUntil = useRef(0);
  const activeIndex: NavigationIndex = pathname === "/about"
    ? 3
    : pathname.startsWith("/tinkering")
      ? 2
      : pathname.startsWith("/radar")
        ? 1
        : 0;
  const navigationStyle: NavigationStyle = {
    "--active-index": String(activeIndex),
    "--drag-offset": "0px",
    "--drag-strength": "0",
  };
  const backdropFilter = `blur(${supportsLiquidGlass ? 1 : 1.4}px) saturate(112%)`;
  const navigationBackdropStyle: CSSProperties = {
    backdropFilter,
    WebkitBackdropFilter: backdropFilter,
    ...(supportsLiquidGlass ? { clipPath: `url(#${backdropClipId})` } : null),
  };

  const getSegmentTravel = () => {
    const surface = surfaceRef.current;
    if (!surface) return 112;

    const items = surface.querySelectorAll<HTMLElement>(".liquid-navigation__item");
    if (items.length < 2) return 112;
    return items[1].offsetLeft - items[0].offsetLeft;
  };

  const updateBackdropClipPath = (offset = dragOffset.current) => {
    const surface = surfaceRef.current;
    const path = backdropClipPathRef.current;
    if (!surface || !path || !supportsLiquidGlass) return;

    const items = surface.querySelectorAll<HTMLElement>(".liquid-navigation__item");
    const activeItem = items[activeIndex];
    if (!activeItem) return;

    const surfaceWidth = surface.clientWidth;
    const surfaceHeight = surface.clientHeight;
    const x = activeItem.offsetLeft + offset;
    const y = activeItem.offsetTop;
    const width = activeItem.offsetWidth;
    const height = activeItem.offsetHeight;
    const radius = height / 2;
    const right = x + width;
    const bottom = y + height;

    path.setAttribute(
      "d",
      [
        `M 0 0 H ${surfaceWidth} V ${surfaceHeight} H 0 Z`,
        `M ${x + radius} ${y}`,
        `H ${right - radius}`,
        `A ${radius} ${radius} 0 0 1 ${right} ${y + radius}`,
        `A ${radius} ${radius} 0 0 1 ${right - radius} ${bottom}`,
        `H ${x + radius}`,
        `A ${radius} ${radius} 0 0 1 ${x} ${y + radius}`,
        `A ${radius} ${radius} 0 0 1 ${x + radius} ${y}`,
        "Z",
      ].join(" "),
    );
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
    updateBackdropClipPath(offset);
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
      ) as NavigationIndex;
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
    updateBackdropClipPath(0);

    if (!supportsLiquidGlass) return;
    const resizeObserver = new ResizeObserver(() => updateBackdropClipPath());
    resizeObserver.observe(surface);
    return () => resizeObserver.disconnect();
  }, [pathname, supportsLiquidGlass]);

  return (
      <nav className="liquid-navigation" aria-label="页面导航">
        <div
          ref={surfaceRef}
          className="liquid-navigation__surface"
          style={navigationStyle}
          data-dragging="false"
          data-active-index={activeIndex}
          data-liquid-glass-supported={supportsLiquidGlass ? "true" : "false"}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const fraction = (event.clientX - bounds.left) / bounds.width;
            const targetIndex = Math.min(
              navigationItems.length - 1,
              Math.floor(fraction * navigationItems.length),
            ) as NavigationIndex;
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
            ) as NavigationIndex;
            if (targetIndex !== activeIndex) {
              router.push(navigationItems[targetIndex].href);
            }
          }}
        >
          <svg
            aria-hidden="true"
            width="0"
            height="0"
            style={{ position: "absolute", width: 0, height: 0 }}
          >
            <defs>
              <clipPath id={backdropClipId} clipPathUnits="userSpaceOnUse">
                <path
                  ref={backdropClipPathRef}
                  fillRule="evenodd"
                  clipRule="evenodd"
                />
              </clipPath>
            </defs>
          </svg>
          <span
            className="liquid-navigation__backdrop"
            style={navigationBackdropStyle}
            aria-hidden="true"
          />
          <Glass
            className="liquid-navigation__refraction"
            radius={999}
            optics={navigationGlassOptics}
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
