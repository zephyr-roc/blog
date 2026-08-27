import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LikeButton } from "../../components/LikeButton";
import { PostContent } from "../../components/PostContent";
import { getPost, getPostsInCollection } from "../../lib/content";
import {
  blogPostingJsonLd,
  serializeJsonLd,
  SITE_NAME,
} from "../../lib/seo";

export const dynamic = "force-static";
export const revalidate = 60;

type Props = { params: Promise<{ post: string }> };

export async function generateStaticParams() {
  const posts = await getPostsInCollection("deep-radar");
  return posts.map((post) => ({ post: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { post: postSlug } = await params;
  const post = await getPost("deep-radar", postSlug);
  if (!post) return {};

  const canonical = `/radar/${postSlug}`;

  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical },
    openGraph: {
      type: "article",
      locale: "zh_CN",
      url: canonical,
      siteName: SITE_NAME,
      title: `${post.title} — ${SITE_NAME}`,
      description: post.excerpt,
      publishedTime: post.date || undefined,
      modifiedTime: post.date || undefined,
    },
    twitter: {
      card: "summary",
      title: post.title,
      description: post.excerpt,
    },
  };
}

export default async function RadarPostPage({ params }: Props) {
  const { post: postSlug } = await params;
  const post = await getPost("deep-radar", postSlug);

  if (!post) notFound();

  const canonical = `/radar/${postSlug}`;
  const dateLabel = post.date
    ? new Date(post.date).toLocaleDateString("zh-CN", {
        timeZone: "UTC",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <main className="experience-shell radar-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(blogPostingJsonLd(post, canonical)),
        }}
      />
      <div className="ambient ambient--violet" aria-hidden="true" />
      <div className="ambient ambient--orange" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <article className="post-page radar-post-page">
        <nav className="collection-page__breadcrumb">
          <a href="/radar">深潜雷达</a>
          <span aria-hidden="true"> / </span>
          <span>{post.title}</span>
        </nav>

        <header className="post-page__header">
          {dateLabel && (
            <time className="post-page__date" dateTime={post.date}>
              {dateLabel}
            </time>
          )}
          <h1>{post.title}</h1>
          {post.excerpt && <p className="post-page__excerpt">{post.excerpt}</p>}
        </header>

        <PostContent html={post.htmlContent} />
        <LikeButton collectionSlug="deep-radar" postSlug={postSlug} />
      </article>
    </main>
  );
}
