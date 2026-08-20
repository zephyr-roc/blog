import type { CSSProperties } from "react";
import { GlassCard } from "./GlassCard";
import type { CollectionMeta } from "../lib/content";

type CollectionCardStyle = CSSProperties & {
  "--collection-color": string;
  "--card-bloom": string;
};

function CollectionIcon({ icon, color }: { icon: string; color: string }) {
  if (icon === "kotlin") {
    return (
      <div className="collection-card__icon collection-card__icon--kotlin" aria-hidden="true">
        <span className="kotlin-logo" />
      </div>
    );
  }
  if (icon === "nim") {
    return (
      <div
        className="collection-card__icon collection-card__icon--nim"
        style={{ color, borderColor: color } as CSSProperties}
        aria-hidden="true"
      >
        <span className="nim-crown" />
        <span className="language-mark__word">N</span>
      </div>
    );
  }
  if (icon === "zig") {
    return (
      <div className="collection-card__icon collection-card__icon--zig" aria-hidden="true">
        <img src="/zig-logomark.svg" alt="" />
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
  featured = false,
  index,
  total,
}: {
  collection: CollectionMeta;
  featured?: boolean;
  index?: number;
  total?: number;
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
        {featured && index !== undefined && total !== undefined && (
          <div className="collection-card__index" aria-hidden="true">
            <span>COLLECTION</span>
            <span>
              {String(index).padStart(2, "0")} / {String(total).padStart(2, "0")}
            </span>
          </div>
        )}

        {!featured && collection.latestDate && (
          <time
            dateTime={collection.latestDate}
            aria-label={`最近更新于 ${collection.latestDate}`}
            style={{
              position: "absolute",
              zIndex: 4,
              top: "5cqw",
              right: "5.22cqw",
              color: "rgba(247, 244, 255, .48)",
              fontSize: "clamp(8px, 2.25cqw, 10px)",
              fontWeight: 700,
              letterSpacing: ".14em",
              transform: "translate3d(var(--detail-x), var(--detail-y), 4cqw)",
            }}
          >
            {collection.latestDate}
          </time>
        )}

        <div className="collection-card__icon-wrap" aria-hidden="true">
          <CollectionIcon icon={collection.icon} color={collection.color} />
        </div>

        <div
          className="collection-card__content"
          style={featured ? undefined : { bottom: "5.5cqw" }}
        >
          {featured && <p className="collection-card__eyebrow">BLOG · 合集</p>}
          <h2>{collection.title}</h2>
          {featured ? (
            <>
              <p className="collection-card__description">{collection.description}</p>
              <span className="collection-card__count">
                {collection.postCount} 篇文章
              </span>
            </>
          ) : (
            <>
              <p
                className="collection-card__description"
                style={{
                  display: "-webkit-box",
                  marginTop: "1.5cqw",
                  overflow: "hidden",
                  fontSize: "clamp(9px, 2.65cqw, 11px)",
                  lineHeight: 1.45,
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: 2,
                }}
              >
                {collection.description}
              </p>
              <span
                className="collection-card__count"
                style={{
                  marginTop: "1.5cqw",
                  padding: ".75cqw 1.15cqw",
                  fontSize: "clamp(8px, 2.25cqw, 10px)",
                }}
              >
                {collection.postCount} 篇文章
              </span>
            </>
          )}
        </div>
      </GlassCard>
    </a>
  );
}
