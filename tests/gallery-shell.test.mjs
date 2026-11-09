import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("gallery shell renders only the embed and its two navigation controls", async () => {
  const [gallery, chrome, css] = await Promise.all([
    readFile(new URL("app/gallery/page.tsx", root), "utf8"),
    readFile(new URL("app/components/SiteChrome.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(gallery, /<GalleryEmbed \/>/);
  assert.match(gallery, /<GalleryOpenButton \/>/);
  assert.doesNotMatch(gallery, /className="(?:grain|ambient)/);
  assert.match(chrome, /<LiquidGlassNavigation \/>/);
  assert.match(chrome, /!isGallery && <GlassMotionController \/>/);
  assert.match(chrome, /!isGallery && <BackToTopButton \/>/);
  assert.match(chrome, /!isGallery && footer/);
  assert.match(css, /\.experience-shell\.gallery-shell::before,[\s\S]*?content: none;/);
  assert.match(css, /\.experience-shell\.gallery-shell\s*\{[\s\S]*?background: #09090e;\s*background-image: none;/);
});

test("EdgeOne publishes the static client output instead of Vinext SSR", async () => {
  const config = JSON.parse(await readFile(new URL("edgeone.json", root), "utf8"));
  const prepare = await readFile(new URL("scripts/prepare-cloudflare.mjs", root), "utf8");

  assert.equal(config.framework, "other");
  assert.equal(config.outputDirectory, "dist/client");
  assert.match(config.buildCommand, /pnpm build/);
  assert.match(prepare, /rm\(path\.join\(root, "dist\/server"\)/);
});
