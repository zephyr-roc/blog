import assert from "node:assert/strict";
import test from "node:test";
import { galleryDetailsFromExif, galleryJpegDimensions, galleryOriginalSize } from "../app/lib/gallery-details.ts";

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

test("reads original JPEG dimensions from a partial file header", () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xc0, 0, 7, 8, 0x0f, 0xa0, 0x17, 0x70]);
  const dimensions = galleryJpegDimensions(bytes);
  assert.deepEqual(dimensions, { width: 6000, height: 4000 });
  assert.equal(galleryDetailsFromExif({}, null, "image/jpeg", dimensions).width, 6000);
});
