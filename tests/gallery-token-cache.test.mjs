import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

for (const tokenFormat of ["jwt", "opaque"]) test(`reuses a valid ${tokenFormat} NAS token from the persistent gallery volume`, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "blog-gallery-token-"));
  const previousDirectory = process.env.GALLERY_DATA_DIR;
  const previousUrl = process.env.GALLERY_NAS_URL;
  const previousPassword = process.env.GALLERY_NAS_PASSWORD;
  const sourceUrl = "https://nas.example.test/share/gallery";
  const expiresAt = tokenFormat === "jwt"
    ? (Math.floor(Date.now() / 1000) + 3600) * 1000
    : Date.now() + 20 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt / 1000 })).toString("base64url");
  const value = tokenFormat === "jwt" ? `header.${payload}.signature` : "opaque-test-token";
  const filePath = path.join(directory, "nas-token.json");

  try {
    process.env.GALLERY_DATA_DIR = directory;
    process.env.GALLERY_NAS_URL = sourceUrl;
    process.env.GALLERY_NAS_PASSWORD = "test-only-password";
    await writeFile(filePath, JSON.stringify({
      value,
      expiresAt,
      sourceFingerprint: createHash("sha256").update(sourceUrl).digest("hex"),
    }), { mode: 0o600 });

    const { getGalleryNasToken, invalidateGalleryNasToken } = await import(
      `../app/lib/gallery-nas-token.ts?${tokenFormat}`
    );
    assert.equal(await getGalleryNasToken(), value);
    await invalidateGalleryNasToken(value);
    await assert.rejects(() => stat(filePath), { code: "ENOENT" });
  } finally {
    if (previousDirectory === undefined) delete process.env.GALLERY_DATA_DIR;
    else process.env.GALLERY_DATA_DIR = previousDirectory;
    if (previousUrl === undefined) delete process.env.GALLERY_NAS_URL;
    else process.env.GALLERY_NAS_URL = previousUrl;
    if (previousPassword === undefined) delete process.env.GALLERY_NAS_PASSWORD;
    else process.env.GALLERY_NAS_PASSWORD = previousPassword;
    await rm(directory, { recursive: true, force: true });
  }
});
