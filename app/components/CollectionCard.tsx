import type { CSSProperties } from "react";
import { GlassCard } from "./GlassCard";
import type { CollectionMeta } from "../lib/content";

type CollectionCardStyle = CSSProperties & {
  "--collection-color": string;
  "--card-bloom": string;
};

function CollectionIcon({ icon, color }: { icon: string; color: string }) {
  const officialLogo = ["kotlin", "java", "rust", "csharp", "react", "ocaml", "zig"].includes(icon)
    ? `/language-logos/${icon}.svg`
    : null;

  if (officialLogo) {
    return (
      <div className={`collection-card__icon collection-card__icon--${icon}`} aria-hidden="true">
        <img src={officialLogo} alt="" width={64} />
      </div>
    );
  }
  return (
    <div
      className="collection-card__icon collection-card__icon--generic"
      style={{ "--collection-color": color } as CollectionCardStyle}
      aria-hidden="true"
    >
      {icon === "tinkering" ? "⚙" : icon.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function CollectionCard({
  collection,
}: {
  collection: CollectionMeta;
}) {
  const style: CollectionCardStyle = {
    "--collection-color": collection.color,
    "--card-bloom": `radial-gradient(circle at 44% 40%, ${collection.color} 0%, transparent 70%)`,
  };

  return (
    <a
      href={`/collections/${collection.slug}`}
      className="collection-card-link"
      aria-label={`进入 ${collection.title} 合集`}
    >
      <GlassCard
        className="collection-card"
        ariaLabel={`${collection.title} 合集，共 ${collection.postCount} 篇文章`}
        style={style}
      >
        <div className="collection-card__clip">
          {collection.latestDate && (
            <time
              className="collection-card__date"
              dateTime={collection.latestDate}
              aria-label={`最近更新于 ${collection.latestDate}`}
            >
              {collection.latestDate}
            </time>
          )}

          <div className="collection-card__icon-wrap" aria-hidden="true">
            <CollectionIcon icon={collection.icon} color={collection.color} />
          </div>

          <div className="collection-card__content">
            <h2>{collection.title}</h2>
            <p className="collection-card__description">{collection.description}</p>
            <span className="collection-card__count">
              {collection.postCount} 篇文章
            </span>
          </div>
        </div>
      </GlassCard>
    </a>
  );
}
