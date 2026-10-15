import { readFile } from "node:fs/promises";
import path from "node:path";
import { galleryDataDirectory, readGalleryImages } from "../../../lib/gallery-runtime";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Invalid photo.", { status: 400 });
  if (!(await readGalleryImages()).some((image) => image.id === id)) return new Response("Photo not found.", { status: 404 });
  try {
    const cached = JSON.parse(await readFile(path.join(galleryDataDirectory(), "details", `${id}.json`), "utf8"));
    return Response.json(cached.details, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch {
    return new Response("Photo details unavailable.", { status: 404 });
  }
}
