import { access, mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";
import sharp from "sharp";

const sourceUrl = process.env.GALLERY_NAS_URL;
const password = process.env.GALLERY_NAS_PASSWORD;
const outputDirectory = path.resolve(
  process.cwd(),
  process.env.GALLERY_NAS_OUTPUT_DIR || path.join("gallery", "source", "nas"),
);
const allowedStreamPath = "/ugreen/v5/photo/share/external/stream";
const concurrency = 4;

if (!sourceUrl) {
  throw new Error("GALLERY_NAS_URL is required to synchronize the gallery.");
}
if (!password) {
  throw new Error("GALLERY_NAS_PASSWORD is required to synchronize the gallery.");
}
const expectedOrigin = new URL(sourceUrl).origin;

async function existingPath(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next well-known browser path.
    }
  }
  throw new Error("Chrome was not found. Set GALLERY_CHROME_PATH to its executable.");
}

function safeName(value) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "photo";
}

function extensionFor(format) {
  return {
    jpeg: "jpg",
    png: "png",
    webp: "webp",
    gif: "gif",
    avif: "avif",
    heif: "heic",
    tiff: "tiff",
  }[format] || "webp";
}

async function mapWithConcurrency(items, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

const chromePath = await existingPath([
  process.env.GALLERY_CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
]);
await mkdir(path.dirname(outputDirectory), { recursive: true });
const stagingDirectory = await mkdtemp(
  path.join(path.dirname(outputDirectory), ".nas-staging-"),
);
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--disable-dev-shm-usage", "--no-sandbox"],
});

try {
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });

  if (new URL(page.url()).origin !== expectedOrigin) {
    throw new Error("The NAS share redirected to an unexpected origin.");
  }

  const passwordField = page.locator('input[type="password"]');
  await passwordField.waitFor({ state: "visible", timeout: 30_000 });
  await passwordField.fill(password);
  await passwordField.press("Enter");
  await page.locator(".photo-wall-item").first().waitFor({ state: "attached", timeout: 45_000 });

  const records = new Map();
  const scrollContainer = page.locator(".share-container");
  await scrollContainer.evaluate((element) => { element.scrollTop = 0; });

  for (let step = 0; step < 40; step += 1) {
    const visibleRecords = await page.locator(".photo-wall-item").evaluateAll((items) => items.map((item) => {
      const image = item.querySelector("img.photo-img");
      return {
        name: item.getAttribute("name") || "photo",
        index: Number(item.getAttribute("img-index") || 0),
        source: image?.getAttribute("data-src") || image?.getAttribute("src") || "",
      };
    }));

    for (const record of visibleRecords) {
      if (!record.source || record.source.startsWith("data:")) continue;
      const streamUrl = new URL(record.source, sourceUrl);
      if (streamUrl.origin !== expectedOrigin || streamUrl.pathname !== allowedStreamPath) continue;
      const fileType = streamUrl.searchParams.get("file_type");
      streamUrl.searchParams.set("size_type", fileType === "3" ? "0" : "3");
      records.set(streamUrl.searchParams.get("id") || `${record.index}`, {
        ...record,
        source: streamUrl.toString(),
      });
    }

    const position = await scrollContainer.evaluate((element) => {
      const previousTop = element.scrollTop;
      element.scrollTop = Math.min(
        element.scrollHeight - element.clientHeight,
        element.scrollTop + Math.max(560, Math.floor(element.clientHeight * .78)),
      );
      return {
        previousTop,
        top: element.scrollTop,
        bottom: element.scrollHeight - element.clientHeight,
      };
    });

    if (position.top >= position.bottom && position.top === position.previousTop) break;
    await page.waitForTimeout(260);
  }

  const photos = [...records.values()].sort((left, right) => left.index - right.index);
  if (photos.length === 0) throw new Error("No photos were discovered after NAS authentication.");

  await mapWithConcurrency(photos, async (photo, index) => {
    const response = await fetch(photo.source, {
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        referer: sourceUrl,
      },
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error(`Photo ${index + 1} returned HTTP ${response.status}.`);

    const buffer = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(buffer, { animated: true, limitInputPixels: false }).metadata();
    if (!metadata.width || !metadata.height || !metadata.format) {
      throw new Error(`Photo ${index + 1} did not return a supported image.`);
    }

    const originalStem = path.parse(photo.name).name;
    const fileName = `${String(index + 1).padStart(4, "0")}-${safeName(originalStem)}.${extensionFor(metadata.format)}`;
    await writeFile(path.join(stagingDirectory, fileName), buffer);
  });

  const stagedFiles = await readdir(stagingDirectory);
  if (stagedFiles.length !== photos.length) {
    throw new Error(`Expected ${photos.length} synchronized files, received ${stagedFiles.length}.`);
  }

  await rm(outputDirectory, { recursive: true, force: true });
  await rename(stagingDirectory, outputDirectory);
  console.log(`[gallery] Synchronized ${photos.length} NAS photos.`);
} catch (error) {
  await rm(stagingDirectory, { recursive: true, force: true });
  throw error;
} finally {
  await browser.close();
}
