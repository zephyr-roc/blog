import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GlassCard } from "../components/GlassCard";
import { getCollection, getPostsInCollection } from "../lib/content";

export const metadata: Metadata = {
  title: "折腾 — 積雨雲的空間站",
  description: "工具、配置、踩坑与意外发现。",
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

      <header className="site-header">
        <a className="wordmark" href="/" aria-label="返回主页">
          <span className="wordmark__mark" aria-hidden="true" />
          <span>积雨云的空间站</span>
        </a>
        <span className="edition">TINKERING · LAB</span>
      </header>

      <section className="hero tinkering-hero" aria-labelledby="tinkering-title">
        <div className="hero__intro">
          <p className="hero__kicker">BUILD / BREAK / LEARN</p>
          <h1 id="tinkering-title">
            保持好奇，
            <br />
            随手折腾。
          </h1>
          <p className="hero__lede">
            {collection.description}
            <br />
            把每一次尝试，都变成下一次出发的线索。
          </p>
        </div>

        <div className="hero__stage tinkering-hero__stage">
          <GlassCard
            className="tinkering-card"
            ariaLabel={`折腾日志，共 ${posts.length} 篇记录`}
          >
            <div className="tinkering-card__header" aria-hidden="true">
              <span>FIELD NOTES</span>
              <span>{String(posts.length).padStart(2, "0")} ENTRIES</span>
            </div>

            <div className="tinkering-card__mark" aria-hidden="true">
              <span>⚙</span>
            </div>

            <div className="tinkering-card__content">
              <p>RECENT EXPERIMENTS</p>
              <h2>折腾日志</h2>
              {posts.length === 0 ? (
                <p className="tinkering-card__empty">新的实验正在酝酿中。</p>
              ) : (
                <div className="tinkering-card__entries">
                  {posts.map((post) => (
                    <a
                      className="tinkering-card__entry"
                      href={`/tinkering/${post.slug}`}
                      key={post.slug}
                    >
                      <span>
                        <strong>{post.title}</strong>
                        <small>{post.excerpt}</small>
                      </span>
                      <span className="tinkering-card__arrow" aria-hidden="true">→</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </GlassCard>

          <div className="interaction-hint" aria-hidden="true">
            <span className="interaction-hint__line" />
            CLICK TO READ
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <span>TOOLS · CONFIGS · HAPPY ACCIDENTS</span>
        <span>积雨云的实验场</span>
      </footer>
    </main>
  );
}
