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
  assert.match(html, /保持好奇/);
  assert.match(html, /TINKERING · LAB/);
  assert.match(html, /href="\/tinkering\/github-actions-deploy"/);
  assert.doesNotMatch(html, /COLLECTION · 合集/);

  const postResponse = await render("/tinkering/github-actions-deploy");
  assert.equal(postResponse.status, 200);
});

test("renders the deep radar as a top-level daily archive", async () => {
  const response = await render("/radar");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /深潜雷达/);
  assert.match(html, /DEEP SIGNAL \/ SOURCE \/ PROOF/);
  assert.match(html, /href="\/radar\/2026-08-25"/);
  assert.match(html, /href="\/radar\/feed\.xml"/);
  assert.doesNotMatch(html, /COLLECTION · 合集/);

  const postResponse = await render("/radar/2026-08-25");
  assert.equal(postResponse.status, 200);

  const postHtml = await postResponse.text();
  assert.match(postHtml, /Simplifying Weak Reference Processing in ZGC/);
  assert.match(postHtml, /How to speed up the Rust compiler in July 2026/);
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

test("keeps the card markup on the server and hydrates one motion controller", async () => {
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
  assert.match(layout, /<GlassMotionController \/>/);
});
