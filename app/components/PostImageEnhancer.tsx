"use client";

import PhotoSwipeLightbox from "photoswipe/lightbox";
import { useEffect } from "react";

const SAMPLE_SIZE = 128;
const TRANSPARENT_ALPHA_CUTOFF = 250;

async function waitForImage(image: HTMLImageElement) {
  if (image.complete && image.naturalWidth > 0) return;

  await new Promise<void>((resolve) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => resolve(), { once: true });
  });
}

async function hasTransparentPixels(image: HTMLImageElement) {
  await waitForImage(image);
  if (image.naturalWidth === 0 || image.naturalHeight === 0) return false;

  const scale = Math.min(
    1,
    SAMPLE_SIZE / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  try {
    const pixels = context.getImageData(0, 0, width, height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < TRANSPARENT_ALPHA_CUTOFF) return true;
    }
  } catch {
    // Cross-origin images without CORS cannot be inspected safely.
  }
  return false;
}

function enhanceImage(image: HTMLImageElement, signal: AbortSignal) {
  if (image.dataset.alphaBackgroundChecked === "true") return;
  image.dataset.alphaBackgroundChecked = "true";

  const existingFrame = image.closest<HTMLElement>(".post-image-frame");
  if (existingFrame) {
    const existingToggle = existingFrame.querySelector<HTMLButtonElement>(".post-image-background-toggle");
    if (existingToggle) bindBackgroundToggle(existingFrame, existingToggle, signal);
    return;
  }

  void hasTransparentPixels(image).then((hasAlpha) => {
    if (!hasAlpha || signal.aborted || !image.isConnected) return;

    const frame = document.createElement("span");
    frame.className = "post-image-frame";
    frame.dataset.background = "transparent";
    frame.dataset.hasAlpha = "true";

    const toggle = document.createElement("button");
    toggle.className = "post-image-background-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-pressed", "false");
    toggle.setAttribute("aria-label", "开启图片白色背景");
    toggle.innerHTML = `
      <svg class="post-image-background-toggle__icon post-image-background-toggle__icon--sun" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3.75" />
        <path d="M12 2.25v2.1M12 19.65v2.1M2.25 12h2.1M19.65 12h2.1M5.1 5.1l1.48 1.48M17.42 17.42l1.48 1.48M18.9 5.1l-1.48 1.48M6.58 17.42 5.1 18.9" />
      </svg>
      <svg class="post-image-background-toggle__icon post-image-background-toggle__icon--moon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.1 15.1A8.25 8.25 0 0 1 8.9 3.9 8.26 8.26 0 1 0 20.1 15.1Z" />
      </svg>
    `;

    image.before(frame);
    frame.append(image, toggle);

    bindBackgroundToggle(frame, toggle, signal);
  });
}

function bindBackgroundToggle(frame: HTMLElement, toggle: HTMLButtonElement, signal: AbortSignal) {
  toggle.addEventListener("click", () => {
    const useWhite = frame.dataset.background !== "white";
    frame.dataset.background = useWhite ? "white" : "transparent";
    toggle.setAttribute("aria-pressed", String(useWhite));
    toggle.setAttribute("aria-label", useWhite ? "关闭图片白色背景" : "开启图片白色背景");
  }, { signal });
}

export function PostImageEnhancer() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".post-content");
    if (!root) return;

    const controller = new AbortController();
    const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
    const lightbox = new PhotoSwipeLightbox({
      pswpModule: () => import("photoswipe"),
      bgOpacity: .94,
      preload: [0, 0],
      showHideAnimationType: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "none" : "zoom",
    });

    lightbox.on("uiRegister", () => {
      lightbox.pswp?.ui?.registerElement({
        name: "postWhiteBackground",
        className: "pswp__button--post-background",
        title: "开启图片白色背景",
        ariaLabel: "开启图片白色背景",
        html: "白底",
        order: 8,
        onInit: (button, pswp) => {
          const update = () => {
            const frame = images[pswp.currIndex]?.closest<HTMLElement>(".post-image-frame");
            const hasAlpha = frame?.dataset.hasAlpha === "true";
            const white = hasAlpha && frame.dataset.background === "white";
            button.hidden = !hasAlpha;
            button.setAttribute("aria-pressed", String(Boolean(white)));
            button.setAttribute("aria-label", white ? "关闭图片白色背景" : "开启图片白色背景");
            if (pswp.element) pswp.element.dataset.postBackground = white ? "white" : "transparent";
          };
          pswp.on("change", update);
          update();
        },
        onClick: (_event, _button, pswp) => {
          const frame = images[pswp.currIndex]?.closest<HTMLElement>(".post-image-frame");
          frame?.querySelector<HTMLButtonElement>(".post-image-background-toggle")?.click();
          const white = frame?.dataset.background === "white";
          if (pswp.element) pswp.element.dataset.postBackground = white ? "white" : "transparent";
          const button = pswp.element?.querySelector<HTMLButtonElement>(".pswp__button--post-background");
          button?.setAttribute("aria-pressed", String(white));
          button?.setAttribute("aria-label", white ? "关闭图片白色背景" : "开启图片白色背景");
        },
      });
    });
    lightbox.on("afterInit", () => lightbox.pswp?.element?.classList.add("post-image-lightbox"));
    lightbox.init();

    const openImage = (index: number) => {
      const dataSource = images.map((image) => ({
        src: image.src,
        msrc: image.currentSrc || image.src,
        width: image.naturalWidth || image.width || 1,
        height: image.naturalHeight || image.height || 1,
        alt: image.alt,
      }));
      lightbox.loadAndOpen(index, dataSource);
    };

    images.forEach((image, index) => {
      enhanceImage(image, controller.signal);
      image.tabIndex = 0;
      image.setAttribute("role", "button");
      image.setAttribute("aria-label", image.alt ? `放大图片：${image.alt}` : "放大图片");
      image.addEventListener("click", (event) => {
        event.preventDefault();
        openImage(index);
      }, { signal: controller.signal });
      image.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openImage(index);
      }, { signal: controller.signal });
    });

    return () => {
      controller.abort();
      lightbox.destroy();
      images.forEach((image) => {
        delete image.dataset.alphaBackgroundChecked;
        image.removeAttribute("role");
        image.removeAttribute("aria-label");
        image.removeAttribute("tabindex");
      });
    };
  }, []);

  return null;
}
