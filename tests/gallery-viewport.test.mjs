import assert from "node:assert/strict";
import test from "node:test";
import { galleryPaintHeight } from "../app/lib/gallery-viewport.mjs";

const phone = {
  isPhone: true, standalone: false, scale: 1,
  width: 393, height: 738, screenWidth: 393, screenHeight: 852, safeTop: 59,
};

test("covers the area below Safari's reported viewport without counting the status area twice", () => {
  assert.equal(galleryPaintHeight(phone), 793);
  assert.equal(galleryPaintHeight({ ...phone, height: 810 }), 810);
});

test("recalculates for a full-width landscape window", () => {
  assert.equal(galleryPaintHeight({ ...phone, width: 852, screenWidth: 852, height: 320, screenHeight: 393, safeTop: 0 }), 393);
});

test("does not impose physical screen height on desktop, split windows, standalone or zoomed pages", () => {
  for (const patch of [{ isPhone: false }, { width: 320 }, { standalone: true }, { scale: 2 }]) {
    assert.equal(galleryPaintHeight({ ...phone, ...patch }), null);
  }
});

test("ignores unusable screen and safe-area measurements", () => {
  for (const patch of [{ screenHeight: 0 }, { width: NaN }, { scale: NaN }, { safeTop: -1 }, { safeTop: 852 }]) {
    assert.equal(galleryPaintHeight({ ...phone, ...patch }), null);
  }
});
