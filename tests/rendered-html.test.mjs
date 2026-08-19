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
});

test("server-renders the about content before client hydration", async () => {
  const response = await render("/about");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /让复杂的技术/);
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
