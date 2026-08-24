import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getAllPostSlugs, getCollection, getPost } from "../../../lib/content";
import { PostContent } from "../../../components/PostContent";
import { LikeButton } from "../../../components/LikeButton";
import {
  blogPostingJsonLd,
  serializeJsonLd,
  SITE_NAME,
} from "../../../lib/seo";

// Markdown content changes only when a new build is deployed, so render this
// route once instead of repeating the complete RSC render for every visitor.
export const dynamic = "force-static";

type Props = { params: Promise<{ slug: string; post: string }> };

export async function generateStaticParams() {
  const slugs = await getAllPostSlugs();
  return slugs.map((s) => ({ slug: s.collection, post: s.post }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, post: postSlug } = await params;
  const post = await getPost(slug, postSlug);
  if (!post) return {};

  const canonical =
    slug === "tinkering"
      ? `/tinkering/${postSlug}`
      : `/collections/${slug}/${postSlug}`;
  const images = post.cover
    ? [{ url: post.cover, alt: post.title }]
    : undefined;

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
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: post.title,
      description: post.excerpt,
      images: post.cover ? [post.cover] : undefined,
    },
  };
}

export default async function PostPage({ params }: Props) {
  const { slug, post: postSlug } = await params;

  if (slug === "tinkering") redirect(`/tinkering/${postSlug}`);

  const [post, collection] = await Promise.all([
    getPost(slug, postSlug),
    getCollection(slug),
  ]);

  if (!post) notFound();

  const canonical = `/collections/${slug}/${postSlug}`;
  const dateLabel = post.date
    ? new Date(post.date).toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <main className="experience-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(blogPostingJsonLd(post, canonical)),
        }}
      />
      <div className="ambient ambient--violet" aria-hidden="true" />
      <div className="ambient ambient--orange" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <article className="post-page">
        <nav className="collection-page__breadcrumb">
          <Link href="/">主页</Link>
          <span aria-hidden="true"> / </span>
          <Link href={`/collections/${slug}`}>{collection?.title ?? slug}</Link>
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
          {post.excerpt && (
            <p className="post-page__excerpt">{post.excerpt}</p>
          )}
        </header>

        <PostContent html={post.htmlContent} />
        <LikeButton collectionSlug={slug} postSlug={postSlug} />
      </article>
    </main>
  );
}
