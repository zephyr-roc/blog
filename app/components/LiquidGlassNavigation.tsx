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
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from "react";

const navigationItems = [
  { href: "/", label: "主页", icon: "home" },
  { href: "/radar", label: "雷达", icon: "radar" },
  { href: "/gallery", label: "画廊", icon: "gallery" },
  { href: "/tinkering", label: "折腾", icon: "tinkering" },
  { href: "/about", label: "关于我", icon: "profile" },
] as const;

type NavigationIndex = 0 | 1 | 2 | 3 | 4;

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
const CONTRAST_SAMPLE_COLUMNS = 5;
const CONTRAST_SAMPLE_ROWS = 3;
const LIGHT_BACKGROUND_LUMINANCE = .58;
const DARK_FOREGROUND_ENTER_RATIO = .55;
const DARK_FOREGROUND_EXIT_RATIO = .45;
const CONTRAST_SAMPLE_INTERVAL = 72;

type Rgba = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};

type ImageSampler = {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
};

const imageSamplerCache = new WeakMap<HTMLImageElement, ImageSampler | null>();

function parseCssColor(value: string): Rgba | null {
  const match = value.match(/^rgba?\((.*)\)$/i);
  if (!match) return null;

  const [colorPart, alphaPart] = match[1].split("/").map((part) => part.trim());
  const channels = colorPart.split(/[\s,]+/).filter(Boolean);
  if (channels.length < 3) return null;

  const parseChannel = (channel: string) => channel.endsWith("%")
    ? Number.parseFloat(channel) * 2.55
    : Number.parseFloat(channel);
  const parseAlpha = (alpha: string | undefined) => {
    if (!alpha) return 1;
    return alpha.endsWith("%")
      ? Number.parseFloat(alpha) / 100
      : Number.parseFloat(alpha);
  };
  const alphaFromComma = channels[3];
  const color: Rgba = {
    red: parseChannel(channels[0]),
    green: parseChannel(channels[1]),
    blue: parseChannel(channels[2]),
    alpha: parseAlpha(alphaPart ?? alphaFromComma),
  };

  return Object.values(color).every(Number.isFinite) ? color : null;
}

function relativeLuminance({ red, green, blue }: Rgba) {
  const linearize = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= .04045
      ? normalized / 12.92
      : ((normalized + .055) / 1.055) ** 2.4;
  };

  return linearize(red) * .2126
    + linearize(green) * .7152
    + linearize(blue) * .0722;
}

function getImageSampler(image: HTMLImageElement) {
  if (imageSamplerCache.has(image)) return imageSamplerCache.get(image) ?? null;
  if (!image.complete || image.naturalWidth === 0 || image.naturalHeight === 0) {
    return null;
  }

  const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    imageSamplerCache.set(image, null);
    return null;
  }

  try {
    context.drawImage(image, 0, 0, width, height);
    // Read once here so cross-origin canvases fail before being cached.
    context.getImageData(0, 0, 1, 1);
  } catch {
    imageSamplerCache.set(image, null);
    return null;
  }

  const sampler = { context, width, height };
  imageSamplerCache.set(image, sampler);
  return sampler;
}

function sampleImagePixel(image: HTMLImageElement, x: number, y: number): Rgba | null {
  const sampler = getImageSampler(image);
  if (!sampler) return null;

  const bounds = image.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const style = window.getComputedStyle(image);
  const naturalRatio = image.naturalWidth / image.naturalHeight;
  const boxRatio = bounds.width / bounds.height;
  let renderedWidth = bounds.width;
  let renderedHeight = bounds.height;

  if (style.objectFit === "contain") {
    if (naturalRatio > boxRatio) renderedHeight = bounds.width / naturalRatio;
    else renderedWidth = bounds.height * naturalRatio;
  } else if (style.objectFit === "cover") {
    if (naturalRatio > boxRatio) renderedWidth = bounds.height * naturalRatio;
    else renderedHeight = bounds.width / naturalRatio;
  }

  const offsetX = bounds.left + (bounds.width - renderedWidth) / 2;
  const offsetY = bounds.top + (bounds.height - renderedHeight) / 2;
  const imageX = (x - offsetX) / renderedWidth;
  const imageY = (y - offsetY) / renderedHeight;
  if (imageX < 0 || imageX > 1 || imageY < 0 || imageY > 1) return null;

  const sampleX = Math.min(sampler.width - 1, Math.floor(imageX * sampler.width));
  const sampleY = Math.min(sampler.height - 1, Math.floor(imageY * sampler.height));
  const pixel = sampler.context.getImageData(sampleX, sampleY, 1, 1).data;
  return {
    red: pixel[0],
    green: pixel[1],
    blue: pixel[2],
    alpha: pixel[3] / 255,
  };
}

function sampleBackgroundLuminance(x: number, y: number) {
  const elements = document.elementsFromPoint(x, y);
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;

  const composite = (color: Rgba) => {
    const availableAlpha = 1 - alpha;
    const layerAlpha = Math.max(0, Math.min(1, color.alpha)) * availableAlpha;
    red += color.red * layerAlpha;
    green += color.green * layerAlpha;
    blue += color.blue * layerAlpha;
    alpha += layerAlpha;
  };

  for (const element of elements) {
    if (!(element instanceof HTMLElement) || element.closest(".liquid-navigation")) {
      continue;
    }

    if (element instanceof HTMLImageElement) {
      const pixel = sampleImagePixel(element, x, y);
      if (pixel) composite(pixel);
    }

    const style = window.getComputedStyle(element);
    const background = parseCssColor(style.backgroundColor);
    if (background && background.alpha > 0) composite(background);
    if (alpha >= .995) break;
  }

  if (alpha < 1) {
    // The site canvas is dark; use it for any remaining transparent area.
    composite({ red: 8, green: 7, blue: 15, alpha: 1 });
  }

  return relativeLuminance({ red, green, blue, alpha: 1 });
}

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
    ? 4
    : pathname.startsWith("/tinkering")
      ? 3
      : pathname.startsWith("/gallery")
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

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    let animationFrame = 0;
    let timer = 0;
    let lastSampleTime = -CONTRAST_SAMPLE_INTERVAL;

    const updateContrast = (time: number) => {
      animationFrame = 0;
      lastSampleTime = time;
      const items = surface.querySelectorAll<HTMLElement>(".liquid-navigation__item");
      const previousPointerEvents = surface.style.pointerEvents;
      surface.style.pointerEvents = "none";

      try {
        items.forEach((item) => {
          const bounds = item.getBoundingClientRect();
          let lightSamples = 0;
          let validSamples = 0;

          for (let row = 1; row <= CONTRAST_SAMPLE_ROWS; row += 1) {
            const y = bounds.top + bounds.height * row / (CONTRAST_SAMPLE_ROWS + 1);
            for (let column = 1; column <= CONTRAST_SAMPLE_COLUMNS; column += 1) {
              const x = bounds.left + bounds.width * column / (CONTRAST_SAMPLE_COLUMNS + 1);
              const luminance = sampleBackgroundLuminance(x, y);
              validSamples += 1;
              if (luminance >= LIGHT_BACKGROUND_LUMINANCE) lightSamples += 1;
            }
          }

          const lightRatio = validSamples === 0 ? 0 : lightSamples / validSamples;
          const wasDarkForeground = item.dataset.foreground === "dark";
          const useDarkForeground = wasDarkForeground
            ? lightRatio >= DARK_FOREGROUND_EXIT_RATIO
            : lightRatio >= DARK_FOREGROUND_ENTER_RATIO;
          item.dataset.foreground = useDarkForeground ? "dark" : "light";
          item.style.setProperty("--background-light-ratio", lightRatio.toFixed(3));
        });
      } finally {
        surface.style.pointerEvents = previousPointerEvents;
      }
    };

    const scheduleContrastUpdate = () => {
      if (animationFrame || timer) return;
      const elapsed = window.performance.now() - lastSampleTime;
      const delay = Math.max(0, CONTRAST_SAMPLE_INTERVAL - elapsed);
      if (delay === 0) {
        animationFrame = window.requestAnimationFrame(updateContrast);
        return;
      }
      timer = window.setTimeout(() => {
        timer = 0;
        animationFrame = window.requestAnimationFrame(updateContrast);
      }, delay);
    };

    scheduleContrastUpdate();
    window.addEventListener("scroll", scheduleContrastUpdate, { passive: true, capture: true });
    window.addEventListener("resize", scheduleContrastUpdate, { passive: true });
    document.addEventListener("load", scheduleContrastUpdate, { capture: true });
    const mutationObserver = new MutationObserver(scheduleContrastUpdate);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-background", "src"],
    });

    return () => {
      window.removeEventListener("scroll", scheduleContrastUpdate, true);
      window.removeEventListener("resize", scheduleContrastUpdate);
      document.removeEventListener("load", scheduleContrastUpdate, true);
      mutationObserver.disconnect();
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      if (timer) window.clearTimeout(timer);
    };
  }, [pathname]);

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
