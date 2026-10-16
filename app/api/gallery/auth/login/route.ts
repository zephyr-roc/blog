import { galleryAdminConfigured, galleryCallbackUrl, galleryCookie, galleryOrigin, galleryState } from "../../../../lib/gallery-auth";

export async function GET(request: Request) {
  if (!galleryAdminConfigured()) return new Response("画廊管理尚未配置。", { status: 503 });
  // State cookies are host-only. Normalize www/alternate hosts before issuing
  // one, otherwise GitHub's canonical callback cannot receive that cookie.
  const origin = new URL(galleryOrigin());
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim()
    || request.headers.get("host") || new URL(request.url).host;
  if (host.toLowerCase() !== origin.host.toLowerCase()) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: new URL("/api/gallery/auth/login", origin).toString(),
        "Cache-Control": "no-store",
      },
    });
  }
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
