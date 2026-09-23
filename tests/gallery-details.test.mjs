import assert from "node:assert/strict";
import test from "node:test";
import { galleryDetailsFromExif, galleryOriginalSize } from "../app/lib/gallery-details.ts";

test("extracts source EXIF fields and original file size without inventing missing values", () => {
  const headers = new Headers({ "content-range": "bytes 0-2097151/9346046", "content-length": "2097152" });
  const size = galleryOriginalSize(headers, 206);
  assert.equal(size, 9346046);
  const details = galleryDetailsFromExif({
    Artist: "  Photographer  ", ColorSpace: 1, OffsetTimeOriginal: "+08:00",
    FocalLengthIn35mmFormat: 24, ExposureCompensation: 0, WhiteBalance: 0,
  }, size, "image/jpeg");
  assert.equal(details.format, "JPG");
  assert.equal(details.artist, "Photographer");
  assert.equal(details.colorSpace, "sRGB");
  assert.equal(details.timeZone, "+08:00");
  assert.equal(details.focalLength35mm, "24 mm");
  assert.equal(details.exposureBias, "0 EV");
  assert.equal(details.whiteBalance, "自动");
  assert.equal(details.software, null);
  assert.equal(galleryOriginalSize(new Headers({ "content-length": "512" }), 206), null);
});
