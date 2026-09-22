import { chromium } from "playwright-core";

const STREAM_PATH = "/ugreen/v5/photo/share/external/stream";
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

type CachedToken = {
  value: string;
  expiresAt: number;
};

let cachedToken: CachedToken | null = null;
let refreshPromise: Promise<CachedToken> | null = null;
let renewalTimer: NodeJS.Timeout | null = null;

function configuration() {
  const sourceUrl = process.env.GALLERY_NAS_URL;
  const password = process.env.GALLERY_NAS_PASSWORD;
  if (!sourceUrl || !password) throw new Error("Gallery NAS credentials are not configured.");
  return { sourceUrl, password, origin: new URL(sourceUrl).origin };
}

function tokenExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (typeof payload.exp === "number") return payload.exp * 1000;
  } catch {
    // Fall back to a deliberately short cache when the NAS changes token format.
  }
  return Date.now() + 30 * 60 * 1000;
}

async function renewToken(): Promise<CachedToken> {
  const { sourceUrl, password, origin } = configuration();
  const browser = await chromium.launch({
    executablePath: process.env.GALLERY_CHROME_PATH || "/usr/bin/chromium-browser",
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });

  try {
    const context = await browser.newContext({ locale: "zh-CN" });
    const page = await context.newPage();
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (new URL(page.url()).origin !== origin) throw new Error("Unexpected NAS redirect origin.");

    const passwordField = page.locator('input[type="password"]');
    await passwordField.waitFor({ state: "visible", timeout: 30_000 });
    await passwordField.fill(password);
    await passwordField.press("Enter");

    const image = page.locator(".photo-wall-item img.photo-img").first();
    await image.waitFor({ state: "attached", timeout: 45_000 });
    const source = await image.getAttribute("data-src") || await image.getAttribute("src");
    if (!source) throw new Error("NAS did not expose a gallery image URL.");

    const streamUrl = new URL(source, sourceUrl);
    if (streamUrl.origin !== origin || streamUrl.pathname !== STREAM_PATH) {
      throw new Error("NAS returned an unexpected image endpoint.");
    }
    const token = streamUrl.searchParams.get("external_token");
    if (!token) throw new Error("NAS did not issue an external gallery token.");
    return { value: token, expiresAt: tokenExpiry(token) };
  } finally {
    await browser.close();
  }
}

function scheduleRenewal(token: CachedToken) {
  if (renewalTimer) clearTimeout(renewalTimer);
  const delay = Math.max(1_000, token.expiresAt - TOKEN_REFRESH_MARGIN_MS - Date.now());
  renewalTimer = setTimeout(() => {
    void refreshToken().catch(() => {
      renewalTimer = setTimeout(() => void refreshToken().catch(() => undefined), 60_000);
      renewalTimer.unref();
    });
  }, delay);
  renewalTimer.unref();
}

async function refreshToken(): Promise<CachedToken> {
  refreshPromise ??= renewToken();
  try {
    cachedToken = await refreshPromise;
    scheduleRenewal(cachedToken);
    return cachedToken;
  } finally {
    refreshPromise = null;
  }
}

export async function getGalleryNasToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
    return cachedToken.value;
  }
  return (await refreshToken()).value;
}

export function galleryNasStreamUrl(id: string, fileType: string, sizeType: string, token: string) {
  const { origin } = configuration();
  const url = new URL(STREAM_PATH, origin);
  url.searchParams.set("id", id);
  url.searchParams.set("size_type", sizeType);
  url.searchParams.set("file_type", fileType);
  url.searchParams.set("external_token", token);
  return url;
}
