import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { isIosQQInAppBrowser } from "../app/lib/gallery-browser.mjs";

const root = new URL("../", import.meta.url);
const read = name => readFile(new URL(name, root), "utf8");

test("masonry iframe has explicit large viewport height, detail uses small viewport", async () => {
  const [css, viewport, button] = await Promise.all([
    read("app/globals.css"),
    read("app/components/GalleryViewport.tsx"),
    read("app/components/GalleryOpenButton.tsx"),
  ]);
  const start = css.indexOf("/* The masonry view fills Safari's large viewport");
  const end = css.indexOf("@media (max-width: 900px)", start);
  assert.ok(start >= 0 && end > start);
  const galleryCss = css.slice(start, end);

  assert.match(galleryCss, /\.experience-shell\.gallery-shell\s*\{[^}]*height: 100vh;\s*height: 100lvh;/);
  assert.match(galleryCss, /\.gallery-embed\s*\{[^}]*position: absolute;[^}]*inset: 0;[^}]*height: 100vh;\s*height: 100lvh;/);
  assert.match(galleryCss, /\.gallery-embed__frame\s*\{[^}]*height: 100vh;\s*height: 100lvh;/);
  assert.match(galleryCss, /body\[data-gallery-viewer-open="true"\] \.experience-shell\.gallery-shell,[\s\S]*?body\[data-gallery-viewer-open="true"\] \.gallery-embed,[\s\S]*?body\[data-gallery-viewer-open="true"\] \.gallery-embed__frame\s*\{\s*height: 100vh;\s*height: 100svh;/);
  assert.doesNotMatch(galleryCss, /height: 100%;|100dvh|visualViewport|--gallery-visual|--gallery-controls-reserve/);
  assert.doesNotMatch(viewport, /visualViewport|innerHeight|screenHeight|style\.setProperty/);
  assert.doesNotMatch(button, /viewport-fit=cover/);
  const galleryPage = await read("app/gallery/page.tsx");
  assert.match(galleryPage, /viewportFit:\\s*"cover"/);
  assert.match(galleryPage, /export const viewport: Viewport/);
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

test("embedded viewport cover is applied only for an authenticated blog parent", async () => {
  const { default: vm } = await import("node:vm");
  const source = await read("public/afilmory-embed-bridge.js");
  const createEnvironment = (referer) => {
    const attrs = new Map([["content", "width=device-width, initial-scale=1"]]);
    const meta = { getAttribute: (k) => attrs.get(k), setAttribute: (k, v) => attrs.set(k, v) };
    const messages = [];
    const win = {
      parent: { postMessage: (data, origin) => messages.push({ data, origin }) },
      location: { pathname: "/" },
      history: { pushState() {}, replaceState() {} },
      addEventListener() {},
      setInterval() { return 1; },
      clearInterval() {},
    };
    const doc = {
      referrer: referer,
      visibilityState: "visible",
      querySelector: (selector) => selector === 'meta[name="viewport"]' ? meta : null,
    };
    const context = { window: win, document: doc, URL, Set, Number, queueMicrotask, console };
    vm.runInNewContext(source, context);
    return { meta, messages, attrs, win };
  };
  const embedded = createEnvironment("https://www.ready-jump.top/gallery");
  assert.match(embedded.attrs.get("content"), /viewport-fit=cover/);
  assert.equal((embedded.attrs.get("content").match(/viewport-fit/g) || []).length, 1);
  const untrusted = createEnvironment("https://other.example/gallery");
  assert.doesNotMatch(untrusted.attrs.get("content"), /viewport-fit/);
});

test("only iOS QQ in-app gallery shifts its floating controls closer to the bottom", async () => {
  const qq = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 QQ/9.1.75.604 Core/WKWebView";
  const qqBrowser = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 MQQBrowser/16.1 Mobile Safari/604.1";
  const safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1";
  const androidQQ = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36 QQ/9.1.75.604";
  assert.equal(isIosQQInAppBrowser(qq), true);
  assert.equal(isIosQQInAppBrowser(safari), false);
  assert.equal(isIosQQInAppBrowser(qqBrowser), false);
  assert.equal(isIosQQInAppBrowser(androidQQ), false);

  const css = await read("app/globals.css");
  const galleryViewport = await read("app/components/GalleryViewport.tsx");
  assert.match(css, /html\[data-gallery-active="true"\]\[data-gallery-ios-qq="true"\] body \.liquid-navigation,[\s\S]*?html\[data-gallery-active="true"\]\[data-gallery-ios-qq="true"\] body \.gallery-open-button\s*\{\s*bottom: max\(12px, calc\(env\(safe-area-inset-bottom, 0px\) - 14px\)\);/);
  assert.match(galleryViewport, /isIosQQInAppBrowser\(navigator.userAgent\)/);
  assert.match(galleryViewport, /delete root.dataset.galleryIosQq;/);
});
