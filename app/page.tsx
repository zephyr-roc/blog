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

const HOME_COLLECTION_ORDER = ["kotlin", "java", "rust", "react", "ocaml", "zig"];
const HOME_COLLECTIONS_HIDDEN = new Set(["tinkering", "deep-radar"]);

function getBalancedRowSizes(collectionCount: number) {
  if (collectionCount <= 3) return collectionCount > 0 ? [collectionCount] : [];

  const completeRows = Math.floor(collectionCount / 3);
  const remainder = collectionCount % 3;
  if (remainder === 0) return Array(completeRows).fill(3);
  if (remainder === 2) return [...Array(completeRows).fill(3), 2];

  return [...Array(completeRows - 1).fill(3), 2, 2];
}

function createWatchLayout<T extends { weight: number }>(items: T[]) {
  if (items.length === 0) return [];
  if (items.length < 3) return [items];

  const centerCandidates = items.slice(1);
  let sidePair: [number, number] = [0, 1];
  let smallestDifference = Math.abs(centerCandidates[0].weight - centerCandidates[1].weight);
  for (let left = 0; left < centerCandidates.length - 1; left += 1) {
    for (let right = left + 1; right < centerCandidates.length; right += 1) {
      const difference = Math.abs(centerCandidates[left].weight - centerCandidates[right].weight);
      if (difference < smallestDifference) {
        sidePair = [left, right];
        smallestDifference = difference;
      }
    }
  }

  const centerRow = [centerCandidates[sidePair[0]], items[0], centerCandidates[sidePair[1]]];
  const surroundingItems = centerCandidates.filter((_, index) => !sidePair.includes(index));
  const topItemCount = Math.ceil(surroundingItems.length / 2);
  const topItems = surroundingItems.slice(0, topItemCount);
  const bottomItems = surroundingItems.slice(topItemCount);

  const splitRows = (rowItems: T[]) => {
    let offset = 0;
    return getBalancedRowSizes(rowItems.length).map((rowSize) => {
      const row = rowItems.slice(offset, offset + rowSize);
      offset += rowSize;
      return row;
    });
  };

  return [...splitRows(topItems), centerRow, ...splitRows(bottomItems)];
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
  const weightedCollections = collections.map((collection, index) => ({
    collection,
    index,
    weight: 1 + Math.log2(collection.postCount + 1),
    ratio: index === 0
      ? 1.5
      : Math.min(16 / 9, 1 + Math.log2(collection.postCount + 1) * 0.5),
  }));
  const collectionRows = createWatchLayout(weightedCollections);
  const centerRowIndex = collectionRows.findIndex((row) =>
    row.some(({ index }) => index === 0),
  );

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
          <div className={`card-collection${collections.length % 2 ? " card-collection--odd" : ""}`}>
            {collectionRows.map((row, rowIndex) => (
              <div
                key={`row-${rowIndex}`}
                className={`card-collection__row card-collection__row--${row.length} ${
                  rowIndex < centerRowIndex
                    ? "card-collection__row--above"
                    : rowIndex === centerRowIndex
                      ? "card-collection__row--center"
                      : "card-collection__row--below"
                }`}
                style={{
                  gridTemplateColumns: row
                    .map(({ weight }) => `minmax(180px, ${weight.toFixed(3)}fr)`)
                    .join(" "),
                } as CSSProperties}
              >
                {row.map(({ collection, index, weight, ratio }) => (
                  <div
                    key={collection.slug}
                    className={
                      index === 0
                        ? "card-collection__item card-collection__primary"
                        : "card-collection__item card-collection__companion"
                    }
                    style={{
                      "--collection-weight": weight.toFixed(3),
                      "--collection-ratio": ratio.toFixed(4),
                    } as CSSProperties}
                  >
                    <CollectionCard
                      collection={collection}
                      featured={index === 0}
                      index={index + 1}
                      total={collections.length}
                    />
                  </div>
                ))}
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
