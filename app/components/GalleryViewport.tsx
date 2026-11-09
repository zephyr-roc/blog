"use client";

import { useEffect } from "react";
import { isIosQQInAppBrowser } from "../lib/gallery-browser.mjs";

/* Only mark the gallery route for CSS: browser viewport layout stays native. */
export function GalleryViewport() {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.galleryActive = "true";
    if (isIosQQInAppBrowser(navigator.userAgent)) {
      root.dataset.galleryIosQq = "true";
    }
    return () => {
      delete root.dataset.galleryActive;
      delete root.dataset.galleryIosQq;
    };
  }, []);

  return null;
}
