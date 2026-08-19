import { getAllCollections } from "./lib/content";
import { CollectionCard } from "./components/CollectionCard";

export default async function Home() {
  const collections = await getAllCollections();

  return (
    <main className="experience-shell">
      <div className="ambient ambient--violet" aria-hidden="true" />
      <div className="ambient ambient--orange" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <header className="site-header">
        <a className="wordmark" href="#collections" aria-label="积雨云的空间站首页">
          <span className="wordmark__mark" aria-hidden="true" />
          <span>积雨云的空间站</span>
        </a>
        <span className="edition">BLOG · 合集</span>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <div className="hero__intro">
          <p className="hero__kicker">WRITING, IN MOTION</p>
          <h1 id="page-title">
            记录想法，
            <br />
            分享所学。
          </h1>
          <p className="hero__lede">
            关于编程语言、系统设计与代码之美的随笔。
            <br />
            移动指针，感受卡片的层次与光线。
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
                  index={i + 1}
                  total={collections.length}
                />
              </div>
            ))}
          </div>
          <div className="interaction-hint" aria-hidden="true">
            <span className="interaction-hint__line" />
            CLICK TO EXPLORE
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <span>MODERN LANGUAGES · OPEN SOURCE</span>
        <div className="site-footer__actions">
          <span>积雨云的空间站</span>
        </div>
      </footer>
    </main>
  );
}
