import { ImageResponse } from "next/og";
import type { CollectionMeta, PostMeta } from "./content";
import { SITE_NAME, SITE_URL } from "./seo";

/* eslint-disable @next/next/no-img-element -- ImageResponse renders native image nodes. */

export const postSocialImageAlt = `${SITE_NAME}文章分享封面`;
export const postSocialImageSize = {
  width: 1200,
  height: 630,
};
export const postSocialImageContentType = "image/png";

const languageIcons = new Set([
  "csharp",
  "java",
  "kotlin",
  "ocaml",
  "react",
  "rust",
  "swift",
  "zig",
]);

function shortenTitle(title: string) {
  const characters = Array.from(title);
  return characters.length > 52
    ? `${characters.slice(0, 51).join("")}…`
    : title;
}

function titleFontSize(title: string) {
  const length = Array.from(title).length;
  if (length > 40) return 50;
  if (length > 28) return 58;
  return 68;
}

export function createPostSocialImage(
  post: PostMeta,
  collection: CollectionMeta,
) {
  const title = shortenTitle(post.title);
  const iconUrl = languageIcons.has(collection.icon)
    ? `${SITE_URL}/language-logos/${collection.icon}.svg`
    : `${SITE_URL}/favicon.svg`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          padding: "64px 72px",
          color: "#f8f6ff",
          backgroundColor: "#0b0911",
          backgroundImage: `radial-gradient(circle at 82% 14%, ${collection.color}66 0, transparent 38%), linear-gradient(135deg, #151022 0%, #0b0911 62%, #17101d 100%)`,
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: "26px",
            display: "flex",
            border: "1px solid rgba(255,255,255,.2)",
            borderRadius: "30px",
          }}
        />

        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "18px",
                fontSize: 24,
                color: "rgba(248,246,255,.82)",
                letterSpacing: "0.04em",
              }}
            >
              <img
                src={`${SITE_URL}/favicon.svg`}
                width={52}
                height={52}
                alt=""
              />
              <span>{SITE_NAME}</span>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "13px",
                padding: "11px 18px",
                border: "1px solid rgba(255,255,255,.2)",
                borderRadius: "999px",
                background: "rgba(255,255,255,.07)",
                fontSize: 20,
                color: "rgba(248,246,255,.88)",
              }}
            >
              <img src={iconUrl} width={31} height={31} alt="" />
              <span>{collection.title}</span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              maxWidth: "990px",
              gap: "24px",
            }}
          >
            <div
              style={{
                display: "flex",
                width: "86px",
                height: "5px",
                borderRadius: "999px",
                background: collection.color,
              }}
            />
            <div
              style={{
                display: "flex",
                fontSize: titleFontSize(title),
                lineHeight: 1.18,
                fontWeight: 700,
                letterSpacing: "-0.035em",
              }}
            >
              {title}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              color: "rgba(248,246,255,.58)",
              fontSize: 18,
              letterSpacing: "0.08em",
            }}
          >
            <span>READY-JUMP.TOP</span>
            <span>{post.date || "积雨云 · 技术博客"}</span>
          </div>
        </div>
      </div>
    ),
    {
      ...postSocialImageSize,
      headers: {
        "Cache-Control":
          "public, max-age=0, s-maxage=60, stale-while-revalidate=60, must-revalidate",
      },
    },
  );
}
