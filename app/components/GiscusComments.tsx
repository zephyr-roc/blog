"use client";

import { useEffect, useRef } from "react";

const GISCUS_ORIGIN = "https://giscus.app";
const LIGHT_SURFACE_THRESHOLD = .24;

function relativeLuminance(hex: string) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return 0;
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= .04045
      ? value / 12.92
      : ((value + .055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

function currentGiscusTheme(shell: HTMLElement | null) {
  if (!shell?.dataset.readingAppearance) return "transparent_dark";
  const background = getComputedStyle(shell)
    .getPropertyValue("--reading-background")
    .trim();
  return relativeLuminance(background) >= LIGHT_SURFACE_THRESHOLD
    ? "light"
    : "transparent_dark";
}

export function GiscusComments() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const shell = document.querySelector<HTMLElement>(".post-shell");
    const script = document.createElement("script");
    script.src = `${GISCUS_ORIGIN}/client.js`;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.repo = "zephyr-roc/blog";
    script.dataset.repoId = "R_kgDOT9ji4g";
    script.dataset.category = "Announcements";
    script.dataset.categoryId = "DIC_kwDOT9ji4s4DFx5B";
    script.dataset.mapping = "pathname";
    script.dataset.strict = "1";
    script.dataset.reactionsEnabled = "1";
    script.dataset.emitMetadata = "0";
    script.dataset.inputPosition = "top";
    script.dataset.loading = "lazy";
    script.dataset.theme = currentGiscusTheme(shell);
    script.dataset.lang = "zh-CN";
    container.append(script);

    const syncTheme = () => {
      const theme = currentGiscusTheme(shell);
      const frame = container.querySelector<HTMLIFrameElement>("iframe.giscus-frame");
      frame?.contentWindow?.postMessage(
        { giscus: { setConfig: { theme } } },
        GISCUS_ORIGIN,
      );
    };

    const observer = shell
      ? new MutationObserver(syncTheme)
      : null;
    observer?.observe(shell, {
      attributes: true,
      attributeFilter: ["data-reading-appearance", "style"],
    });

    return () => {
      observer?.disconnect();
      container.replaceChildren();
    };
  }, []);

  return (
    <section className="article-comments" aria-labelledby="article-comments-title">
      <header className="article-comments__header">
        <p>DISCUSSION</p>
        <h2 id="article-comments-title">评论</h2>
        <span>使用 GitHub 参与讨论</span>
      </header>
      <div ref={containerRef} className="giscus article-comments__embed" />
    </section>
  );
}
