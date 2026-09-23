import { fetchGalleryNasImage } from "../../../lib/gallery-nas-token";

const validId = /^[a-zA-Z0-9_-]{1,128}$/;
const validType = /^\d{1,2}$/;

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const id = requestUrl.searchParams.get("id") || "";
  const fileType = requestUrl.searchParams.get("fileType") || "0";
  const sizeType = requestUrl.searchParams.get("sizeType") || "3";

  if (!validId.test(id) || !validType.test(fileType) || !validType.test(sizeType)) {
    return new Response("Invalid gallery image request.", { status: 400 });
  }

  try {
    const { response, destination } = await fetchGalleryNasImage(id, fileType, sizeType, {
      range: "bytes=0-0",
      timeoutMs: 45_000,
    });
    await response.body?.cancel().catch(() => undefined);
    return new Response(null, {
      status: 307,
      headers: {
        Location: destination.toString(),
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    console.error("[gallery] Unable to renew the NAS image token.");
    return new Response("Gallery image is temporarily unavailable.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
