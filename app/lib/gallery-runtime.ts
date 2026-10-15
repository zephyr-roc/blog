import { readFile } from "node:fs/promises";
import path from "node:path";
import type { GalleryImage, GalleryManifest } from "../gallery/gallery-types";

export const GALLERY_MANIFEST_VERSION = 3;

export function galleryDataDirectory() {
  return path.resolve(process.env.GALLERY_DATA_DIR || "/data/gallery");
}

export function galleryManifestPath() {
  return path.join(galleryDataDirectory(), "manifest.json");
}

export function galleryThumbnailDirectory() {
  return path.join(galleryDataDirectory(), "thumbnails");
}

export function galleryOriginalDirectory() {
  return path.join(galleryDataDirectory(), "originals");
}

export async function readGalleryImages(): Promise<GalleryImage[]> {
  try {
    const manifest = JSON.parse(
      await readFile(galleryManifestPath(), "utf8"),
    ) as GalleryManifest;
    if (manifest.version !== GALLERY_MANIFEST_VERSION || !Array.isArray(manifest.images)) {
      return [];
    }
    return manifest.images.sort((left, right) => {
      const a = Date.parse(left.metadata.capturedAt || "") || 0;
      const b = Date.parse(right.metadata.capturedAt || "") || 0;
      return b - a || right.id.localeCompare(left.id);
    });
  } catch {
    return [];
  }
}
