import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getAllCollections, getCollection, getPostsInCollection } from "../../lib/content";
import { PostListItem } from "../../components/PostListItem";

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  const collections = await getAllCollections();
  return collections.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const collection = await getCollection(slug);
  if (!collection) return {};
  return { title: `${collection.title} — 積雨雲的空間站` };
}

export default async function CollectionPage({ params }: Props) {
  const { slug } = await params;

  if (slug === "tinkering") redirect("/tinkering");

  const [collection, posts] = await Promise.all([
    getCollection(slug),
    getPostsInCollection(slug),
  ]);

  if (!collection) notFound();

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
          <ul className="post-list" aria-label={`${collection.title} 文章列表`}>
            {posts.map((post) => (
              <PostListItem key={post.slug} post={post} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
