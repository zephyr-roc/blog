"use client";

import { useEffect } from "react";
import { Glass } from "./liquid-glass";

export function GalleryOpenButton() {
  useEffect(() => {
    // Vinext currently omits viewportFit when serializing viewport metadata.
    // Update the existing tag only for this edge-to-edge route, and restore it
    // when leaving so other pages retain their normal safe-area layout.
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!viewport) return;
    const original = viewport.content;
    viewport.content = `${original.replace(/,?\s*viewport-fit=[^,]+/g, "")}, viewport-fit=cover`;
    return () => { viewport.content = original; };
  }, []);

  return (
    <div className="back-to-top-button gallery-open-button" data-visible="true">
      <Glass
        className="back-to-top-button__glass"
        radius={999}
        optics={{ strength: .2, scaleX: .22, scaleY: .18, depth: .92, curvature: .72, bend: .88, bendWidth: .28, dispersion: 0, frost: 1, saturate: 1.35, specular: 0, sheen: 0, sheenWidth: 2.5, glow: 0 }}
        aria-hidden="true"
      >
        <span className="back-to-top-button__glass-tint" />
      </Glass>
      <a
        className="back-to-top-button__control"
        href="https://nas.afilmory.ready-jump.top/"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="在新窗口打开画廊"
      >
        <svg className="back-to-top-button__arrow" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12h14m-6-6 6 6-6 6" />
        </svg>
      </a>
    </div>
  );
}
