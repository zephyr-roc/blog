import { getPostsInCollection } from "../../lib/content";
import { SITE_NAME, SITE_URL } from "../../lib/seo";

export const dynamic = "force-static";
export const revalidate = 60;

const FEED_TITLE = `深潜雷达 — ${SITE_NAME}`;
const FEED_DESCRIPTION =
  "每日筛选有实测、源码、原理与工程价值的 JVM、Kotlin、Rust、Zig 和 Linux 深度技术文章。";

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[character];
  });
}

export async function GET() {
  const posts = await getPostsInCollection("deep-radar");
  const feedUrl = `${SITE_URL}/radar/feed.xml`;
  const items = posts
    .map((post) => {
      const url = `${SITE_URL}/radar/${post.slug}`;
      const publishedAt = new Date(`${post.date}T00:00:00+08:00`).toUTCString();

      return `
    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${publishedAt}</pubDate>
      <description>${escapeXml(post.excerpt)}</description>
    </item>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(FEED_TITLE)}</title>
    <link>${SITE_URL}/radar</link>
    <description>${escapeXml(FEED_DESCRIPTION)}</description>
    <language>zh-CN</language>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=60, must-revalidate",
    },
  });
}

