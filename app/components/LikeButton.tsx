"use client";

import { useEffect, useState } from "react";

export function LikeButton({
  collectionSlug,
  postSlug,
}: {
  collectionSlug: string;
  postSlug: string;
}) {
  const endpoint = `/api/likes/${encodeURIComponent(collectionSlug)}/${encodeURIComponent(postSlug)}`;
  const storageKey = `blog-liked:${collectionSlug}/${postSlug}`;
  const [count, setCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLiked(window.localStorage.getItem(storageKey) === "1");

    fetch(endpoint, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load like count");
        return response.json() as Promise<{ count: number }>;
      })
      .then((data) => setCount(data.count))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [endpoint, storageKey]);

  const like = async () => {
    if (liked || loading) return;

    setLoading(true);
    try {
      const response = await fetch(endpoint, { method: "POST" });
      if (!response.ok) throw new Error("Unable to like post");
      const data = await response.json() as { count: number };
      setCount(data.count);
      setLiked(true);
      window.localStorage.setItem(storageKey, "1");
    } finally {
      setLoading(false);
    }
  };

  return (
    <footer
      style={{
        display: "grid",
        placeItems: "center",
        marginTop: "56px",
        paddingTop: "32px",
        borderTop: "1px solid rgba(255,255,255,.08)",
      }}
    >
      <button
        type="button"
        onClick={like}
        disabled={liked || loading}
        aria-pressed={liked}
        aria-label={liked ? `已点赞，共 ${count} 次点赞` : `点赞，共 ${count} 次点赞`}
        style={{
          display: "inline-flex",
          minWidth: "132px",
          minHeight: "46px",
          alignItems: "center",
          justifyContent: "center",
          gap: "10px",
          padding: "11px 20px",
          border: liked
            ? "1px solid rgba(255, 127, 153, .42)"
            : "1px solid rgba(255,255,255,.14)",
          borderRadius: "999px",
          background: liked
            ? "rgba(255, 96, 132, .12)"
            : "rgba(255,255,255,.045)",
          boxShadow: liked
            ? "0 10px 32px rgba(232, 69, 129, .14)"
            : "0 10px 28px rgba(0,0,0,.16)",
          color: liked ? "#ff9bb3" : "rgba(247,244,255,.78)",
          font: "inherit",
          fontSize: "13px",
          fontWeight: 650,
          letterSpacing: ".06em",
          cursor: liked || loading ? "default" : "pointer",
          opacity: loading ? .68 : 1,
          transition: "background 180ms ease, border-color 180ms ease, color 180ms ease, transform 180ms ease",
        }}
      >
        <span aria-hidden="true" style={{ fontSize: "17px", lineHeight: 1 }}>
          {liked ? "♥" : "♡"}
        </span>
        <span>{loading ? "读取中" : liked ? "已点赞" : "点赞"}</span>
        <span
          aria-hidden="true"
          style={{
            minWidth: "1.5em",
            color: "rgba(247,244,255,.5)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
      </button>
    </footer>
  );
}
