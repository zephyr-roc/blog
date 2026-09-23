"use client";

import PhotoSwipeLightbox from "photoswipe/lightbox";
import { useEffect, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GalleryLightboxInspector } from "./GalleryLightboxInspector";
import type { GalleryImage } from "./gallery-types";

type GalleryGridProps = {
  images: GalleryImage[];
};

function imageSources(image: GalleryImage) {
  return image.sources.map((source) => `${source.src} ${source.width}w`).join(", ");
}

function galleryColumnCount(width: number) {
  if (width >= 1180) return 3;
  if (width >= 680) return 2;
  return 1;
}

export function GalleryGrid({ images }: GalleryGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    let animationFrame = 0;
    let previousWidth = 0;

    const layout = () => {
      const width = grid.clientWidth;
      if (width <= 0) return;

      const styles = window.getComputedStyle(grid);
      const gap = Number.parseFloat(styles.columnGap || styles.gap) || 18;
      const columnCount = galleryColumnCount(width);
      const columnWidth = (width - gap * (columnCount - 1)) / columnCount;
      const columnHeights = Array.from({ length: columnCount }, () => 0);
      const cards = Array.from(
        grid.querySelectorAll<HTMLElement>(":scope > .gallery-item"),
      );

      grid.style.setProperty("--gallery-columns", String(columnCount));
      for (const card of cards) card.style.width = `${columnWidth}px`;

      // Source order is newest-first. Equal empty columns are selected from
      // left to right, so every viewport starts with a newest-first first row.
      for (const card of cards) {
        let shortestColumn = 0;
        for (let column = 1; column < columnCount; column += 1) {
          if (columnHeights[column] < columnHeights[shortestColumn]) {
            shortestColumn = column;
          }
        }

        card.style.left = `${shortestColumn * (columnWidth + gap)}px`;
        card.style.top = `${columnHeights[shortestColumn]}px`;
        columnHeights[shortestColumn] += card.getBoundingClientRect().height + gap;
      }

      grid.style.height = `${Math.max(0, Math.max(...columnHeights, 0) - gap)}px`;
      grid.dataset.masonryReady = "true";
    };

    const scheduleLayout = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(layout);
    };

    layout();
    previousWidth = grid.clientWidth;

    const observer = new ResizeObserver((entries) => {
      const gridEntry = entries.find((entry) => entry.target === grid);
      const nextWidth = gridEntry?.contentRect.width ?? grid.clientWidth;
      if (Math.abs(nextWidth - previousWidth) > .5) {
        previousWidth = nextWidth;
        scheduleLayout();
        return;
      }
      if (entries.some((entry) => entry.target !== grid)) scheduleLayout();
    });

    observer.observe(grid);
    grid.querySelectorAll<HTMLElement>(":scope > .gallery-item")
      .forEach((card) => observer.observe(card));

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [images]);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let inspectorOpen = window.innerWidth >= 860;
    let inspectorRoot: ReturnType<typeof createRoot> | null = null;
    const lightbox = new PhotoSwipeLightbox({
      gallery: "#gallery-grid",
      children: "a",
      pswpModule: () => import("photoswipe"),
      bgOpacity: .94,
      showHideAnimationType: reduceMotion ? "none" : "zoom",
      paddingFn: (viewportSize) => ({
        top: viewportSize.x < 700 ? 64 : 72,
        bottom: inspectorOpen && viewportSize.x < 860
          ? Math.min(viewportSize.y * .58, 460) + 16
          : 16,
        left: viewportSize.x < 700 ? 12 : 36,
        right: inspectorOpen && viewportSize.x >= 860
          ? Math.min(388, Math.max(300, viewportSize.x * .34)) + 28
          : viewportSize.x < 700 ? 12 : 36,
      }),
    });

    lightbox.on("afterInit", () => {
      const pswp = lightbox.pswp;
      if (!pswp?.element) return;

      const host = document.createElement("div");
      host.className = "gallery-lightbox-inspector-host";
      pswp.element.append(host);
      inspectorRoot = createRoot(host);

      const update = () => {
        const image = images[pswp.currIndex];
        if (!image) return;
        pswp.element?.classList.toggle("gallery-pswp--inspector-open", inspectorOpen);
        const url = new URL(window.location.href);
        url.searchParams.set("photo", image.remoteId);
        window.history.replaceState(window.history.state, "", url);
        inspectorRoot?.render(<GalleryLightboxInspector
          key={image.id}
          image={image}
          open={inspectorOpen}
          onToggle={() => {
            inspectorOpen = !inspectorOpen;
            update();
            pswp.updateSize(true);
          }}
        />);
      };

      pswp.on("change", update);
      pswp.on("close", () => {
        const url = new URL(window.location.href);
        url.searchParams.delete("photo");
        window.history.replaceState(window.history.state, "", url);
      });
      pswp.on("destroy", () => {
        inspectorRoot?.unmount();
        inspectorRoot = null;
      });
      update();
    });

    lightbox.init();
    const photoId = new URL(window.location.href).searchParams.get("photo");
    const sharedIndex = images.findIndex((image) => image.remoteId === photoId);
    if (sharedIndex >= 0) window.requestAnimationFrame(() => lightbox.loadAndOpen(sharedIndex));
    return () => {
      lightbox.destroy();
      inspectorRoot?.unmount();
    };
  }, [images]);

  return (
    <div className="gallery-grid" id="gallery-grid" ref={gridRef}>
      {images.map((image, index) => {
        const largest = image.sources.at(-1);
        const display = image.sources.find((source) => source.width >= 960) ?? largest;
        if (!largest || !display) return null;
        const lightboxHeight = image.height;

        return (
          <a
            className="gallery-item"
            href={image.original || largest.src}
            data-pswp-src={image.original || largest.src}
            data-pswp-width={image.width}
            data-pswp-height={lightboxHeight}
            data-cropped="true"
            data-gallery-index={index}
            key={image.id}
            aria-label={`查看大图：${image.title}`}
          >
            <span
              className="gallery-item__placeholder"
              aria-hidden="true"
              style={{ backgroundImage: `url(${image.poster})` }}
            />
            <picture>
              {image.animated ? (
                <source media="(prefers-reduced-motion: reduce)" srcSet={image.poster} />
              ) : null}
              <img
                src={image.animated ? image.original : display.src}
                srcSet={image.animated ? undefined : imageSources(image)}
                sizes="(max-width: 680px) calc(100vw - 36px), (max-width: 1100px) 46vw, 31vw"
                width={image.width}
                height={image.height}
                alt={image.alt}
                loading={index < 4 ? "eager" : "lazy"}
                fetchPriority={index < 2 ? "high" : "auto"}
                decoding="async"
              />
            </picture>
            <span className="gallery-item__shade" aria-hidden="true" />
            <span className="gallery-item__caption">
              <span>
                <strong>{image.title}</strong>
                {image.metadata.capturedAt ? (
                  <small>{image.metadata.capturedAt.slice(0, 10)}</small>
                ) : null}
              </span>
              {image.animated ? <span className="gallery-item__motion">动态</span> : null}
            </span>
          </a>
        );
      })}
    </div>
  );
}
