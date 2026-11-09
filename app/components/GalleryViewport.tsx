"use client";

import { useEffect } from "react";

/* Only mark the gallery route for CSS: browser viewport layout stays native. */
export function GalleryViewport() {
  useEffect(() => {
    document.documentElement.dataset.galleryActive = "true";
    return () => { delete document.documentElement.dataset.galleryActive; };
  }, []);

  return null;
}
