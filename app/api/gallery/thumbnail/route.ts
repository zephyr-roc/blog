import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { galleryNasStreamUrl, getGalleryNasToken } from "../../../lib/gallery-nas-token";
import {
  galleryThumbnailCacheName,
  galleryThumbnailDirectory,
  readGalleryImages,
} from "../../../lib/gallery-runtime";

// Generated thumbnail names retain CJK characters from the source photo name.
// Keep the allow-list narrow while accepting those legitimate filenames.
const validFileName = /^[a-z0-9\u4e00-\u9fff][a-z0-9\u4e00-\u9fff._-]{0,180}\.webp$/i;
const pending = new Map<string, Promise<Buffer>>();

function webpResponse(body: Buffer, fileName: string) {
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${path.parse(fileName).name}"`,
    },
  });
}

async function recoverThumbnail(fileName: string): Promise<Buffer> {
  const images = await readGalleryImages();
  const image = images.find((candidate) => candidate.sources.some((source) => {
    return new URL(source.src, "http://gallery.local").searchParams.get("file") === fileName;
  }));
  const source = image?.sources.find((candidate) => {
    return new URL(candidate.src, "http://gallery.local").searchParams.get("file") === fileName;
  });
  if (!image || !source?.width || !image.original) {
    throw new Error("Thumbnail is not present in the gallery manifest.");
  }

  const original = new URL(image.original, "http://gallery.local");
  const fileType = original.searchParams.get("fileType") || "0";
  const token = await getGalleryNasToken();
  const preview = galleryNasStreamUrl(
    image.remoteId,
    fileType,
    fileType === "3" ? "0" : "3",
    token,
  );
  const response = await fetch(preview, {
    headers: { referer: process.env.GALLERY_NAS_URL || preview.origin },
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`NAS preview returned HTTP ${response.status}.`);

  const input = Buffer.from(await response.arrayBuffer());
  const output = await sharp(input, { page: 0, limitInputPixels: false })
    .rotate()
    .resize({ width: source.width, withoutEnlargement: true })
    .webp({ quality: 82, effort: 5, smartSubsample: true })
    .toBuffer();

  // A filesystem failure must not turn a successfully recovered image into
  // another broken card. Retry caching on the next request in that case.
  await writeFile(path.join(galleryThumbnailDirectory(), galleryThumbnailCacheName(fileName)), output)
    .catch((error: unknown) => console.error("[gallery] Unable to cache recovered thumbnail.", error));
  return output;
}

export async function GET(request: Request) {
  const fileName = new URL(request.url).searchParams.get("file") || "";
  if (!validFileName.test(fileName)) {
    return new Response("Invalid gallery thumbnail.", { status: 400 });
  }

  const directory = galleryThumbnailDirectory();
  try {
    return webpResponse(await readFile(path.join(directory, galleryThumbnailCacheName(fileName))), fileName);
  } catch {
    // Before the switch to ASCII cache paths, some manifest entries used CJK
    // filenames. Honor those files if they really exist on disk.
    if (galleryThumbnailCacheName(fileName) !== fileName) {
      try {
        return webpResponse(await readFile(path.join(directory, fileName)), fileName);
      } catch {
        // Generate only images already listed in the manifest.
      }
    }
  }

  try {
    let recovery = pending.get(fileName);
    if (!recovery) {
      recovery = recoverThumbnail(fileName);
      pending.set(fileName, recovery);
      void recovery.finally(() => pending.delete(fileName)).catch(() => undefined);
    }
    return webpResponse(await recovery, fileName);
  } catch (error) {
    console.error("[gallery] Unable to recover thumbnail.", error);
    return new Response("Gallery thumbnail not found.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
