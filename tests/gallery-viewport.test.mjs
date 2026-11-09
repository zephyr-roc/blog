import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { galleryViewportRect } from "../app/lib/gallery-viewport.mjs";

const root = new URL("../", import.meta.url);

test("follows the actual visual viewport rather than full physical screen height", () => {
  assert.deepEqual(galleryViewportRect({
    visualHeight: 738, visualWidth: 393, visualOffsetTop: 0,
    layoutHeight: 852, layoutWidth: 393,
  }), { top: 0, left: 0, width: 393, height: 738, layoutHeight: 738 });
});

test("moves with a changing toolbar or keyboard without extending the iframe", () => {
  assert.deepEqual(galleryViewportRect({
    visualHeight: 620, visualWidth: 393, visualOffsetTop: 12,
    layoutHeight: 852, layoutWidth: 393,
  }), { top: 12, left: 0, width: 393, height: 620, layoutHeight: 632 });
});

test("supports browsers without visualViewport and avoids zoom-dependent resizing", () => {
  assert.deepEqual(galleryViewportRect({
    layoutHeight: 800, layoutWidth: 1200,
  }), { top: 0, left: 0, width: 1200, height: 800, layoutHeight: 800 });
  assert.deepEqual(galleryViewportRect({
    visualHeight: 320, visualWidth: 250, visualScale: 2,
    layoutHeight: 780, layoutWidth: 390,
  }), { top: 0, left: 0, width: 390, height: 780, layoutHeight: 780 });
  assert.equal(galleryViewportRect({ layoutHeight: 0, layoutWidth: 0 }), null);
});

test("gallery viewport CSS has modern, legacy and no-clipping fallbacks", async () => {
  const css = await readFile(new URL("app/globals.css", root), "utf8");
  const component = await readFile(new URL("app/components/GalleryViewport.tsx", root), "utf8");
  const galleryCss = css.slice(css.indexOf("/* Afilmory owns scrolling;"));
  assert.doesNotMatch(galleryCss, /100lvh|contain: strict|contain: layout paint style/);
  assert.match(galleryCss, /position: absolute;[\s\S]*?z-index: 2/);
  assert.match(galleryCss, /height: 100vh;[\s\S]*?height: 100svh;[\s\S]*?height: 100dvh;/);
  assert.match(galleryCss, /gallery-controls-reserve/);
  assert.match(component, /visualViewport\?\.addEventListener\("resize", schedule\)/);
  assert.match(component, /visualViewport\?\.addEventListener\("scroll", schedule\)/);
});
