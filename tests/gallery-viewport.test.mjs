import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = name => readFile(new URL(name, root), "utf8");

test("gallery masonry fills large viewport, photo detail stays in small safe viewport", async () => {
  const [css, viewport, button] = await Promise.all([
    read("app/globals.css"),
    read("app/components/GalleryViewport.tsx"),
    read("app/components/GalleryOpenButton.tsx"),
  ]);
  const start = css.indexOf("/* The masonry view can extend behind Safari's browser chrome");
  const end = css.indexOf("@media (max-width: 900px)", start);
  assert.ok(start >= 0 && end > start);
  const galleryCss = css.slice(start, end);

  assert.match(galleryCss, /\.experience-shell\.gallery-shell\s*\{[^}]*height: 100vh;\s*height: 100lvh;/);
  assert.match(galleryCss, /body\[data-gallery-viewer-open="true"\] \.experience-shell\.gallery-shell\s*\{[^}]*height: 100vh;\s*height: 100svh;/);
  assert.match(galleryCss, /\.gallery-embed\s*\{[^}]*position: relative;[^}]*height: 100%;/);
  assert.doesNotMatch(galleryCss, /100dvh|visualViewport|--gallery-visual|--gallery-controls-reserve/);
  assert.doesNotMatch(viewport, /visualViewport|innerHeight|screenHeight|style\.setProperty/);
  assert.doesNotMatch(button, /viewport-fit=cover/);
  const prepare = await read("scripts/prepare-cloudflare.mjs");
  assert.doesNotMatch(prepare, /viewport-fit=cover/);
  assert.match(prepare, /Retained dist\/server/);
  assert.doesNotMatch(prepare, /await rm\(path\.join\(root, "dist\/server"/);
  assert.match(prepare, /await rm\(path\.join\(root, "dist\/standalone"/);
});

test("photo viewer hides both blog Navigation and gallery-open arrow", async () => {
  const [css, embed, bridge] = await Promise.all([
    read("app/globals.css"),
    read("app/components/GalleryEmbed.tsx"),
    read("public/afilmory-embed-bridge.js"),
  ]);
  assert.match(css, /body\[data-gallery-viewer-open="true"\] \.liquid-navigation,\s*body\[data-gallery-viewer-open="true"\] \.gallery-open-button\s*\{/);
  assert.match(embed, /readGalleryViewerMessage\(event, frameRef\.current\?\.contentWindow\)/);
  assert.match(embed, /\.liquid-navigation, \.gallery-open-button/);
  assert.match(embed, /control\.inert = viewerOpen/);
  assert.doesNotMatch(embed, /blog:viewport|publishViewport/);
  assert.match(bridge, /afilmory:viewer-state/);
  assert.doesNotMatch(bridge, /\.pb-safe|blog:viewport/);
});
