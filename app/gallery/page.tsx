import type { Metadata } from "next";
import { SiteHeader } from "../components/SiteHeader";
import { SITE_NAME } from "../lib/seo";
import { GalleryGrid } from "./GalleryGrid";
import { galleryImages } from "./gallery-manifest.generated";

export const dynamic = "force-static";
export const revalidate = 60;

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

      <SiteHeader edition="GALLERY · 画廊" />

      <section className="gallery" aria-labelledby="gallery-title">
        <header className="gallery-hero">
          <div>
            <p className="hero__kicker" data-nosnippet>LIGHT / MEMORY / MOMENTS</p>
            <h1 id="gallery-title">画廊</h1>
            <p className="gallery-hero__lede">
              收集旅途、日常，以及偶然遇见的光。
            </p>
          </div>
          <p className="gallery-hero__count" aria-label={`${galleryImages.length} 张影像`}>
            <span>{String(galleryImages.length).padStart(2, "0")}</span>
            <small>FRAMES</small>
          </p>
        </header>

        {galleryImages.length > 0 ? (
          <GalleryGrid images={galleryImages} />
        ) : (
          <div className="gallery-empty">
            <span className="gallery-empty__frame" aria-hidden="true" />
            <strong>照片尚未挂墙</strong>
            <p>影像同步完成后，会在这里自动生成响应式画廊。</p>
          </div>
        )}
      </section>
    </main>
  );
}
