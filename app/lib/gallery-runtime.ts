import { readFile } from "node:fs/promises";
import path from "node:path";
import type { GalleryImage, GalleryManifest } from "../gallery/gallery-types";

export const GALLERY_MANIFEST_VERSION = 2;

export function galleryDataDirectory() {
  return path.resolve(process.env.GALLERY_DATA_DIR || "/data/gallery");
}

export function galleryManifestPath() {
  return path.join(galleryDataDirectory(), "manifest.json");
}

export function galleryThumbnailDirectory() {
  return path.join(galleryDataDirectory(), "thumbnails");
}

export async function readGalleryImages(): Promise<GalleryImage[]> {
  try {
    const manifest = JSON.parse(
      await readFile(galleryManifestPath(), "utf8"),
    ) as GalleryManifest;
    if (manifest.version !== GALLERY_MANIFEST_VERSION || !Array.isArray(manifest.images)) {
      return [];
    }
    return manifest.images;
  } catch {
    return [];
  }
}
