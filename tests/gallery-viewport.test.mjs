import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = name => readFile(new URL(name, root), "utf8");

test("gallery uses one native dynamic viewport in both list and photo detail", async () => {
  const [css, viewport, button] = await Promise.all([
    read("app/globals.css"),
    read("app/components/GalleryViewport.tsx"),
    read("app/components/GalleryOpenButton.tsx"),
  ]);
  const start = css.indexOf("/* Let the browser determine the gallery viewport, just like Afilmory.");
  const end = css.indexOf("@media (max-width: 900px)", start);
  assert.ok(start >= 0 && end > start);
  const galleryCss = css.slice(start, end);

  assert.match(galleryCss, /\.experience-shell\.gallery-shell\s*\{[^}]*height: 100vh;\s*height: 100dvh;/);
  assert.match(galleryCss, /\.gallery-embed\s*\{[^}]*position: relative;[^}]*height: 100%;/);
  assert.doesNotMatch(galleryCss, /100lvh|100svh|visualViewport|--gallery-visual|--gallery-controls-reserve/);
  assert.doesNotMatch(galleryCss, /body\[data-gallery-viewer-open="true"\] \.gallery-shell/);
  assert.doesNotMatch(viewport, /visualViewport|innerHeight|screenHeight|style\.setProperty/);
  assert.doesNotMatch(button, /viewport-fit=cover/);
  const prepare = await read("scripts/prepare-cloudflare.mjs");
  assert.doesNotMatch(prepare, /viewport-fit=cover/);
  assert.match(prepare, /Retained dist\\/server/);
  assert.doesNotMatch(prepare, /await rm\\(path\\.join\\(root, "dist\\/server"/);
  assert.match(prepare, /await rm\\(path\\.join\\(root, "dist\\/standalone"/);
});

test("viewer messages only hide blog Navigation, not the gallery window button", async () => {
  const [css, embed, bridge] = await Promise.all([
    read("app/globals.css"),
    read("app/components/GalleryEmbed.tsx"),
    read("public/afilmory-embed-bridge.js"),
  ]);
  assert.match(css, /body\[data-gallery-viewer-open="true"\] \.liquid-navigation\s*\{/);
  assert.doesNotMatch(css, /body\[data-gallery-viewer-open="true"\] \.gallery-open-button/);
  assert.match(embed, /readGalleryViewerMessage\(event, frameRef\.current\?\.contentWindow\)/);
  assert.match(embed, /navigation\.inert = viewerOpen/);
  assert.doesNotMatch(embed, /blog:viewport|publishViewport/);
  assert.match(bridge, /afilmory:viewer-state/);
  assert.doesNotMatch(bridge, /\.pb-safe|blog:viewport/);
});
