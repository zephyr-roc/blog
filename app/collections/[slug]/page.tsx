import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getAllCollections, getCollection, getPostsInCollection } from "../../lib/content";
import { PostListItem } from "../../components/PostListItem";
import { SITE_NAME } from "../../lib/seo";

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  const collections = await getAllCollections();
  return collections.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const collection = await getCollection(slug);
  if (!collection) return {};

  const canonical =
    slug === "tinkering" ? "/tinkering" : `/collections/${slug}`;

  return {
    title: collection.title,
    description: collection.description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      locale: "zh_CN",
      url: canonical,
      siteName: SITE_NAME,
      title: `${collection.title} — ${SITE_NAME}`,
      description: collection.description,
    },
  };
}

export default async function CollectionPage({ params }: Props) {
  const { slug } = await params;

  if (slug === "tinkering") redirect("/tinkering");

  const [collection, posts] = await Promise.all([
    getCollection(slug),
    getPostsInCollection(slug),
  ]);

  if (!collection) notFound();

  const chapters = posts.reduce<Map<string, typeof posts>>((groups, post) => {
    const chapterPosts = groups.get(post.chapter) ?? [];
    chapterPosts.push(post);
    groups.set(post.chapter, chapterPosts);
    return groups;
  }, new Map());

  return (
    <main className="experience-shell">
      <div className="ambient ambient--violet" aria-hidden="true" />
      <div className="ambient ambient--orange" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <div className="collection-page">
        <nav className="collection-page__breadcrumb">
          <Link href="/">主页</Link>
          <span aria-hidden="true"> / </span>
          <span>{collection.title}</span>
        </nav>

        <header className="collection-page__header">
          <p className="collection-page__eyebrow">COLLECTION · 合集</p>
          <h1>{collection.title}</h1>
          <p className="collection-page__description">{collection.description}</p>
        </header>

        {posts.length === 0 ? (
          <p className="collection-page__empty">暂无文章</p>
        ) : (
          <div className="post-chapters">
            {[...chapters.entries()].map(([chapter, chapterPosts], index) => {
              const headingId = `chapter-${index + 1}`;
              const chapterLabel = `CHAPTER ${String(index + 1).padStart(2, "0")}`;

              return (
                <section className="post-chapter" aria-labelledby={headingId} key={chapter}>
                  <header className="post-chapter__header">
                    <div>
                      <p>{chapterLabel}</p>
                      <h2 id={headingId}>{chapter}</h2>
                    </div>
                    <span>{chapterPosts.length} 篇</span>
                  </header>
                  <ul className="post-list" aria-label={`${chapter}文章列表`}>
                    {chapterPosts.map((post) => (
                      <PostListItem key={post.slug} post={post} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
