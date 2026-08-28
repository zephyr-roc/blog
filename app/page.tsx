import type { Metadata } from "next";
import { getAllCollections } from "./lib/content";
import { CollectionCard } from "./components/CollectionCard";
import { SiteHeader } from "./components/SiteHeader";
import { SITE_DESCRIPTION, SITE_NAME } from "./lib/seo";

// Markdown content changes only when a new build is deployed, so render this
// route once instead of repeating the complete RSC render for every visitor.
export const dynamic = "force-static";
export const revalidate = 60;

export const metadata: Metadata = {
  title: { absolute: SITE_NAME },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: "/",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
};

const HOME_COLLECTION_ORDER = ["kotlin", "java", "rust", "react", "ocaml", "zig"];
const HOME_COLLECTIONS_HIDDEN = new Set(["tinkering", "deep-radar"]);

export default async function Home() {
  const collections = (await getAllCollections()).filter(
    (collection) => !HOME_COLLECTIONS_HIDDEN.has(collection.slug),
  ).sort((a, b) => {
    const postCountDifference = b.postCount - a.postCount;
    if (postCountDifference !== 0) return postCountDifference;

    const aIndex = HOME_COLLECTION_ORDER.indexOf(a.slug);
    const bIndex = HOME_COLLECTION_ORDER.indexOf(b.slug);
    return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex)
      - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
  });

  return (
    <main className="experience-shell">
      <div className="ambient ambient--violet" aria-hidden="true" />
      <div className="ambient ambient--orange" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <SiteHeader edition="BLOG · 合集" home />

      <section className="hero" aria-labelledby="page-title">
        <div className="hero__intro">
          <p className="hero__kicker" data-nosnippet>WRITING, IN MOTION</p>
          <h1 id="page-title">
            记录想法，
            <br />
            分享所学。
          </h1>
          <p className="hero__lede">
            关于编程语言、系统设计与代码之美的随笔。
          </p>
        </div>

        <div className="hero__stage" id="collections">
          <div className="card-collection">
            {collections.map((collection, i) => (
              <div
                key={collection.slug}
                className={
                  i === 0
                    ? "card-collection__primary"
                    : "card-collection__companion"
                }
              >
                <CollectionCard
                  collection={collection}
                  featured={i === 0}
                  index={i + 1}
                  total={collections.length}
                />
              </div>
            ))}
          </div>
          <div className="interaction-hint" aria-hidden="true" data-nosnippet>
            <span className="interaction-hint__line" />
            CLICK TO EXPLORE
          </div>
        </div>
      </section>

      <footer className="site-footer" data-nosnippet>
        <span>MODERN LANGUAGES · OPEN SOURCE</span>
        <div className="site-footer__actions">
          <span>积雨云的空间站</span>
        </div>
      </footer>
    </main>
  );
}
