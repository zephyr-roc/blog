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
