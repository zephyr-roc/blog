import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostListItem } from "../components/PostListItem";
import { SiteHeader } from "../components/SiteHeader";
import { getCollection, getPostsInCollection } from "../lib/content";
import { SITE_NAME } from "../lib/seo";

export const dynamic = "force-static";

const RADAR_DESCRIPTION =
  "每日筛选有实测、源码、原理与工程价值的 JVM、Kotlin、Rust、Zig 和 Linux 深度技术文章。";

export const metadata: Metadata = {
  title: "深潜雷达",
  description: RADAR_DESCRIPTION,
  alternates: {
    canonical: "/radar",
    types: { "application/rss+xml": "/radar/feed.xml" },
  },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: "/radar",
    siteName: SITE_NAME,
    title: `深潜雷达 — ${SITE_NAME}`,
    description: RADAR_DESCRIPTION,
  },
};

export default async function RadarPage() {
  const [collection, posts] = await Promise.all([
    getCollection("deep-radar"),
    getPostsInCollection("deep-radar"),
  ]);

  if (!collection) notFound();

  return (
    <main className="experience-shell radar-shell">
      <div className="ambient ambient--violet" aria-hidden="true" />
      <div className="ambient ambient--orange" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <SiteHeader edition="RADAR · DAILY" />

      <section className="radar-page" aria-labelledby="radar-title">
        <header className="radar-page__header">
          <div className="radar-page__signal" aria-hidden="true">
            <span />
          </div>
          <div>
            <p>DEEP SIGNAL / SOURCE / PROOF</p>
            <h1 id="radar-title">深潜雷达</h1>
            <span>{collection.description}</span>
          </div>
        </header>

        <div className="radar-page__criteria" aria-label="筛选标准">
          <span>实测数据</span>
          <span>源码路径</span>
          <span>原理闭环</span>
          <span>工程价值</span>
          <a href="/radar/feed.xml" type="application/rss+xml">
            订阅 RSS
          </a>
        </div>

        <section className="radar-archive" aria-labelledby="radar-archive-title">
          <header className="radar-archive__header">
            <div>
              <p>DAILY BRIEFINGS</p>
              <h2 id="radar-archive-title">每日精选</h2>
            </div>
            <span>{String(posts.length).padStart(2, "0")} 期</span>
          </header>

          <ul className="post-list radar-post-list">
            {posts.map((post) => (
              <PostListItem
                key={post.slug}
                post={post}
                href={`/radar/${post.slug}`}
              />
            ))}
          </ul>
        </section>
      </section>
    </main>
  );
}
