import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import exifr from "exifr";
import type { GalleryDetails, GalleryImage } from "../../../gallery/gallery-types";
import { galleryDetailsFromExif, galleryJpegDimensions, galleryOriginalSize } from "../../../lib/gallery-details";
import { fetchGalleryNasImage } from "../../../lib/gallery-nas-token";
import { galleryDataDirectory, readGalleryImages } from "../../../lib/gallery-runtime";

const pending = new Map<string, Promise<GalleryDetails>>();
const MAX_EXIF_BYTES = 2 * 1024 * 1024;

function detailsPath(image: GalleryImage) {
  const key = createHash("sha256").update(image.id).digest("hex");
  return path.join(galleryDataDirectory(), "details", `${key}.json`);
}

async function fetchOriginalPrefix(image: GalleryImage) {
  const original = new URL(image.original, "http://gallery.local");
  const fileType = original.searchParams.get("fileType") || "0";
  const sizeType = original.searchParams.get("sizeType") || "0";
  const { response } = await fetchGalleryNasImage(image.remoteId, fileType, sizeType, {
    range: `bytes=0-${MAX_EXIF_BYTES - 1}`,
    timeoutMs: 60_000,
  });
  if (!response.body) throw new Error("NAS EXIF has no image body.");
  const fileSize = galleryOriginalSize(response.headers, response.status);
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (total < MAX_EXIF_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value.subarray(0, MAX_EXIF_BYTES - total));
      chunks.push(chunk);
      total += chunk.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { bytes: Buffer.concat(chunks), fileSize, contentType: response.headers.get("content-type") };
}

async function loadDetails(image: GalleryImage): Promise<GalleryDetails> {
  const filePath = detailsPath(image);
  try {
    const cached = JSON.parse(await readFile(filePath, "utf8")) as { version: number; details: GalleryDetails };
    if (cached.version === 2 && cached.details) return cached.details;
  } catch {
    // Generate missing details when a photo is opened.
  }

  const { bytes, fileSize, contentType } = await fetchOriginalPrefix(image);
  const exif = await exifr.parse(bytes, {
    pick: [
      "Artist", "Copyright", "Software", "ColorSpace", "OffsetTimeOriginal", "OffsetTime",
      "FocalLengthIn35mmFormat", "ExposureCompensation", "ExposureBiasValue", "WhiteBalance",
    ],
    gps: false,
    xmp: false,
    iptc: false,
    icc: false,
  }).catch(() => null) as Record<string, unknown> | null;
  const details = galleryDetailsFromExif(exif || {}, fileSize, contentType, galleryJpegDimensions(bytes));
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(temporaryPath, JSON.stringify({ version: 2, details }));
    await rename(temporaryPath, filePath);
  } catch {
    // Metadata still displays if the data volume temporarily cannot be written.
  }
  return details;
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return new Response("Invalid photo.", { status: 400 });
  const image = (await readGalleryImages()).find((photo) => photo.remoteId === id);
  if (!image) return new Response("Photo not found.", { status: 404 });

  try {
    let task = pending.get(image.id);
    if (!task) {
      task = loadDetails(image);
      pending.set(image.id, task);
      void task.finally(() => pending.delete(image.id)).catch(() => undefined);
    }
    return Response.json(await task, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    console.error("[gallery] Unable to load photo details.");
    return new Response("Photo details are temporarily unavailable.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
