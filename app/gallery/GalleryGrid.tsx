"use client";

import PhotoSwipeLightbox from "photoswipe/lightbox";
import { useEffect } from "react";
import type { GalleryImage } from "./gallery-manifest.generated";

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
        bottom: viewportSize.x < 700 ? 12 : 36,
        left: viewportSize.x < 700 ? 12 : 36,
        right: viewportSize.x < 700 ? 12 : 36,
      }),
    });

    lightbox.init();
    return () => lightbox.destroy();
  }, []);

  return (
    <div className="gallery-grid" id="gallery-grid">
      {images.map((image, index) => {
        const largest = image.sources.at(-1);
        const display = image.sources.find((source) => source.width >= 960) ?? largest;
        if (!largest || !display) return null;
        const lightboxHeight = Math.round(largest.width * image.height / image.width);

        return (
          <a
            className="gallery-item"
            href={largest.src}
            data-pswp-width={largest.width}
            data-pswp-height={lightboxHeight}
            data-cropped="true"
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
                src={display.src}
                srcSet={imageSources(image)}
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
              <span>{image.title}</span>
              {image.animated ? <span className="gallery-item__motion">动态</span> : null}
            </span>
          </a>
        );
      })}
    </div>
  );
}
