import assert from "node:assert/strict";
import test from "node:test";
import { galleryThumbnailETag } from "../app/lib/gallery-runtime.ts";

test("CJK gallery thumbnail names produce ByteString-safe ETag headers", () => {
  const fileName = "2594-dsc-3404-已增强-降噪-728d508d8a4e-480w.webp";
  const etag = galleryThumbnailETag(fileName);
  assert.match(etag, /^"[0-9a-f]{64}"$/);
  assert.equal(new Headers({ ETag: etag }).get("etag"), etag);
  assert.equal(galleryThumbnailETag("photo-480w.webp"), '"photo-480w"');
});
