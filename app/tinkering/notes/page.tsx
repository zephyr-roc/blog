import type { Metadata } from "next";
import { getPostsInCollection } from "../../lib/content";
import { TinkeringNotesGrid } from "./TinkeringNotesGrid";

export const metadata: Metadata = {
  title: "折腾日志 — 積雨雲的空間站",
  description: "工具、配置、踩坑与意外发现。",
};

export default async function TinkeringNotesPage() {
  const posts = await getPostsInCollection("tinkering");

  return (
    <main className="experience-shell notes-shell">
      <div className="ambient ambient--violet" aria-hidden="true" />
      <div className="ambient ambient--orange" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <header className="site-header">
        <a className="wordmark" href="/tinkering" aria-label="返回折腾页面">
          <span className="wordmark__mark" aria-hidden="true" />
          <span>积雨云的空间站</span>
        </a>
        <span className="edition">FIELD NOTES</span>
      </header>

      <section className="tinkering-notes-page" aria-labelledby="notes-title">
        <div className="tinkering-notes-page__heading">
          <a href="/tinkering" className="tinkering-notes-page__back">← 返回折腾</a>
          <p>BUILD / BREAK / LEARN</p>
          <h1 id="notes-title">折腾日志</h1>
          <span>一些工具、配置、踩坑记录，以及偶然发现的解法。</span>
        </div>
        <TinkeringNotesGrid posts={posts} />
      </section>
    </main>
  );
}
