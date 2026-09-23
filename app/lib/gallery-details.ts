import type { GalleryDetails } from "../gallery/gallery-types";

function readableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
}

export function galleryDetailsFromExif(
  exif: Record<string, unknown>,
  fileSize: number | null,
  contentType: string | null,
  originalDimensions: { width: number; height: number } | null = null,
): GalleryDetails {
  const color = exif.ColorSpace;
  const colorSpace = color === 1 || color === "sRGB" ? "sRGB" : readableText(color);
  const focalLength = numberValue(exif.FocalLengthIn35mmFormat);
  const exposureBias = numberValue(exif.ExposureCompensation ?? exif.ExposureBiasValue);
  const whiteBalance = exif.WhiteBalance === 0 ? "自动"
    : exif.WhiteBalance === 1 ? "手动" : readableText(exif.WhiteBalance);

  return {
    width: originalDimensions?.width ?? numberValue(exif.ExifImageWidth ?? exif.ImageWidth),
    height: originalDimensions?.height ?? numberValue(exif.ExifImageHeight ?? exif.ImageHeight),
    fileSize,
    format: contentType?.split(";")[0].split("/")[1]?.toUpperCase().replace("JPEG", "JPG") || null,
    colorSpace,
    artist: readableText(exif.Artist),
    copyright: readableText(exif.Copyright),
    software: readableText(exif.Software),
    timeZone: readableText(exif.OffsetTimeOriginal ?? exif.OffsetTime),
    focalLength35mm: focalLength && focalLength > 0 ? `${Math.round(focalLength)} mm` : null,
    exposureBias: exposureBias === null ? null : `${exposureBias > 0 ? "+" : ""}${Number(exposureBias.toFixed(2))} EV`,
    whiteBalance,
  };
}

export function galleryJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset++] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    const segmentLength = bytes[offset] * 256 + bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (segmentLength < 7) return null;
      const height = bytes[offset + 3] * 256 + bytes[offset + 4];
      const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      return width && height ? { width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
}

export function galleryOriginalSize(headers: Headers, status: number): number | null {
  const rangeSize = Number(headers.get("content-range")?.match(/\/(\d+)$/)?.[1]);
  if (Number.isSafeInteger(rangeSize) && rangeSize > 0) return rangeSize;
  const length = Number(headers.get("content-length"));
  return status === 200 && Number.isSafeInteger(length) && length > 0 ? length : null;
}
