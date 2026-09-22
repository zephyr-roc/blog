import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import exifr from "exifr";
import { chromium } from "playwright-core";
import sharpModule from "sharp";
import type { GalleryImage, GalleryManifest, GalleryMetadata } from "../gallery/gallery-types";
import {
  GALLERY_MANIFEST_VERSION,
  galleryManifestPath,
  galleryThumbnailDirectory,
} from "./gallery-runtime";

const STREAM_PATH = "/ugreen/v5/photo/share/external/stream";
const TARGET_WIDTHS = [480, 960];
const DEFAULT_SYNC_INTERVAL_MS = 30 * 60 * 1000;
const RETRY_INTERVAL_MS = 60 * 1000;
const CONCURRENCY = 3;

type RemotePhoto = {
  id: string;
  fileType: string;
  index: number;
  name: string;
  previewUrl: string;
  originalUrl: string;
  originalSizeType: string;
};

type ExifRecord = Record<string, unknown>;

type SharpMetadata = {
  width?: number;
  height?: number;
  orientation?: number;
  format?: string;
  pages?: number;
};

type SharpPipeline = {
  metadata(): Promise<SharpMetadata>;
  rotate(): SharpPipeline;
  resize(options: { width: number; withoutEnlargement: boolean }): SharpPipeline;
  webp(options: Record<string, number | boolean>): SharpPipeline;
  toFile(filePath: string): Promise<unknown>;
  toBuffer(): Promise<Buffer>;
};

let started = false;
let syncPromise: Promise<void> | null = null;
let nextSyncTimer: NodeJS.Timeout | null = null;

const sharp = sharpModule as unknown as (
  input?: Buffer,
  options?: { animated?: boolean; limitInputPixels?: number | boolean; page?: number },
) => SharpPipeline;

function configuration() {
  const sourceUrl = process.env.GALLERY_NAS_URL;
  const password = process.env.GALLERY_NAS_PASSWORD;
  if (!sourceUrl || !password) throw new Error("Gallery NAS credentials are not configured.");
  return { sourceUrl, password, origin: new URL(sourceUrl).origin };
}

function safeName(value: string) {
  return value
    .normalize("NFKD")
    // Keep persisted filenames portable across Alpine/musl and host volumes.
    // Human-readable Unicode remains in the manifest title, not the disk path.
    .replace(/[^a-zA-Z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 92) || "photo";
}

function titleFromName(value: string) {
  return path.parse(value).name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

function orientedDimensions(metadata: SharpMetadata) {
  const swapsAxes = Boolean(metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8);
  return {
    width: swapsAxes ? metadata.height : metadata.width,
    height: swapsAxes ? metadata.width : metadata.height,
  };
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function capturedAt(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function cameraName(make: unknown, model: unknown) {
  const makeText = textValue(make);
  const modelText = textValue(model);
  if (!makeText) return modelText;
  if (!modelText) return makeText;
  return modelText.toLowerCase().startsWith(makeText.toLowerCase())
    ? modelText
    : `${makeText} ${modelText}`;
}

function shutterSpeed(value: unknown) {
  const seconds = numberValue(value);
  if (!seconds || seconds <= 0) return null;
  if (seconds >= 1) return `${Number(seconds.toFixed(2))} s`;
  return `1/${Math.max(1, Math.round(1 / seconds))} s`;
}

function exifMetadata(exif: ExifRecord, format: string): GalleryMetadata {
  const focalLength = numberValue(exif.FocalLength);
  const aperture = numberValue(exif.FNumber ?? exif.ApertureValue);
  const iso = numberValue(exif.ISO ?? exif.ISOSpeedRatings ?? exif.PhotographicSensitivity);
  return {
    capturedAt: capturedAt(exif.DateTimeOriginal ?? exif.CreateDate ?? exif.ModifyDate),
    camera: cameraName(exif.Make, exif.Model),
    lens: textValue(exif.LensModel ?? exif.Lens),
    focalLength: focalLength ? `${Number(focalLength.toFixed(1))} mm` : null,
    aperture: aperture ? `ƒ/${Number(aperture.toFixed(1))}` : null,
    shutterSpeed: shutterSpeed(exif.ExposureTime),
    iso: iso ? `ISO ${Math.round(iso)}` : null,
    format: format.toUpperCase().replace("JPEG", "JPG"),
  };
}

async function parseExif(buffer: Buffer): Promise<ExifRecord> {
  try {
    return await exifr.parse(buffer, {
      pick: [
        "DateTimeOriginal", "CreateDate", "ModifyDate", "Make", "Model", "LensModel",
        "Lens", "FocalLength", "FNumber", "ApertureValue", "ExposureTime", "ISO",
        "ISOSpeedRatings", "PhotographicSensitivity",
      ],
      gps: false,
      xmp: false,
      iptc: false,
      icc: false,
    }) || {};
  } catch {
    return {};
  }
}

async function fetchPrefix(url: string, referer: string, limit = 2 * 1024 * 1024) {
  const response = await fetch(url, {
    headers: { Range: `bytes=0-${limit - 1}`, referer },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok || !response.body) return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - total;
      const chunk = Buffer.from(value.subarray(0, remaining));
      chunks.push(chunk);
      total += chunk.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
}

async function mapWithConcurrency<T>(items: T[], worker: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function readExistingManifest(): Promise<GalleryManifest | null> {
  try {
    const manifest = JSON.parse(await readFile(galleryManifestPath(), "utf8")) as GalleryManifest;
    return manifest.version === GALLERY_MANIFEST_VERSION ? manifest : null;
  } catch {
    return null;
  }
}

async function discoverPhotos(): Promise<{ photos: RemotePhoto[]; sourceUrl: string }> {
  const { sourceUrl, password, origin } = configuration();
  const browser = await chromium.launch({
    executablePath: process.env.GALLERY_CHROME_PATH || "/usr/bin/chromium-browser",
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });

  try {
    const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (new URL(page.url()).origin !== origin) throw new Error("Unexpected NAS redirect origin.");

    const passwordField = page.locator('input[type="password"]');
    await passwordField.waitFor({ state: "visible", timeout: 30_000 });
    await passwordField.fill(password);
    await passwordField.press("Enter");
    await page.locator(".photo-wall-item").first().waitFor({ state: "attached", timeout: 45_000 });

    const records = new Map<string, RemotePhoto>();
    const scrollContainer = page.locator(".share-container");
    await scrollContainer.evaluate((element) => { element.scrollTop = 0; });

    for (let step = 0; step < 48; step += 1) {
      const visibleRecords = await page.locator(".photo-wall-item").evaluateAll((items) => items.map((item) => {
        const image = item.querySelector("img.photo-img");
        return {
          name: item.getAttribute("name") || "photo",
          index: Number(item.getAttribute("img-index") || 0),
          source: image?.getAttribute("data-src") || image?.getAttribute("src") || "",
        };
      }));

      for (const record of visibleRecords) {
        if (!record.source || record.source.startsWith("data:")) continue;
        const streamUrl = new URL(record.source, sourceUrl);
        if (streamUrl.origin !== origin || streamUrl.pathname !== STREAM_PATH) continue;
        const id = streamUrl.searchParams.get("id");
        if (!id) continue;
        const fileType = streamUrl.searchParams.get("file_type") || "0";
        const extension = path.extname(record.name).toLowerCase();
        const browserNative = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".apng", ".avif"]);
        const originalSizeType = fileType === "3" || browserNative.has(extension) ? "0" : "3";
        const previewUrl = new URL(streamUrl);
        previewUrl.searchParams.set("size_type", fileType === "3" ? "0" : "3");
        const originalUrl = new URL(streamUrl);
        originalUrl.searchParams.set("size_type", originalSizeType);
        records.set(id, {
          id,
          fileType,
          index: record.index,
          name: record.name,
          previewUrl: previewUrl.toString(),
          originalUrl: originalUrl.toString(),
          originalSizeType,
        });
      }

      const position = await scrollContainer.evaluate((element) => {
        const previousTop = element.scrollTop;
        element.scrollTop = Math.min(
          element.scrollHeight - element.clientHeight,
          element.scrollTop + Math.max(560, Math.floor(element.clientHeight * .78)),
        );
        return { previousTop, top: element.scrollTop, bottom: element.scrollHeight - element.clientHeight };
      });
      if (position.top >= position.bottom && position.top === position.previousTop) break;
      await page.waitForTimeout(260);
    }

    const photos = [...records.values()].sort((left, right) => left.index - right.index);
    if (photos.length === 0) throw new Error("No photos were discovered after NAS authentication.");
    return { photos, sourceUrl };
  } finally {
    await browser.close();
  }
}

async function buildGalleryImage(photo: RemotePhoto, sourceUrl: string): Promise<GalleryImage> {
  const response = await fetch(photo.previewUrl, {
    headers: { accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8", referer: sourceUrl },
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`Photo ${photo.id} returned HTTP ${response.status}.`);
  const input = Buffer.from(await response.arrayBuffer());
  const metadata = await sharp(input, { animated: true, limitInputPixels: false }).metadata();
  const dimensions = orientedDimensions(metadata);
  if (!dimensions.width || !dimensions.height || !metadata.format) {
    throw new Error(`Photo ${photo.id} did not return a supported image.`);
  }

  const prefix = await fetchPrefix(photo.originalUrl, sourceUrl);
  const originalExif = prefix.length ? await parseExif(prefix) : {};
  const exif = Object.keys(originalExif).length ? originalExif : await parseExif(input);
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 12);
  const stem = safeName(path.parse(photo.name).name).toLowerCase();
  const animated = (metadata.pages ?? 1) > 1;
  const widths = [...new Set([
    ...TARGET_WIDTHS.filter((width) => width < dimensions.width!),
    Math.min(dimensions.width, TARGET_WIDTHS.at(-1)!),
  ])].sort((left, right) => left - right);
  const sources = [];

  for (const width of widths) {
    const fileName = `${safeName(photo.id).toLowerCase()}-${stem}-${hash}-${width}w.webp`;
    await sharp(input, { page: 0, limitInputPixels: false })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82, effort: 5, smartSubsample: true })
      .toFile(path.join(galleryThumbnailDirectory(), fileName));
    sources.push({
      src: `/api/gallery/thumbnail?file=${encodeURIComponent(fileName)}`,
      width,
      type: "image/webp" as const,
    });
  }

  const placeholder = await sharp(input, { page: 0, limitInputPixels: false })
    .rotate()
    .resize({ width: 32, withoutEnlargement: true })
    .webp({ quality: 36, effort: 3 })
    .toBuffer();
  const title = titleFromName(photo.name);
  return {
    id: `${safeName(photo.id).toLowerCase()}-${hash}`,
    remoteId: photo.id,
    sourceIndex: photo.index,
    title,
    alt: title,
    width: dimensions.width,
    height: dimensions.height,
    animated,
    poster: `data:image/webp;base64,${placeholder.toString("base64")}`,
    original: `/api/gallery/image?id=${encodeURIComponent(photo.id)}&fileType=${encodeURIComponent(photo.fileType)}&sizeType=${photo.originalSizeType}`,
    sources,
    metadata: exifMetadata(exif, metadata.format),
  };
}

function sortByCapturedTime(images: GalleryImage[]) {
  return images.sort((left, right) => {
    const leftTime = left.metadata.capturedAt ? Date.parse(left.metadata.capturedAt) : Number.NaN;
    const rightTime = right.metadata.capturedAt ? Date.parse(right.metadata.capturedAt) : Number.NaN;
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    if (Number.isFinite(leftTime)) return -1;
    if (Number.isFinite(rightTime)) return 1;
    return left.sourceIndex - right.sourceIndex;
  });
}

async function removeUnusedThumbnails(images: GalleryImage[]) {
  const referenced = new Set(images.flatMap((image) => image.sources.map((source) => {
    return new URL(source.src, "http://gallery.local").searchParams.get("file") || "";
  })));
  const files = await readdir(galleryThumbnailDirectory()).catch(() => []);
  await Promise.all(files.filter((file) => !referenced.has(file)).map((file) => {
    return rm(path.join(galleryThumbnailDirectory(), file), { force: true });
  }));
}

function thumbnailFileNames(image: GalleryImage) {
  return image.sources.map((source) => {
    return new URL(source.src, "http://gallery.local").searchParams.get("file") || "";
  });
}

export async function syncGalleryOnce() {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    await mkdir(galleryThumbnailDirectory(), { recursive: true });
    const existing = await readExistingManifest();
    const existingByRemoteId = new Map((existing?.images || []).map((image) => [image.remoteId, image]));
    const availableThumbnails = new Set(
      await readdir(galleryThumbnailDirectory()).catch(() => []),
    );
    const { photos, sourceUrl } = await discoverPhotos();
    const nextImages = new Array<GalleryImage>(photos.length);
    const missing: Array<{ photo: RemotePhoto; index: number }> = [];

    photos.forEach((photo, index) => {
      const previous = existingByRemoteId.get(photo.id);
      const thumbnailsExist = previous && thumbnailFileNames(previous)
        .every((fileName) => fileName && availableThumbnails.has(fileName));
      if (previous && thumbnailsExist) {
        nextImages[index] = {
          ...previous,
          sourceIndex: photo.index,
          original: `/api/gallery/image?id=${encodeURIComponent(photo.id)}&fileType=${encodeURIComponent(photo.fileType)}&sizeType=${photo.originalSizeType}`,
        };
      } else {
        missing.push({ photo, index });
      }
    });

    await mapWithConcurrency(missing, async ({ photo, index }) => {
      nextImages[index] = await buildGalleryImage(photo, sourceUrl);
    });

    const images = sortByCapturedTime(nextImages.filter(Boolean));
    const manifest: GalleryManifest = {
      version: GALLERY_MANIFEST_VERSION,
      syncedAt: new Date().toISOString(),
      images,
    };
    const manifestPath = galleryManifestPath();
    const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(manifest)}\n`);
    await rename(temporaryPath, manifestPath);
    await removeUnusedThumbnails(images);
    console.log(`[gallery] Synced ${images.length} photos; processed ${missing.length} new item(s).`);
  })();

  try {
    await syncPromise;
  } finally {
    syncPromise = null;
  }
}

function scheduleNextSync(delay: number) {
  if (nextSyncTimer) clearTimeout(nextSyncTimer);
  nextSyncTimer = setTimeout(() => {
    void syncGalleryOnce()
      .then(() => scheduleNextSync(Number(process.env.GALLERY_SYNC_INTERVAL_MS) || DEFAULT_SYNC_INTERVAL_MS))
      .catch((error: unknown) => {
        console.error("[gallery] Runtime synchronization failed.", error);
        scheduleNextSync(RETRY_INTERVAL_MS);
      });
  }, delay);
  nextSyncTimer.unref();
}

export function ensureGallerySyncStarted() {
  if (started) return;
  if (!process.env.GALLERY_NAS_URL || !process.env.GALLERY_NAS_PASSWORD) return;
  started = true;
  scheduleNextSync(0);
}
