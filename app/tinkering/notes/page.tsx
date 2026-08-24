import type { Metadata } from "next";
import { getPostsInCollection } from "../../lib/content";
import { SITE_NAME } from "../../lib/seo";
import { TinkeringNotesGrid } from "./TinkeringNotesGrid";

// Markdown content changes only when a new build is deployed, so render this
// route once instead of repeating the complete RSC render for every visitor.
export const dynamic = "force-static";

const NOTES_DESCRIPTION =
  "浏览积雨云的技术笔记：Linux、KVM/QEMU、网络、NAS、Caddy、Android ADB 与自动化部署实践。";

export const metadata: Metadata = {
  title: "折腾日志",
  description: NOTES_DESCRIPTION,
  alternates: { canonical: "/tinkering/notes" },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: "/tinkering/notes",
    siteName: SITE_NAME,
    title: `折腾日志 — ${SITE_NAME}`,
    description: NOTES_DESCRIPTION,
  },
};

export default async function TinkeringNotesPage() {
  const posts = await getPostsInCollection("tinkering");

  return (
    <main className="experience-shell notes-shell">
      <div className="ambient ambient--violet" aria-hidden="true" />
      <div className="ambient ambient--orange" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <section className="tinkering-notes-page" aria-labelledby="notes-title">
        <div className="tinkering-notes-page__heading">
          <a href="/tinkering" className="tinkering-notes-page__back" data-nosnippet>← 返回折腾</a>
          <p data-nosnippet>BUILD / BREAK / LEARN</p>
          <h1 id="notes-title">折腾日志</h1>
          <span>一些工具、配置、踩坑记录，以及偶然发现的解法。</span>
        </div>
        <TinkeringNotesGrid posts={posts} />
      </section>
    </main>
  );
}
