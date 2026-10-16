import assert from "node:assert/strict";
import test from "node:test";
import { galleryDetailsFromExif } from "../app/lib/gallery-details.ts";

test("extracts source EXIF fields and upload metadata without inventing missing values", () => {
  const size = 9346046;
  const details = galleryDetailsFromExif({
    Artist: "  Photographer  ", ColorSpace: 1, OffsetTimeOriginal: "+08:00",
    FocalLengthIn35mmFormat: 24, ExposureCompensation: 0, WhiteBalance: 0,
  }, size, "image/jpeg", { width: 6000, height: 4000 });
  assert.equal(details.format, "JPG");
  assert.equal(details.fileSize, 9346046);
  assert.equal(details.width, 6000);
  assert.equal(details.height, 4000);
  assert.equal(details.artist, "Photographer");
  assert.equal(details.colorSpace, "sRGB");
  assert.equal(details.timeZone, "+08:00");
  assert.equal(details.focalLength35mm, "24 mm");
  assert.equal(details.exposureBias, "0 EV");
  assert.equal(details.whiteBalance, "自动");
  assert.equal(details.software, null);
  assert.equal(galleryDetailsFromExif({}, null, null).width, null);
});
