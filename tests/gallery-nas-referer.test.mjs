import assert from "node:assert/strict";
import test from "node:test";
import { galleryNasReferer } from "../app/lib/gallery-nas-referer.ts";

test("NAS share URLs with CJK paths can be sent in a Referer header", () => {
  const source = "https://nas.example.test/share/中文相册?name=照片";
  assert.throws(() => new Headers({ referer: source }), TypeError);
  const referer = galleryNasReferer(source);
  assert.equal(referer, "https://nas.example.test/share/%E4%B8%AD%E6%96%87%E7%9B%B8%E5%86%8C?name=%E7%85%A7%E7%89%87");
  assert.equal(new Headers({ referer }).get("referer"), referer);
});
