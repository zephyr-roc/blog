import { galleryAuthorized, galleryMutationAllowed } from "../../../lib/gallery-auth";
import { readGalleryImages } from "../../../lib/gallery-runtime";
import { addGalleryPhoto, deleteGalleryPhoto, MAX_GALLERY_UPLOAD_BYTES, updateGalleryPhoto } from "../../../lib/gallery-storage";

export async function GET(request: Request) {
  if (!galleryAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await readGalleryImages(), { headers: { "Cache-Control": "no-store" } });
}

function canModify(request: Request) {
  return galleryAuthorized(request) && galleryMutationAllowed(request);
}

export async function POST(request: Request) {
  if (!canModify(request)) return new Response("Forbidden", { status: 403 });
  if (Number(request.headers.get("content-length")) > MAX_GALLERY_UPLOAD_BYTES + 1_000_000) {
    return new Response("照片不能超过 40MB。", { status: 413 });
  }
  try {
    const form = await request.formData();
    const photo = form.get("photo");
    if (!(photo instanceof File) || !photo.size || photo.size > MAX_GALLERY_UPLOAD_BYTES) {
      return new Response("请选择不超过 40MB 的照片。", { status: 400 });
    }
    const title = String(form.get("title") || "");
    const image = await addGalleryPhoto(Buffer.from(await photo.arrayBuffer()), photo.name, title);
    return Response.json(image, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "上传失败。", { status: 400 });
  }
}

export async function PATCH(request: Request) {
  if (!canModify(request)) return new Response("Forbidden", { status: 403 });
  try {
    const data = await request.json() as { id?: string; title?: string; capturedAt?: string };
    if (!data.id || !/^[0-9a-f-]{36}$/.test(data.id) ||
      (data.title !== undefined && typeof data.title !== "string") ||
      (data.capturedAt !== undefined && typeof data.capturedAt !== "string")) {
      return new Response("Invalid update.", { status: 400 });
    }
    const image = await updateGalleryPhoto(data.id, { title: data.title, capturedAt: data.capturedAt });
    return image ? Response.json(image) : new Response("Photo not found.", { status: 404 });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "修改失败。", { status: 400 });
  }
}

export async function DELETE(request: Request) {
  if (!canModify(request)) return new Response("Forbidden", { status: 403 });
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Invalid photo.", { status: 400 });
  return await deleteGalleryPhoto(id) ? new Response(null, { status: 204 }) : new Response("Photo not found.", { status: 404 });
}
