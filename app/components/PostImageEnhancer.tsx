"use client";

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

  void hasTransparentPixels(image).then((hasAlpha) => {
    if (!hasAlpha || signal.aborted || !image.isConnected) return;

    const frame = document.createElement("span");
    frame.className = "post-image-frame";
    frame.dataset.background = "white";
    frame.dataset.hasAlpha = "true";

    const toggle = document.createElement("button");
    toggle.className = "post-image-background-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-pressed", "true");
    toggle.setAttribute("aria-label", "关闭图片白色背景");
    toggle.innerHTML = '<span class="post-image-background-toggle__track" aria-hidden="true"><span /></span><span>白底</span>';

    image.before(frame);
    frame.append(image, toggle);

    toggle.addEventListener(
      "click",
      () => {
        const useWhite = frame.dataset.background !== "white";
        frame.dataset.background = useWhite ? "white" : "transparent";
        toggle.setAttribute("aria-pressed", String(useWhite));
        toggle.setAttribute(
          "aria-label",
          useWhite ? "关闭图片白色背景" : "开启图片白色背景",
        );
      },
      { signal },
    );
  });
}

export function PostImageEnhancer() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".post-content");
    if (!root) return;

    const controller = new AbortController();
    root.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
      enhanceImage(image, controller.signal);
    });

    return () => controller.abort();
  }, []);

  return null;
}
