import { readFile } from "node:fs/promises";
import path from "node:path";
import { galleryThumbnailDirectory } from "../../../lib/gallery-runtime";

const validFileName = /^[a-z0-9][a-z0-9._-]{0,180}\.webp$/i;

export async function GET(request: Request) {
  const fileName = new URL(request.url).searchParams.get("file") || "";
  if (!validFileName.test(fileName)) {
    return new Response("Invalid gallery thumbnail.", { status: 400 });
  }

  try {
    const body = await readFile(path.join(galleryThumbnailDirectory(), fileName));
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
        ETag: `"${path.parse(fileName).name}"`,
      },
    });
  } catch {
    return new Response("Gallery thumbnail not found.", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
