import { galleryCookie, galleryMutationAllowed, galleryOrigin } from "../../../../lib/gallery-auth";

export async function POST(request: Request) {
  if (!galleryMutationAllowed(request)) return new Response("Forbidden", { status: 403 });
  return new Response(null, { status: 303, headers: { Location: `${galleryOrigin()}/gallery`, "Set-Cookie": galleryCookie("", 0) } });
}
