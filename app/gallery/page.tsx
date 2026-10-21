import type { Metadata } from "next";
import { SiteHeader } from "../components/SiteHeader";
import { SITE_NAME } from "../lib/seo";
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
      <div className="ambient ambient--violet gallery-shell__violet" aria-hidden="true" />
      <div className="ambient ambient--orange gallery-shell__orange" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <SiteHeader edition="" />

      <section className="gallery-embed" aria-label="摄影画廊">
        <iframe className="gallery-embed__frame" src="https://nas.afilmory.ready-jump.top/" title="积雨云的 Afilmory 摄影画廊" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      </section>
      <GalleryOpenButton />
    </main>
  );
}
