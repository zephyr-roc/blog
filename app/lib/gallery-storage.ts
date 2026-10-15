import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import exifr from "exifr";
import sharpModule from "sharp";
import type { GalleryDetails, GalleryImage, GalleryManifest, GalleryMetadata } from "../gallery/gallery-types";
import { galleryDetailsFromExif } from "./gallery-details";
import { GALLERY_MANIFEST_VERSION, galleryDataDirectory, galleryManifestPath, galleryOriginalDirectory, galleryThumbnailDirectory, readGalleryImages } from "./gallery-runtime";

type SharpMetadata = {
  format?: string; width?: number; height?: number; orientation?: number; pages?: number;
};
type SharpPipeline = {
  metadata(): Promise<SharpMetadata>;
  rotate(): SharpPipeline;
  resize(options: { width: number; withoutEnlargement: boolean }): SharpPipeline;
  webp(options: { quality: number; effort: number }): SharpPipeline;
  toBuffer(): Promise<Buffer>;
};
const sharp = sharpModule as (input: Buffer, options: { page: number; limitInputPixels: number }) => SharpPipeline;

const formats: Record<string, { extension: string; mime: string }> = {
  jpeg: { extension: "jpg", mime: "image/jpeg" },
  png: { extension: "png", mime: "image/png" },
  webp: { extension: "webp", mime: "image/webp" },
  gif: { extension: "gif", mime: "image/gif" },
  avif: { extension: "avif", mime: "image/avif" },
};
export const MAX_GALLERY_UPLOAD_BYTES = 40 * 1024 * 1024;
let writes: Promise<unknown> = Promise.resolve();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const next = writes.then(operation, operation);
  writes = next.catch(() => undefined);
  return next;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function exifNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function exposure(value: unknown) {
  const n = exifNumber(value);
  return n ? n >= 1 ? `${Number(n.toFixed(1))}s` : `1/${Math.round(1 / n)}s` : null;
}

function captureTime(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString();
  if (typeof value === "string") {
    const date = new Date(value.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3"));
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }
  return null;
}

function filename(value: string) {
  return path.basename(value).split("").filter((char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127).join("").slice(0, 180) || "photo";
}

async function saveManifest(images: GalleryImage[]) {
  const destination = galleryManifestPath();
  await mkdir(galleryDataDirectory(), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const manifest: GalleryManifest = { version: GALLERY_MANIFEST_VERSION, updatedAt: new Date().toISOString(), images };
  try {
    await writeFile(temporary, JSON.stringify(manifest));
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function paths(image: GalleryImage) {
  return [
    path.join(galleryOriginalDirectory(), path.basename(new URL(image.original, "http://gallery.local").pathname)),
    ...image.sources.map((source) => path.join(galleryThumbnailDirectory(), path.basename(new URL(source.src, "http://gallery.local").pathname))),
    path.join(galleryDataDirectory(), "details", `${image.id}.json`),
  ];
}

export async function addGalleryPhoto(input: Buffer, uploadedName: string, titleOverride?: string) {
  if (!input.length || input.length > MAX_GALLERY_UPLOAD_BYTES) throw new Error("照片大小须在 1B 至 40MB 之间。");
  const metadata = await sharp(input, { page: 0, limitInputPixels: 100_000_000 }).metadata();
  const format = metadata.format && formats[metadata.format];
  if (!format || !metadata.width || !metadata.height) throw new Error("仅支持 JPEG、PNG、WebP、GIF 和 AVIF 照片。");
  const id = randomUUID();
  const name = filename(uploadedName);
  const originalName = `${id}.${format.extension}`;
  const original = `/api/gallery/image?id=${id}`;
  const exif = await exifr.parse(input, { gps: false, xmp: false, iptc: false, icc: false }).catch(() => null) as Record<string, unknown> | null;
  const data = exif || {};
  const swapped = [5, 6, 7, 8].includes(metadata.orientation || 1);
  const width = swapped ? metadata.height : metadata.width;
  const height = swapped ? metadata.width : metadata.height;
  const date = captureTime(data.DateTimeOriginal ?? data.CreateDate ?? data.DateTime) || new Date().toISOString();
  const focal = exifNumber(data.FocalLength);
  const aperture = exifNumber(data.FNumber);
  const iso = exifNumber(data.ISO);
  const camera = [text(data.Make), text(data.Model)].filter(Boolean).join(" ") || null;
  const imageMetadata: GalleryMetadata = {
    capturedAt: date,
    camera,
    lens: text(data.LensModel),
    focalLength: focal ? `${Number(focal.toFixed(1))}mm` : null,
    aperture: aperture ? `f/${Number(aperture.toFixed(1))}` : null,
    shutterSpeed: exposure(data.ExposureTime),
    iso: iso ? `ISO${iso}` : null,
    format: format.extension.toUpperCase(),
  };
  const sources = [];
  const saved: string[] = [];
  await mkdir(galleryOriginalDirectory(), { recursive: true });
  await mkdir(galleryThumbnailDirectory(), { recursive: true });
  try {
    const originalPath = path.join(galleryOriginalDirectory(), originalName);
    await writeFile(originalPath, input, { flag: "wx" });
    saved.push(originalPath);
    for (const target of [480, 960]) {
      const thumbName = `${id}-${target}.webp`;
      const output = await sharp(input, { page: 0, limitInputPixels: 100_000_000 }).rotate()
        .resize({ width: target, withoutEnlargement: true }).webp({ quality: 82, effort: 5 }).toBuffer();
      const destination = path.join(galleryThumbnailDirectory(), thumbName);
      await writeFile(destination, output, { flag: "wx" });
      saved.push(destination);
      sources.push({ src: `/api/gallery/thumbnail?file=${thumbName}`, width: Math.min(width, target), type: "image/webp" as const });
    }
    const poster = sources[0].src;
    const image: GalleryImage = {
      id, title: titleOverride?.trim().slice(0, 120) || path.parse(name).name,
      filename: name, alt: titleOverride?.trim().slice(0, 120) || path.parse(name).name,
      width, height, animated: (metadata.pages || 1) > 1,
      poster, original, sources, metadata: imageMetadata,
    };
    const details: GalleryDetails = galleryDetailsFromExif(data, input.length, format.mime, { width, height });
    await serialized(async () => {
      const images = await readGalleryImages();
      await saveManifest([...images, image]);
    });
    await mkdir(path.join(galleryDataDirectory(), "details"), { recursive: true });
    await writeFile(path.join(galleryDataDirectory(), "details", `${id}.json`), JSON.stringify({ version: 3, details })).catch(() => undefined);
    return image;
  } catch (error) {
    await Promise.all(saved.map((file) => rm(file, { force: true }).catch(() => undefined)));
    throw error;
  }
}

export async function updateGalleryPhoto(id: string, updates: { title?: string; capturedAt?: string }) {
  return serialized(async () => {
    const images = await readGalleryImages();
    const image = images.find((item) => item.id === id);
    if (!image) return null;
    if (updates.title !== undefined) {
      const title = updates.title.trim().slice(0, 120);
      if (!title) throw new Error("标题不能为空。");
      image.title = title;
      image.alt = title;
    }
    if (updates.capturedAt !== undefined) {
      const time = new Date(updates.capturedAt);
      if (Number.isNaN(time.valueOf())) throw new Error("拍摄时间无效。");
      image.metadata.capturedAt = time.toISOString();
    }
    await saveManifest(images);
    return image;
  });
}

export async function deleteGalleryPhoto(id: string) {
  return serialized(async () => {
    const images = await readGalleryImages();
    const image = images.find((item) => item.id === id);
    if (!image) return false;
    await saveManifest(images.filter((item) => item.id !== id));
    await Promise.all(paths(image).map((file) => rm(file, { force: true }).catch(() => undefined)));
    return true;
  });
}

export function galleryOriginalName(image: GalleryImage) {
  const format = image.metadata.format.toLowerCase();
  if (!["jpg", "png", "webp", "gif", "avif"].includes(format)) throw new Error("Invalid image format.");
  return `${image.id}.${format}`;
}

export function galleryMime(image: GalleryImage) {
  const ext = path.extname(galleryOriginalName(image)).slice(1);
  return Object.values(formats).find((item) => item.extension === ext)?.mime || "application/octet-stream";
}
