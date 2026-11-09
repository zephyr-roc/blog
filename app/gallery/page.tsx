import type { Metadata, Viewport } from "next";
import { SITE_NAME } from "../lib/seo";
import { GalleryEmbed } from "../components/GalleryEmbed";
import { GalleryViewport } from "../components/GalleryViewport";
import { GalleryOpenButton } from "../components/GalleryOpenButton";

export const dynamic = "force-static";

// Safari can paint the masonry view beneath its bottom toolbar only when
// the top-level document opts into an edge-to-edge layout. The full-photo
// iframe remains sized to 100svh by app/globals.css to protect its controls.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const GALLERY_DESCRIPTION = "积雨云的影像画廊：收集旅途、日常与偶然遇见的光。";

export const metadata: Metadata = {
  title: "画廊",
  description: GALLERY_DESCRIPTION,
  alternates: { canonical: "/gallery" },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: "/gallery",
    siteName: SITE_NAME,
    title: `画廊 — ${SITE_NAME}`,
    description: GALLERY_DESCRIPTION,
  },
};

export default function GalleryPage() {
  return (
    <main className="experience-shell gallery-shell">
      <GalleryViewport />
      <section className="gallery-embed" aria-label="摄影画廊">
        <GalleryEmbed />
      </section>
      <GalleryOpenButton />
    </main>
  );
}
