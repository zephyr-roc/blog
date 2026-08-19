import Link from "next/link";
import type { CSSProperties } from "react";
import { GlassCard } from "./GlassCard";
import type { CollectionMeta } from "../lib/content";

type CollectionCardStyle = CSSProperties & { "--collection-color": string };

export function CollectionCard({
  collection,
  index,
  total,
}: {
  collection: CollectionMeta;
  index: number;
  total: number;
}) {
  const style: CollectionCardStyle = {
    "--collection-color": collection.color,
  };

  return (
    <GlassCard
      className="collection-card"
      ariaLabel={`${collection.title} 合集，共 ${collection.postCount} 篇文章。`}
    >
      <div className="collection-card__index" aria-hidden="true">
        <span>COLLECTION</span>
        <span>
          {String(index).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
      </div>

      <div className="collection-card__bloom" style={style} aria-hidden="true" />

      <div className="collection-card__content">
        <p className="collection-card__eyebrow">BLOG · 合集</p>
        <h2>{collection.title}</h2>
        <p className="collection-card__description">{collection.description}</p>
        <span className="collection-card__count">
          {collection.postCount} 篇文章
        </span>
      </div>

      <Link
        href={`/collections/${collection.slug}`}
        className="collection-card__link"
        aria-label={`进入 ${collection.title} 合集`}
      />
    </GlassCard>
  );
}
