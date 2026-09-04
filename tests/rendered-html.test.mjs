import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(new URL(pathname, "http://localhost"), {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the collection cards before client hydration", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>積雨雲的空間站<\/title>/i);
  assert.match(html, /记录想法，/);
  assert.match(html, /分享所学/);
  assert.match(html, /data-motion-card="true"/);
  assert.match(html, /href="\/collections\/kotlin"/);
});

test("embeds a readable fallback when external CSS and JavaScript fail", async () => {
  const response = await render();
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<style data-critical-fallback="true">\s*@layer fallback/);
  assert.match(html, /\.glass-card__base[\s\S]*?display: none/);
  assert.match(html, /\.liquid-navigation__surface \{ display: flex/);
  assert.match(html, /<img[^>]+width="64"/);

  for (const href of ["/", "/radar", "/tinkering", "/about"]) {
    assert.match(html, new RegExp(`href="${href === "/" ? "\\/" : href}"`));
  }
});

test("renders working collection and post destinations", async () => {
  const collectionResponse = await render("/collections/kotlin");
  assert.equal(collectionResponse.status, 200);

  const collectionHtml = await collectionResponse.text();
  assert.match(collectionHtml, /href="\/collections\/kotlin\/getting-started"/);
  assert.match(collectionHtml, /CHAPTER 01/);
  assert.match(collectionHtml, /基础入门/);
  assert.match(collectionHtml, /并发进阶/);

  const postResponse = await render("/collections/kotlin/getting-started");
  assert.equal(postResponse.status, 200);

  const postHtml = await postResponse.text();
  assert.match(postHtml, /Kotlin/);
});

test("renders tinkering as a top-level page", async () => {
  const response = await render("/tinkering");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /折腾日志/);
  assert.match(html, /TINKERING · LAB/);
  assert.match(html, /class="site-header"/);
  assert.match(html, /id="tinkering-search"/);
  assert.match(html, /href="\/tinkering\/github-actions-deploy"/);
  assert.doesNotMatch(html, /浏览全部记录/);
  assert.doesNotMatch(html, /COLLECTION · 合集/);

  const legacyResponse = await render("/tinkering/notes");
  assert.equal(legacyResponse.status, 308);
  assert.match(legacyResponse.headers.get("location") ?? "", /\/tinkering$/);

  const postResponse = await render("/tinkering/github-actions-deploy");
  assert.equal(postResponse.status, 200);
});

test("renders the deep radar as a top-level daily archive", async () => {
  const response = await render("/radar");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /深潜雷达/);
  assert.match(html, /DEEP SIGNAL \/ SOURCE \/ PROOF/);
  assert.match(html, /RADAR · DAILY/);
  assert.match(html, /class="site-header"/);
  assert.doesNotMatch(html, /返回主页/);
  assert.match(html, /href="\/radar\/2026-08-25"/);
  assert.match(html, /href="\/radar\/feed\.xml"/);
  assert.doesNotMatch(html, /COLLECTION · 合集/);

  const postResponse = await render("/radar/2026-08-25");
  assert.equal(postResponse.status, 200);

  const postHtml = await postResponse.text();
  assert.match(postHtml, /Enabling the next-generation trait solver on nightly/);
});

test("publishes an RSS feed for deep radar subscribers", async () => {
  const response = await render("/radar/feed.xml");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/rss\+xml\b/i);

  const xml = await response.text();
  assert.match(xml, /<title>深潜雷达 — 积雨云的空间站<\/title>/);
  assert.match(xml, /<link>https:\/\/www\.ready-jump\.top\/radar\/2026-08-25<\/link>/);
});

test("server-renders the about content before client hydration", async () => {
  const response = await render("/about");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /喜欢折腾代码/);
  assert.match(html, /Code × Motion/);
  assert.match(html, /CREATIVE CODE/);
  assert.match(html, /data-motion-card="true"/);
});

test("keeps the about title on exactly two smaller lines", async () => {
  const [about, css] = await Promise.all([
    readFile(new URL("app/about/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(about, /你好，\s*<br \/>\s*我是积雨云。/);
  assert.match(css, /\.about__intro h1\s*\{[^}]*font-size:\s*clamp\(42px,\s*4\.8vw,\s*72px\);[^}]*white-space:\s*nowrap;/);
  assert.match(css, /@media \(max-width:\s*640px\)[\s\S]*?\.about__intro h1\s*\{[^}]*font-size:\s*clamp\(36px,\s*10vw,\s*50px\);/);
});

test("keeps mobile device tilt exclusive to the about page", async () => {
  const [home, about, glassCard, controller, layout] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/about/page.tsx", root), "utf8"),
    readFile(new URL("app/components/GlassCard.tsx", root), "utf8"),
    readFile(new URL("app/components/GlassMotionController.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
  ]);

  assert.doesNotMatch(home, /["']use client["']/);
  assert.doesNotMatch(about, /["']use client["']/);
  assert.doesNotMatch(glassCard, /["']use client["']/);
  assert.match(controller, /^"use client";/);
  assert.match(controller, /document\.querySelectorAll<HTMLElement>/);
  assert.match(controller, /cardsRef\.current\.forEach/);
  assert.match(controller, /pathname === "\/about"/);
  assert.doesNotMatch(controller, /applyGroupTilt|groupsRef|data-motion-group/);
  assert.doesNotMatch(home, /data-motion-group="true"/);
  assert.match(about, /<MotionTiltControl \/>/);
  assert.match(layout, /<GlassMotionController \/>/);
  assert.doesNotMatch(layout, /<MotionTiltControl \/>/);
});


test("bounds CDN freshness for content-derived routes", async () => {
  const routeFiles = [
    "app/page.tsx",
    "app/tinkering/page.tsx",
    "app/tinkering/[post]/page.tsx",
    "app/radar/page.tsx",
    "app/radar/[post]/page.tsx",
    "app/collections/[slug]/page.tsx",
    "app/collections/[slug]/[post]/page.tsx",
    "app/sitemap.ts",
    "app/radar/feed.xml/route.ts",
  ];

  const sources = await Promise.all(
    routeFiles.map((path) => readFile(new URL(path, root), "utf8")),
  );

  for (const [index, source] of sources.entries()) {
    assert.match(
      source,
      /export const revalidate = 60;/,
      `${routeFiles[index]} must not regress to an unbounded CDN lifetime`,
    );
  }

  assert.match(
    sources.at(-1),
    /max-age=0, s-maxage=60, stale-while-revalidate=60, must-revalidate/,
  );
});
