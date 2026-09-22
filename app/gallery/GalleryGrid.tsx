"use client";

import PhotoSwipeLightbox from "photoswipe/lightbox";
import { useEffect } from "react";
import type { GalleryImage } from "./gallery-types";

type GalleryGridProps = {
  images: GalleryImage[];
};

function imageSources(image: GalleryImage) {
  return image.sources.map((source) => `${source.src} ${source.width}w`).join(", ");
}

export function GalleryGrid({ images }: GalleryGridProps) {
  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lightbox = new PhotoSwipeLightbox({
      gallery: "#gallery-grid",
      children: "a",
      pswpModule: () => import("photoswipe"),
      bgOpacity: .94,
      showHideAnimationType: reduceMotion ? "none" : "zoom",
      paddingFn: (viewportSize) => ({
        top: viewportSize.x < 700 ? 12 : 36,
        bottom: viewportSize.x < 700 ? 96 : 112,
        left: viewportSize.x < 700 ? 12 : 36,
        right: viewportSize.x < 700 ? 12 : 36,
      }),
    });

    lightbox.on("afterInit", () => {
      const pswp = lightbox.pswp;
      if (!pswp?.element) return;

      const panel = document.createElement("aside");
      panel.className = "gallery-lightbox-meta";
      panel.setAttribute("aria-live", "polite");
      pswp.element.append(panel);

      const update = () => {
        const image = images[pswp.currIndex];
        if (!image) return;
        const details = [
          image.metadata.capturedAt
            ? new Intl.DateTimeFormat("zh-CN", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }).format(new Date(image.metadata.capturedAt))
            : null,
          image.metadata.camera,
          image.metadata.lens,
          image.metadata.focalLength,
          image.metadata.aperture,
          image.metadata.shutterSpeed,
          image.metadata.iso,
          `${image.width} × ${image.height}`,
          image.metadata.format,
        ].filter((value): value is string => Boolean(value));

        const title = document.createElement("strong");
        title.textContent = image.title;
        const list = document.createElement("span");
        list.textContent = details.join("  ·  ");
        panel.replaceChildren(title, list);
      };

      pswp.on("change", update);
      update();
    });

    lightbox.init();
    return () => lightbox.destroy();
  }, [images]);

  return (
    <div className="gallery-grid" id="gallery-grid">
      {images.map((image, index) => {
        const largest = image.sources.at(-1);
        const display = image.sources.find((source) => source.width >= 960) ?? largest;
        if (!largest || !display) return null;
        const lightboxHeight = image.height;

        return (
          <a
            className="gallery-item"
            href={image.original || largest.src}
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
