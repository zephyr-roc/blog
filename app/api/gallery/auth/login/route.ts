import { galleryAdminConfigured, galleryCallbackUrl, galleryCookie, galleryState } from "../../../../lib/gallery-auth";

export async function GET() {
  if (!galleryAdminConfigured()) return new Response("画廊管理尚未配置。", { status: 503 });
  const state = galleryState();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.GALLERY_GITHUB_CLIENT_ID!);
  url.searchParams.set("redirect_uri", galleryCallbackUrl());
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      "Set-Cookie": galleryCookie(state, 600, "/api/gallery/auth"),
      "Cache-Control": "no-store",
    },
  });
}
