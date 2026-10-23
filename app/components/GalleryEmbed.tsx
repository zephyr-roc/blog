"use client";

import { useEffect, useRef, useState } from "react";
import { GALLERY_ORIGIN, readGalleryViewerMessage } from "../lib/navigation-context.mjs";

export function GalleryEmbed() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const requestState = () => {
    frameRef.current?.contentWindow?.postMessage({ type: "blog:request-viewer-state", version: 1 }, GALLERY_ORIGIN);
  };

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const open = readGalleryViewerMessage(event, frameRef.current?.contentWindow);
      if (open !== null) setViewerOpen(open);
    };
    window.addEventListener("message", receive);
    requestState();
    return () => window.removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    document.body.dataset.galleryViewerOpen = String(viewerOpen);
    const controls = [...document.querySelectorAll<HTMLElement>(".liquid-navigation, .gallery-open-button")];
    const previous = controls.map(control => control.inert);
    controls.forEach((control, index) => { control.inert = viewerOpen || previous[index]; });
    return () => {
      delete document.body.dataset.galleryViewerOpen;
      controls.forEach((control, index) => { control.inert = previous[index]; });
    };
  }, [viewerOpen]);

  return (
    <iframe
      ref={frameRef}
      className="gallery-embed__frame"
      src={`${GALLERY_ORIGIN}/`}
      title="积雨云的 Afilmory 摄影画廊"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      onLoad={() => { setViewerOpen(false); requestState(); }}
    />
  );
}
