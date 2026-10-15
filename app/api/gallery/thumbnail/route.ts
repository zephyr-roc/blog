import { readFile } from "node:fs/promises";
import path from "node:path";
import { galleryThumbnailDirectory, readGalleryImages } from "../../../lib/gallery-runtime";

export async function GET(request: Request) {
  const file = new URL(request.url).searchParams.get("file") || "";
  if (!/^[0-9a-f-]{36}-(480|960)\.webp$/.test(file)) return new Response("Invalid thumbnail.", { status: 400 });
  const id = file.slice(0, 36);
  if (!(await readGalleryImages()).some((image) => image.id === id)) return new Response("Thumbnail not found.", { status: 404 });
  try {
    const bytes = await readFile(path.join(galleryThumbnailDirectory(), file));
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "image/webp", "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return new Response("Thumbnail not found.", { status: 404 });
  }
}
