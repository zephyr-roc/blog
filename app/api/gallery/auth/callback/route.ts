import { cookieValue, galleryAdminConfigured, galleryCallbackUrl, galleryCookie, galleryOrigin, gallerySession, safeEqual } from "../../../../lib/gallery-auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const saved = cookieValue(request, "gallery_oauth_state") || "";
  if (!galleryAdminConfigured() || !state || !saved || !safeEqual(state, saved) || !code) {
    return new Response("GitHub 登录验证失败。", { status: 403 });
  }
  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: process.env.GALLERY_GITHUB_CLIENT_ID, client_secret: process.env.GALLERY_GITHUB_CLIENT_SECRET, code, redirect_uri: galleryCallbackUrl() }),
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!tokenResponse.ok) throw new Error("OAuth exchange failed");
    const token = await tokenResponse.json() as { access_token?: string };
    if (!token.access_token) throw new Error("OAuth token missing");
    const profileResponse = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "ready-jump-gallery" },
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!profileResponse.ok) throw new Error("GitHub profile unavailable");
    const profile = await profileResponse.json() as { id?: number };
    if (!Number.isSafeInteger(profile.id) || String(profile.id) !== process.env.GALLERY_ADMIN_GITHUB_ID) {
      return new Response("此 GitHub 账号没有画廊管理权限。", { status: 403, headers: { "Set-Cookie": galleryCookie("", 0, "/api/gallery/auth") } });
    }
    const response = new Response(null, { status: 302, headers: { Location: `${galleryOrigin()}/gallery/manage`, "Cache-Control": "no-store" } });
    response.headers.append("Set-Cookie", galleryCookie("", 0, "/api/gallery/auth"));
    response.headers.append("Set-Cookie", galleryCookie(gallerySession(profile.id!), 7 * 24 * 60 * 60));
    return response;
  } catch {
    return new Response("GitHub 登录暂不可用，请稍后重试。", { status: 503, headers: { "Set-Cookie": galleryCookie("", 0, "/api/gallery/auth") } });
  }
}
