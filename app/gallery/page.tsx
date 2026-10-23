import type { Metadata } from "next";
import { SITE_NAME } from "../lib/seo";
import { GalleryEmbed } from "../components/GalleryEmbed";
import { GalleryViewport } from "../components/GalleryViewport";
import { GalleryOpenButton } from "../components/GalleryOpenButton";

export const dynamic = "force-static";

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
      <div className="ambient ambient--violet gallery-shell__violet" aria-hidden="true" />
      <div className="ambient ambient--orange gallery-shell__orange" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <section className="gallery-embed" aria-label="摄影画廊">
        <GalleryEmbed />
      </section>
      <GalleryOpenButton />
    </main>
  );
}
