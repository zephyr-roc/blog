import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_AGE = 7 * 24 * 60 * 60;

export function galleryAdminConfigured() {
  return Boolean(process.env.GALLERY_GITHUB_CLIENT_ID && process.env.GALLERY_GITHUB_CLIENT_SECRET && process.env.GALLERY_ADMIN_GITHUB_ID);
}

export function galleryOrigin() {
  return (process.env.GALLERY_PUBLIC_ORIGIN || "https://ready-jump.top").replace(/\/$/, "");
}

export function galleryCallbackUrl() {
  return `${galleryOrigin()}/api/gallery/auth/callback`;
}

export function galleryMutationAllowed(request: Request) {
  return request.headers.get("origin") === galleryOrigin() &&
    request.headers.get("sec-fetch-site") !== "cross-site";
}

export function galleryState() {
  return randomBytes(32).toString("base64url");
}

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function signature(value: string) {
  const secret = process.env.GALLERY_GITHUB_CLIENT_SECRET;
  if (!secret) return "";
  return createHmac("sha256", secret).update(`gallery-session-v1:${value}`).digest("base64url");
}

export function gallerySession(id: number) {
  const payload = Buffer.from(JSON.stringify({ id, exp: Math.floor(Date.now() / 1000) + SESSION_AGE })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function isGalleryAdmin(cookie: string | undefined) {
  if (!galleryAdminConfigured() || !cookie) return false;
  const [payload, mac, extra] = cookie.split(".");
  if (!payload || !mac || extra || !safeEqual(mac, signature(payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { id?: number; exp?: number };
    return String(data.id) === process.env.GALLERY_ADMIN_GITHUB_ID &&
      typeof data.exp === "number" && data.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export function galleryCookie(value: string, maxAge: number, path = "/") {
  return `gallery_${path === "/" ? "session" : "oauth_state"}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function cookieValue(request: Request, name: string) {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function galleryAuthorized(request: Request) {
  return isGalleryAdmin(cookieValue(request, "gallery_session"));
}
