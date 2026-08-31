import type { Metadata } from "next";
import type { CSSProperties } from "react";
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

const HOME_COLLECTION_ORDER = ["kotlin", "java", "rust", "csharp", "react", "ocaml", "zig"];
const HOME_COLLECTIONS_HIDDEN = new Set(["tinkering", "deep-radar"]);

function createWatchLayout<T>(items: T[]) {
  if (items.length === 0) return [];
  const centerRow = items.slice(0, 2);
  const surroundingRows: T[][] = [];
  for (let offset = 2; offset < items.length; offset += 2) {
    surroundingRows.push(items.slice(offset, offset + 2));
  }
  const rowsAbove = surroundingRows.slice(0, Math.ceil(surroundingRows.length / 2)).reverse();
  const rowsBelow = surroundingRows.slice(rowsAbove.length);
  return [...rowsAbove, centerRow, ...rowsBelow];
}

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
  const collectionScores = collections.map((collection) => Math.log2(collection.postCount + 1));
  const lowestScore = Math.min(...collectionScores);
  const scoreRange = Math.max(...collectionScores) - lowestScore;
  const weightedCollections = collections.map((collection, index) => ({
    collection,
    ratio: scoreRange === 0
      ? 1.3
      : 1 + ((collectionScores[index] - lowestScore) / scoreRange) * 0.6,
  }));
  const collectionRows = createWatchLayout(weightedCollections);
  const centerRowIndex = collectionRows.findIndex((row) => row.includes(weightedCollections[0]));

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
          <div className="card-collection" data-motion-group="true">
            {collectionRows.map((row, rowIndex) => {
              const center = rowIndex === centerRowIndex;
              const ratioSum = row.reduce((sum, item) => sum + item.ratio, 0);
              const gaps = (row.length - 1) * 18;
              const desktopHeight = center ? 250 : 176;
              const compactHeight = center ? 210 : 142;
              return (
                <div
                  key={`row-${rowIndex}`}
                  className={`card-collection__row card-collection__row--${row.length}${
                    center ? " card-collection__row--center" : ""
                  }`}
                  style={{
                    "--collection-row-width": `${ratioSum * desktopHeight + gaps}px`,
                    "--collection-row-compact-width": `${ratioSum * compactHeight + gaps}px`,
                    gridTemplateColumns: row
                      .map(({ ratio }) => `minmax(0, ${ratio.toFixed(4)}fr)`)
                      .join(" "),
                  } as CSSProperties}
                >
                  {row.map(({ collection, ratio }) => (
                  <div
                    key={collection.slug}
                    className="card-collection__item"
                    style={{
                      "--collection-ratio": ratio.toFixed(4),
                    } as CSSProperties}
                  >
                    <CollectionCard collection={collection} />
                  </div>
                  ))}
                </div>
              );
            })}
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
