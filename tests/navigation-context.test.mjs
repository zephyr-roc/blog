import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { GALLERY_ORIGIN, createNavigationScrollTracker, isArticlePath, verticalNavigationAction, readGalleryViewerMessage } from "../app/lib/navigation-context.mjs";

test("only article routes enable vertical navigation gestures", () => {
  for (const path of ["/collections/kotlin/intro", "/radar/2026-10-23", "/tinkering/setup/"]) assert.equal(isArticlePath(path), true);
  for (const path of ["/", "/gallery", "/collections/kotlin", "/radar", "/about"]) assert.equal(isArticlePath(path), false);
});

test("up/down gestures collapse/expand without treating horizontal drags or taps as vertical gestures", () => {
  assert.equal(verticalNavigationAction(2, -48), "collapse");
  assert.equal(verticalNavigationAction(-4, 48), "expand");
  assert.equal(verticalNavigationAction(60, -20), null);
  assert.equal(verticalNavigationAction(2, 10), null);
});

test("article scrolling collapses downward and expands upward after deliberate movement", () => {
  const track = createNavigationScrollTracker(100, 1000);
  assert.equal(track(115, 1000), null);
  assert.equal(track(132, 1000), "collapse");
  assert.equal(track(128, 1000), null);
  assert.equal(track(112, 1000), "expand");
  // A direction change starts a new distance; it cannot accumulate jitter.
  assert.equal(track(120, 1000), null);
  assert.equal(track(115, 1000), null);
  assert.equal(track(130, 1000), null);
  assert.equal(track(147, 1000), "collapse");
});

test("Safari overscroll cannot toggle navigation; returning to the top restores labels", () => {
  const track = createNavigationScrollTracker(960, 1000);
  assert.equal(track(1000, 1000), "collapse");
  assert.equal(track(1080, 1000), null);
  assert.equal(track(1000, 1000), null);
  assert.equal(track(980, 1000), "expand");
  assert.equal(track(48, 1000), "expand");
  assert.equal(track(-80, 1000), "expand");
  assert.equal(track(0, 1000), "expand");
  assert.equal(track(25, 1000), "expand");
});

test("gallery state accepts only a boolean from the expected frame and origin", () => {
  const frame = {};
  const event = { source: frame, origin: GALLERY_ORIGIN, data: { type: "afilmory:viewer-state", version: 1, open: true } };
  assert.equal(readGalleryViewerMessage(event, frame), true);
  assert.equal(readGalleryViewerMessage({ ...event, data: { ...event.data, open: false } }, frame), false);
  for (const change of [{ origin: "https://example.com" }, { source: {} }, { data: { ...event.data, open: "true" } }, { data: { ...event.data, version: 2 } }]) {
    assert.equal(readGalleryViewerMessage({ ...event, ...change }, frame), null);
  }
});

test("Afilmory bridge tracks opening, switching and closing photos including browser back", async () => {
  const script = await readFile(new URL("../public/afilmory-embed-bridge.js", import.meta.url), "utf8");
  const messages = [];
  const handlers = {};
  const parent = { postMessage: (data, origin) => messages.push({ data, origin }) };
  const window = { parent, location: { pathname: "/" }, addEventListener: (type, fn) => { handlers[type] = fn; } };
  window.history = Object.fromEntries(["pushState", "replaceState"].map(method => [method, function (_state, _unused, url) { window.location.pathname = new URL(url, GALLERY_ORIGIN).pathname; }]));
  vm.runInNewContext(script, { window, document: { referrer: "https://www.ready-jump.top/gallery" }, URL });
  assert.equal(messages.at(-1).data.open, false);
  window.history.pushState(null, "", "/photos/photo-1");
  assert.equal(messages.at(-1).data.open, true);
  window.history.replaceState(null, "", "/photos/photo-2");
  assert.equal(messages.at(-1).data.open, true);
  window.location.pathname = "/";
  handlers.popstate();
  assert.equal(messages.at(-1).data.open, false);
  assert.ok(messages.every(message => message.origin === "https://www.ready-jump.top"));
  const before = messages.length;
  handlers.message({ source: parent, origin: "https://evil.example", data: { type: "blog:request-viewer-state", version: 1 } });
  assert.equal(messages.length, before);
});

test("bridge can handshake without a referrer and synchronize a directly opened photo", async () => {
  const script = await readFile(new URL("../public/afilmory-embed-bridge.js", import.meta.url), "utf8");
  const messages = [];
  const handlers = {};
  const parent = { postMessage: (data, origin) => messages.push({ data, origin }) };
  const window = { parent, location: { pathname: "/photos/direct" }, history: { pushState() {}, replaceState() {} }, addEventListener: (type, fn) => { handlers[type] = fn; } };
  vm.runInNewContext(script, { window, document: { referrer: "" }, URL });
  assert.equal(messages.length, 0);
  handlers.message({ source: parent, origin: "https://ready-jump.top", data: { type: "blog:request-viewer-state", version: 1 } });
  assert.equal(messages.at(-1).data.open, true);
  assert.equal(messages.at(-1).origin, "https://ready-jump.top");
});
