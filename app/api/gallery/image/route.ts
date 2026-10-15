import { readFile } from "node:fs/promises";
import path from "node:path";
import { galleryOriginalDirectory, readGalleryImages } from "../../../lib/gallery-runtime";
import { galleryMime, galleryOriginalName } from "../../../lib/gallery-storage";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Invalid photo.", { status: 400 });
  const image = (await readGalleryImages()).find((item) => item.id === id);
  if (!image) return new Response("Photo not found.", { status: 404 });
  try {
    const bytes = await readFile(path.join(galleryOriginalDirectory(), galleryOriginalName(image)));
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": galleryMime(image),
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return new Response("Photo not found.", { status: 404 });
  }
}
