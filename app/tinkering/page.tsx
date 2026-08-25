import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader } from "../components/SiteHeader";
import { getCollection, getPostsInCollection } from "../lib/content";
import { SITE_NAME } from "../lib/seo";
import { TinkeringNotesGrid } from "./notes/TinkeringNotesGrid";

// Markdown content changes only when a new build is deployed, so render this
// route once instead of repeating the complete RSC render for every visitor.
export const dynamic = "force-static";

const TINKERING_DESCRIPTION =
  "浏览积雨云的技术笔记：Linux、KVM/QEMU、网络、NAS、Caddy、Android ADB 与自动化部署实践。";

export const metadata: Metadata = {
  title: "折腾日志",
  description: TINKERING_DESCRIPTION,
  alternates: { canonical: "/tinkering" },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: "/tinkering",
    siteName: SITE_NAME,
    title: `折腾日志 — ${SITE_NAME}`,
    description: TINKERING_DESCRIPTION,
  },
};

export default async function TinkeringPage() {
  const [collection, posts] = await Promise.all([
    getCollection("tinkering"),
    getPostsInCollection("tinkering"),
  ]);

  if (!collection) notFound();

  return (
    <main className="experience-shell tinkering-shell">
      <div className="ambient ambient--violet" aria-hidden="true" />
      <div className="ambient ambient--orange" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <SiteHeader edition="TINKERING · LAB" />

      <section className="tinkering-notes-page" aria-labelledby="tinkering-title">
        <div className="tinkering-notes-page__heading">
          <p data-nosnippet>BUILD / BREAK / LEARN</p>
          <h1 id="tinkering-title">折腾日志</h1>
          <span>{collection.description}</span>
        </div>
        <TinkeringNotesGrid posts={posts} />
      </section>
    </main>
  );
}
